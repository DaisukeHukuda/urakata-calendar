import { fetchReservationsCsv } from './fetcher.js';
import { parseReservations } from './parser.js';
import { parseFormResponses, CONSENT_CFG, EMERGENCY_CFG, matchForms, readSheetValues } from './forms.js';
import { selectReminderTargets, buildReminderEmail, endOfTomorrowJst } from './reminder.js';
import { applyTestMode, sendMail } from './mailer.js';
import { fetchReminded, publishReminded } from './web-publish.js';

// main.ts と同じ公開情報（回答シートID・web URL）
const SHEET_CONSENT = '1QzGBhtOLy89KvdPVOALg7_yTRnJZvz0ynS2hg2kSZSM';
const SHEET_EMERGENCY = '12Y9HEiAjICMFVNjmjH0ndLixkdAORhkcCFQmHtr3ADY';
const WEB_URL = 'https://supsup-urakata-calendar.ymty.workers.dev';

async function run(): Promise<void> {
  const env = process.env;
  const req = (k: string): string => {
    const v = (env[k] ?? '').trim();
    if (!v) throw new Error(`環境変数 ${k} が未設定です`);
    return v;
  };
  const dryRun = (env.REMINDER_DRY_RUN ?? '').trim() === '1';
  const now = new Date();

  // 今日〜明日(JST)の予約だけあればよい。fromは今日を確実に含むよう24h前。
  const csv = await fetchReservationsCsv({
    baseUrl: req('URAKATA_URL'), loginId: req('URAKATA_LOGIN_ID'), password: req('URAKATA_PASSWORD'),
    from: new Date(now.getTime() - 24 * 3600_000), to: endOfTomorrowJst(now),
    statuses: ['fixed', 'temporary_fixed'],
  });
  const reservations = parseReservations(csv);
  console.log(`[remind] fetched ${reservations.length} reservations`);

  const sa = req('GOOGLE_SERVICE_ACCOUNT_JSON');
  const consent = parseFormResponses(await readSheetValues(sa, SHEET_CONSENT), CONSENT_CFG);
  const emergency = parseFormResponses(await readSheetValues(sa, SHEET_EMERGENCY), EMERGENCY_CFG);
  const formsMap = matchForms(reservations, consent, emergency);

  const { targets, noEmail } = selectReminderTargets(reservations, formsMap, now);
  console.log(`[remind] targets=${targets.length} noEmail=${noEmail}`);

  if (dryRun) {
    for (const t of targets) {
      console.log(`[remind][DRY] ${t.reservationId} ${t.customerName} ${t.start.toISOString()} ` +
        `同意書=${t.missingConsent ? '未' : '済'} 緊急連絡=${t.missingEmergency ? '未' : '済'}`);
    }
    console.log(`[remind][DRY] ${targets.length}件に送信予定（実送信・フラグ記録なし）`);
    return;
  }

  const webSecret = req('WEB_INGEST_SECRET').replace(/\s/g, '');
  // 送信済みの取得に失敗したら送信しない（二重送信防止を優先）
  const reminded = await fetchReminded(WEB_URL, webSecret);
  const pending = targets.filter((t) => !reminded.has(t.reservationId));
  const skipped = targets.length - pending.length;
  console.log(`[remind] pending=${pending.length} skipped(already)=${skipped}`);

  const urls = { consent: req('FORM_URL_CONSENT'), emergency: req('FORM_URL_EMERGENCY') };
  const smtp = { user: req('GMAIL_USER'), appPassword: req('GMAIL_APP_PASSWORD') };
  const testEmail = (env.REMINDER_TEST_EMAIL ?? '').trim() || undefined;
  if (testEmail) console.log(`[remind] TEST MODE: all mails to ${testEmail}`);

  const sentIds: string[] = [];
  let failed = 0;
  for (const t of pending) {
    const mail = applyTestMode({ to: t.email, toName: t.customerName, ...buildReminderEmail(t, urls) }, testEmail);
    try {
      await sendMail(smtp, mail);
      sentIds.push(t.reservationId);
      console.log(`[remind] sent ${t.reservationId}`);
    } catch (e) {
      failed++;
      console.error(`[remind] send failed ${t.reservationId}:`, e);
    }
  }

  // テストモードではフラグを記録しない（本番切替後に本人へ届くように）。結果サマリーは常に記録。
  await publishReminded(WEB_URL, webSecret, {
    ids: testEmail ? [] : sentIds,
    summary: {
      at: new Date().toISOString(),
      sent: sentIds.length, skipped, failed,
      dryRun: false, test: !!testEmail,
    },
  });
  console.log(`[remind] done sent=${sentIds.length} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error('[remind] FAILED:', err); process.exit(1); });
