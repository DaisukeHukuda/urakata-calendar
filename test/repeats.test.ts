import { describe, it, expect } from 'vitest';
import { repeatVisitDates } from '../src/web-publish.js';
import type { Reservation } from '../src/types.js';

const R = (phone: string, status: string, startISO: string, courseName = 'SUP体験プラン'): Reservation => ({
  reservationId: 'x', courseName, start: new Date(startISO),
  pax: 1, customerName: 'c', status, phone,
});

describe('repeatVisitDates', () => {
  it('参加済・非Lの参加日(JST・重複排除・昇順)を電話ごとに集約。未参加/L/placeholderは除外', () => {
    const m = repeatVisitDates([
      R('090-1234-5678', '参加済', '2025-01-01T10:00:00+09:00'),
      R('09012345678', '参加済', '2025-01-05T10:00:00+09:00'),
      R('09012345678', '参加済', '2025-01-05T14:00:00+09:00'),   // 同日重複→1つ
      R('09012345678', '予約確定', '2025-02-01T10:00:00+09:00'),  // 未参加→除外
      R('09012345678', '参加済', '2025-03-01T10:00:00+09:00', 'L SUP体験'), // L→除外
      R('00000000000', '参加済', '2025-01-01T10:00:00+09:00'),    // placeholder→除外
      R('08099998888', '参加済', '2025-02-02T10:00:00+09:00'),
    ]);
    expect(m['09012345678']).toEqual(['2025-01-01', '2025-01-05']);
    expect(m['08099998888']).toEqual(['2025-02-02']);
    expect(m['00000000000']).toBeUndefined();
  });
});
