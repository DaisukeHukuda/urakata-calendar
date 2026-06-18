import { describe, it, expect } from 'vitest';
import { syncEvents } from '../src/syncer.js';
import type { CalendarClient, CalendarEvent } from '../src/types.js';

class FakeCalendarClient implements CalendarClient {
  store = new Map<string, CalendarEvent>();
  async listEventIds(o: { idPrefix: string }) {
    return [...this.store.keys()].filter(id => id.startsWith(o.idPrefix));
  }
  async upsertEvent(e: CalendarEvent) { this.store.set(e.id, e); }
  async deleteEvent(id: string) { this.store.delete(id); }
}

const ev = (id: string): CalendarEvent => ({
  id, summary: id, description: '', colorId: '9',
  start: new Date('2026-07-10T07:00:00Z'), end: new Date('2026-07-10T09:00:00Z'),
});
const range = { timeMin: new Date('2026-07-01'), timeMax: new Date('2026-08-01'), prefix: 'urkt' };

describe('syncEvents', () => {
  it('空のカレンダーへ新規作成する', async () => {
    const c = new FakeCalendarClient();
    const r = await syncEvents([ev('urkt1'), ev('urkt2')], c, range);
    expect(r.created).toBe(2);
    expect(r.updated).toBe(0);
    expect(r.deleted).toBe(0);
    expect(c.store.size).toBe(2);
  });
  it('既存は更新、無いものは作成する', async () => {
    const c = new FakeCalendarClient();
    await c.upsertEvent(ev('urkt1'));
    const r = await syncEvents([ev('urkt1'), ev('urkt2')], c, range);
    expect(r.updated).toBe(1);
    expect(r.created).toBe(1);
  });
  it('CSVから消えた予約は削除する', async () => {
    const c = new FakeCalendarClient();
    await c.upsertEvent(ev('urkt1'));
    await c.upsertEvent(ev('urkt2'));
    const r = await syncEvents([ev('urkt1')], c, range);
    expect(r.deleted).toBe(1);
    expect(c.store.has('urkt2')).toBe(false);
  });
  it('安全装置: 入力0件なら削除しない', async () => {
    const c = new FakeCalendarClient();
    await c.upsertEvent(ev('urkt1'));
    const r = await syncEvents([], c, range);
    expect(r.skippedDelete).toBe(true);
    expect(r.deleted).toBe(0);
    expect(c.store.has('urkt1')).toBe(true);
  });
  it('prefix が一致しない既存イベントは触らない', async () => {
    const c = new FakeCalendarClient();
    await c.upsertEvent({ ...ev('manual-1') });
    const r = await syncEvents([ev('urkt1')], c, range);
    expect(c.store.has('manual-1')).toBe(true);
    expect(r.deleted).toBe(0);
  });
});
