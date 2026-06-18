import { loadConfig } from './config.js';
import { fetchReservationsCsv } from './fetcher.js';
import { csvToEvents } from './parser.js';
import { syncEvents } from './syncer.js';
import { GoogleCalendarClient } from './google-calendar.js';
import { DEFAULT_SYNC_CONFIG } from './types.js';

async function run(): Promise<void> {
  const cfg = loadConfig(process.env);
  const now = new Date();
  const to = new Date(now.getTime() + cfg.syncDaysAhead * 24 * 60 * 60000);

  console.log(`[sync] fetch ${now.toISOString()} .. ${to.toISOString()}`);
  const csv = await fetchReservationsCsv({
    baseUrl: cfg.baseUrl, loginId: cfg.loginId, password: cfg.password,
    from: now, to, statuses: ['fixed', 'temporary_fixed'],
  });

  const events = csvToEvents(csv, DEFAULT_SYNC_CONFIG);
  console.log(`[sync] parsed ${events.length} events`);

  const client = new GoogleCalendarClient(cfg.calendarId, cfg.serviceAccountJson);
  const result = await syncEvents(events, client, {
    timeMin: now, timeMax: to, prefix: DEFAULT_SYNC_CONFIG.idPrefix,
  });

  console.log(`[sync] created=${result.created} updated=${result.updated} ` +
    `deleted=${result.deleted} skippedDelete=${result.skippedDelete}`);
}

run().catch((err) => {
  console.error('[sync] FAILED:', err);
  process.exit(1);
});
