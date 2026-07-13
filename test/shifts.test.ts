import { describe, it, expect } from 'vitest';
import { buildShiftMap } from '../src/shifts.js';
import type { ShiftCalendarEvent } from '../src/shifts.js';

describe('buildShiftMap', () => {
  it('空配列は空オブジェクトを返す', () => {
    expect(buildShiftMap([])).toEqual({});
  });

  it('時間指定イベントはJSTの日付・時刻に変換される', () => {
    const items: ShiftCalendarEvent[] = [
      { summary: '岩崎', start: { dateTime: '2026-07-15T00:00:00Z' } }, // JST 09:00
    ];
    expect(buildShiftMap(items)).toEqual({
      '2026-07-15': [{ title: '岩崎', time: '09:00' }],
    });
  });

  it('終日イベント（1日）はtimeなしでその日に入る', () => {
    const items: ShiftCalendarEvent[] = [
      { summary: '終日イベント', start: { date: '2026-07-15' }, end: { date: '2026-07-16' } },
    ];
    expect(buildShiftMap(items)).toEqual({
      '2026-07-15': [{ title: '終日イベント' }],
    });
  });

  it('終日イベント（複数日）はend(排他的)まで各日に展開される', () => {
    const items: ShiftCalendarEvent[] = [
      { summary: '合宿', start: { date: '2026-07-15' }, end: { date: '2026-07-18' } },
    ];
    expect(buildShiftMap(items)).toEqual({
      '2026-07-15': [{ title: '合宿' }],
      '2026-07-16': [{ title: '合宿' }],
      '2026-07-17': [{ title: '合宿' }],
    });
  });

  it('summaryが空・未設定なら (無題) になる', () => {
    const items: ShiftCalendarEvent[] = [
      { summary: '', start: { dateTime: '2026-07-15T00:00:00Z' } },
      { start: { date: '2026-07-16' }, end: { date: '2026-07-17' } },
      { summary: '   ', start: { dateTime: '2026-07-15T01:00:00Z' } },
    ];
    const map = buildShiftMap(items);
    expect(map['2026-07-15'].map(e => e.title)).toEqual(['(無題)', '(無題)']);
    expect(map['2026-07-16']).toEqual([{ title: '(無題)' }]);
  });

  it('同じ日の予定は終日が先頭、時間指定は時刻の昇順でソートされる', () => {
    const items: ShiftCalendarEvent[] = [
      { summary: '山田PM', start: { dateTime: '2026-07-15T05:00:00Z' } }, // JST 14:00
      { summary: '終日イベント', start: { date: '2026-07-15' }, end: { date: '2026-07-16' } },
      { summary: '岩崎', start: { dateTime: '2026-07-15T00:00:00Z' } }, // JST 09:00
    ];
    expect(buildShiftMap(items)).toEqual({
      '2026-07-15': [
        { title: '終日イベント' },
        { title: '岩崎', time: '09:00' },
        { title: '山田PM', time: '14:00' },
      ],
    });
  });
});
