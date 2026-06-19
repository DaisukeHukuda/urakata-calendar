import { loadConfig } from './config.js';
import { fetchReservationsCsv } from './fetcher.js';
import { csvToEvents, parseReservations } from './parser.js';
import { syncEvents } from './syncer.js';
import { GoogleCalendarClient } from './google-calendar.js';
import { DEFAULT_SYNC_CONFIG } from './types.js';
import { publishToWeb } from './web-publish.js';

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
    from, to, statuses: ['fixed', 'temporary_fixed'],
  });

  const events = csvToEvents(csv, DEFAULT_SYNC_CONFIG);
  console.log(`[sync] parsed ${events.length} events`);

  const client = new GoogleCalendarClient(cfg.calendarId, cfg.serviceAccountJson);
  const result = await syncEvents(events, client, { timeMin: from, timeMax: to, prefix: DEFAULT_SYNC_CONFIG.idPrefix });
  console.log(`[sync] calendar created=${result.created} updated=${result.updated} deleted=${result.deleted}`);

  const webUrl = (process.env.WEB_INGEST_URL ?? '').trim();
  const webSecret = (process.env.WEB_INGEST_SECRET ?? '').trim();
  if (webUrl && webSecret) {
    try {
      const reservations = parseReservations(csv).filter(r => ['予約確定', '仮予約'].includes(r.status));
      await publishToWeb(webUrl, webSecret, reservations);
      console.log(`[sync] web published ${reservations.length} reservations`);
    } catch (e) {
      console.error('[sync] web publish failed (calendar sync unaffected):', e);
    }
  }
}

run().catch((err) => { console.error('[sync] FAILED:', err); process.exit(1); });
