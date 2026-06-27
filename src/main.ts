import { loadConfig } from './config.js';
import { fetchReservationsCsv } from './fetcher.js';
import { csvToEvents, parseReservations } from './parser.js';
import { syncEvents } from './syncer.js';
import { GoogleCalendarClient } from './google-calendar.js';
import { DEFAULT_SYNC_CONFIG } from './types.js';
import { publishToWeb, repeatVisitDates, publishRepeats, selectForWeb, publishForms } from './web-publish.js';
import { parseConsent, parseEmergency, matchForms, readSheetValues } from './forms.js';

async function run(): Promise<void> {
  const cfg = loadConfig(process.env);
  const now = new Date();
  const jst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(now);
  const [y, m] = jst.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, -9, 0, 0)); // 月初00:00 JST
  const to = new Date(now.getTime() + cfg.syncDaysAhead * 24 * 60 * 60000);

  console.log(`[sync] fetch ${from.toISOString()} .. ${to.toISOString()}`);
  const csv = await fetchReservationsCsv({
    baseUrl: cfg.baseUrl, loginId: cfg.loginId, password: cfg.password,
    from, to, statuses: ['fixed', 'temporary_fixed', 'joined'],
  });

  const events = csvToEvents(csv, DEFAULT_SYNC_CONFIG);
  console.log(`[sync] parsed ${events.length} events`);

  const client = new GoogleCalendarClient(cfg.calendarId, cfg.serviceAccountJson);
  const result = await syncEvents(events, client, { timeMin: from, timeMax: to, prefix: DEFAULT_SYNC_CONFIG.idPrefix });
  console.log(`[sync] calendar created=${result.created} updated=${result.updated} deleted=${result.deleted}`);

  // Web公開先URLはコードに固定（公開情報。Secret取り違え・改行混入を防ぐ）
  const webUrl = 'https://supsup-urakata-calendar.ymty.workers.dev';
  // Secretは空白・改行を除去（貼り付け時の混入対策）
  const webSecret = (process.env.WEB_INGEST_SECRET ?? '').replace(/\s/g, '');
  if (webSecret) {
    try {
      const reservations = selectForWeb(parseReservations(csv));
      await publishToWeb(webUrl, webSecret, reservations);
      console.log(`[sync] web published ${reservations.length} reservations`);
    } catch (e) {
      console.error('[sync] web publish failed (calendar sync unaffected):', e);
    }
    try {
      const historyCsv = await fetchReservationsCsv({
        baseUrl: cfg.baseUrl, loginId: cfg.loginId, password: cfg.password,
        from: new Date('2015-01-01T00:00:00+09:00'), to: now, statuses: ['joined'],
      });
      const repeats = repeatVisitDates(parseReservations(historyCsv));
      await publishRepeats(webUrl, webSecret, repeats);
      console.log(`[sync] repeats published for ${Object.keys(repeats).length} phones`);
    } catch (e) {
      console.error('[sync] repeats publish failed (calendar sync unaffected):', e);
    }
    try {
      // 回答シート（公開情報のID。秘密ではない）
      const SHEET_CONSENT = '1QzGBhtOLy89KvdPVOALg7_yTRnJZvz0ynS2hg2kSZSM';
      const SHEET_EMERGENCY = '12Y9HEiAjICMFVNjmjH0ndLixkdAORhkcCFQmHtr3ADY';
      const webReservations = selectForWeb(parseReservations(csv));
      const consent = parseConsent(await readSheetValues(cfg.serviceAccountJson, SHEET_CONSENT));
      const emergency = parseEmergency(await readSheetValues(cfg.serviceAccountJson, SHEET_EMERGENCY));
      const formsMap = matchForms(webReservations, consent, emergency);
      await publishForms(webUrl, webSecret, formsMap);
      console.log(`[sync] forms published for ${Object.keys(formsMap).length} reservations`);
    } catch (e) {
      console.error('[sync] forms publish failed (calendar sync unaffected):', e);
    }
  }
}

run().catch((err) => { console.error('[sync] FAILED:', err); process.exit(1); });
