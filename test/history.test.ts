import { describe, it, expect } from 'vitest';
import { parseAmount, hashPhone, buildHistoryRecords } from '../src/web-publish.js';
import type { Reservation } from '../src/types.js';

function resv(over: Partial<Reservation>): Reservation {
  return {
    reservationId: '1', courseName: 'SUP体験', start: new Date('2023-06-10T01:00:00Z'),
    pax: 2, customerName: '山田太郎', status: '参加済', phone: '090-1234-5678',
    totalAmount: '12,000', ...over,
  } as Reservation;
}

describe('parseAmount', () => {
  it('parses comma/yen strings', () => {
    expect(parseAmount('12,000')).toBe(12000);
    expect(parseAmount('¥8,800円')).toBe(8800);
  });
  it('returns 0 for empty/garbage', () => {
    expect(parseAmount(undefined)).toBe(0);
    expect(parseAmount('無料')).toBe(0);
  });
});

describe('hashPhone', () => {
  it('is deterministic and salted', () => {
    const a = hashPhone('090-1234-5678', 's1');
    expect(a).toBe(hashPhone('09012345678', 's1'));
    expect(a).not.toBe(hashPhone('090-1234-5678', 's2'));
  });
  it('returns empty for missing/zero phone', () => {
    expect(hashPhone(undefined, 's')).toBe('');
    expect(hashPhone('0000', 's')).toBe('');
  });
});

describe('buildHistoryRecords', () => {
  it('maps fields, drops name, uses JST date', () => {
    const recs = buildHistoryRecords([resv({})], 's1');
    expect(recs).toHaveLength(1);
    const r = recs[0];
    expect(r.date).toBe('2023-06-10'); // 01:00Z = 10:00 JST 同日
    expect(r.course).toBe('SUP体験');
    expect(r.pax).toBe(2);
    expect(r.amount).toBe(12000);
    expect(r.phoneHash).toBe(hashPhone('09012345678', 's1'));
    expect(JSON.stringify(r)).not.toContain('山田');
  });
});
