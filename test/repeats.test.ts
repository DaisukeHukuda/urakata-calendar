import { describe, it, expect } from 'vitest';
import { countRepeats } from '../src/web-publish.js';
import type { Reservation } from '../src/types.js';

const R = (phone: string, status: string, courseName = 'SUP体験プラン'): Reservation => ({
  reservationId: 'x', courseName, start: new Date('2025-01-01T01:00:00Z'),
  pax: 1, customerName: 'c', status, phone,
});

describe('countRepeats', () => {
  it('参加済・非L を電話番号(数字のみ)で集計し、未参加/L/placeholderは除外', () => {
    const counts = countRepeats([
      R('090-1234-5678', '参加済'),
      R('09012345678', '参加済'),
      R('09012345678', '予約確定'),
      R('09012345678', '参加済', 'L SUP体験'),
      R('00000000000', '参加済'),
      R('08099998888', '参加済'),
    ]);
    expect(counts['09012345678']).toBe(2);
    expect(counts['08099998888']).toBe(1);
    expect(counts['00000000000']).toBeUndefined();
  });
});
