import { loadConfig } from './config.js';
import { fetchReservationsCsv, fetchReservationsCsvRanges, yearlyRanges } from './fetcher.js';
import { csvToEvents, parseReservations } from './parser.js';
import { syncEvents } from './syncer.js';
import { GoogleCalendarClient } from './google-calendar.js';
import { DEFAULT_SYNC_CONFIG } from './types.js';
import { publishToWeb, repeatVisitDates, publishRepeats, selectForWeb, publishForms, publishShifts, publishHistory, buildHistoryRecords } from './web-publish.js';
import { parseFormResponses, CONSENT_CFG, EMERGENCY_CFG, matchForms, readSheetValues } from './forms.js';
import { shouldSyncHistory, parseHistoryHours } from './schedule.js';
import { buildShiftMap } from './shifts.js';

async function run(): Promise<void> {
  const cfg = loadConfig(process.env);
  const now = new Date();
  const jst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(now);
  const [y, m] = jst.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, -9, 0, 0)); // 月初00:00 JST
  const to = new Date(now.getTime() + cfg.syncDaysAhead * 24 * 60 * 60000);

  console.log(`[sync] fetch ${from.toISOString()} .. ${to.toISOString()}`);
  // リクエスト（承認待ち）も取得してカレンダーに表示。承認/お断りで自動的に置き換わる。
  const csv = await fetchReservationsCsv({
    baseUrl: cfg.baseUrl, loginId: cfg.loginId, password: cfg.password,
    from, to, statuses: ['fixed', 'temporary_fixed', 'joined', 'requested'],
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
    // 履歴(2015〜)スイープは重く504を招くため、毎回は実行しない。
    // JSTの特定時刻(既定3時台)に走った同期のときのみフル取得する。
    const runHistory = shouldSyncHistory(now, parseHistoryHours(process.env.HISTORY_SYNC_HOURS));
    if (runHistory) {
      try {
        // 履歴CSVは一括取得だと重く504になるため、暦年レンジに分割して取得・連結する
        const ranges = yearlyRanges(new Date('2015-01-01T00:00:00+09:00'), now);
        const bodies = await fetchReservationsCsvRanges(
          { baseUrl: cfg.baseUrl, loginId: cfg.loginId, password: cfg.password, statuses: ['joined'] },
          ranges,
          { retries: 2 },
        );
        const history = bodies.flatMap((b) => parseReservations(b));
        const repeats = repeatVisitDates(history);
        await publishRepeats(webUrl, webSecret, repeats);
        console.log(`[sync] repeats published for ${Object.keys(repeats).length} phones`);
        const historyRecords = buildHistoryRecords(history, process.env.HISTORY_SALT ?? 'supsup');
        await publishHistory(webUrl, webSecret, historyRecords);
        console.log(`[sync] history published ${historyRecords.length} records`);
      } catch (e) {
        console.error('[sync] repeats/history publish failed (calendar sync unaffected):', e);
      }
    } else {
      console.log('[sync] history sweep skipped (light run)');
    }
    try {
      // 回答シート（公開情報のID。秘密ではない）
      const SHEET_CONSENT = '1QzGBhtOLy89KvdPVOALg7_yTRnJZvz0ynS2hg2kSZSM';
      const SHEET_EMERGENCY = '12Y9HEiAjICMFVNjmjH0ndLixkdAORhkcCFQmHtr3ADY';
      const webReservations = selectForWeb(parseReservations(csv));
      const consent = parseFormResponses(await readSheetValues(cfg.serviceAccountJson, SHEET_CONSENT), CONSENT_CFG);
      const emergency = parseFormResponses(await readSheetValues(cfg.serviceAccountJson, SHEET_EMERGENCY), EMERGENCY_CFG);
      const formsMap = matchForms(webReservations, consent, emergency);
      await publishForms(webUrl, webSecret, formsMap);
      console.log(`[sync] forms published for ${Object.keys(formsMap).length} reservations`);
    } catch (e) {
      console.error('[sync] forms publish failed (calendar sync unaffected):', e);
    }
    try {
      // シフト決定用カレンダー: 前月1日(JST)〜3か月後の月末(JST)まで。
      // 未共有の間は403/404になるため、失敗してもsync全体は止めずwarnのみで続行する。
      const shiftFrom = new Date(Date.UTC(y, m - 2, 1, -9, 0, 0)); // 前月1日 00:00 JST
      const shiftTo = new Date(Date.UTC(y, m + 3, 1, -9, 0, 0)); // 3か月後の月末（=4か月後1日の直前）まで
      const shiftItems = await client.listEvents(cfg.shiftCalendarId, shiftFrom.toISOString(), shiftTo.toISOString());
      const shiftMap = buildShiftMap(shiftItems);
      await publishShifts(webUrl, webSecret, shiftMap);
      console.log(`[sync] shifts published for ${Object.keys(shiftMap).length} days`);
    } catch (e) {
      console.warn('[sync] shifts publish failed (calendar may not be shared yet; calendar sync unaffected):', e);
    }
  }
}

run().catch((err) => { console.error('[sync] FAILED:', err); process.exit(1); });
