import type { CalendarClient, CalendarEvent, SyncResult } from './types.js';

export async function syncEvents(
  events: CalendarEvent[],
  client: CalendarClient,
  opts: { timeMin: Date; timeMax: Date; prefix: string },
): Promise<SyncResult> {
  const existingIds = new Set(
    await client.listEventIds({ timeMin: opts.timeMin, timeMax: opts.timeMax, idPrefix: opts.prefix }),
  );

  let created = 0;
  let updated = 0;
  for (const e of events) {
    if (existingIds.has(e.id)) updated++;
    else created++;
    await client.upsertEvent(e);
  }

  let deleted = 0;
  let skippedDelete = false;
  if (events.length === 0) {
    skippedDelete = true;
  } else {
    const desired = new Set(events.map(e => e.id));
    for (const id of existingIds) {
      if (!desired.has(id)) {
        await client.deleteEvent(id);
        deleted++;
      }
    }
  }

  return { created, updated, deleted, skippedDelete };
}
