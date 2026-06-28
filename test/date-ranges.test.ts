import { describe, it, expect } from 'vitest';
import { yearlyRanges, fmtDateJst } from '../src/fetcher.js';

describe('yearlyRanges', () => {
  it('from と to が同年なら1要素（from/to をそのまま保持）', () => {
    const from = new Date('2026-03-01T00:00:00+09:00');
    const to = new Date('2026-06-28T00:00:00+09:00');
    const ranges = yearlyRanges(from, to);
    expect(ranges.length).toBe(1);
    expect(fmtDateJst(ranges[0].from)).toBe('2026-03-01');
    expect(fmtDateJst(ranges[0].to)).toBe('2026-06-28');
  });

  it('複数年は各境界が 12/31 と 1/1 になり、最後が to（3要素）', () => {
    const from = new Date('2024-05-10T00:00:00+09:00');
    const to = new Date('2026-06-28T00:00:00+09:00');
    const ranges = yearlyRanges(from, to);
    expect(ranges.length).toBe(3);

    // 最初のレンジ: from 〜 その年の 12/31
    expect(fmtDateJst(ranges[0].from)).toBe('2024-05-10');
    expect(fmtDateJst(ranges[0].to)).toBe('2024-12-31');

    // 中間の年: 1/1 〜 12/31
    expect(fmtDateJst(ranges[1].from)).toBe('2025-01-01');
    expect(fmtDateJst(ranges[1].to)).toBe('2025-12-31');

    // 最後のレンジ: その年の 1/1 〜 to
    expect(fmtDateJst(ranges[2].from)).toBe('2026-01-01');
    expect(fmtDateJst(ranges[2].to)).toBe('2026-06-28');
  });

  it('境界が年初/年末ちょうどでも正しく分割する', () => {
    const from = new Date('2015-01-01T00:00:00+09:00');
    const to = new Date('2016-12-31T00:00:00+09:00');
    const ranges = yearlyRanges(from, to);
    expect(ranges.length).toBe(2);
    expect(fmtDateJst(ranges[0].from)).toBe('2015-01-01');
    expect(fmtDateJst(ranges[0].to)).toBe('2015-12-31');
    expect(fmtDateJst(ranges[1].from)).toBe('2016-01-01');
    expect(fmtDateJst(ranges[1].to)).toBe('2016-12-31');
  });

  it('2015〜現在のような長期レンジでも年数ぶんの要素を返す', () => {
    const from = new Date('2015-01-01T00:00:00+09:00');
    const to = new Date('2026-06-28T00:00:00+09:00');
    const ranges = yearlyRanges(from, to);
    expect(ranges.length).toBe(12); // 2015..2026
    expect(fmtDateJst(ranges[0].from)).toBe('2015-01-01');
    expect(fmtDateJst(ranges[ranges.length - 1].to)).toBe('2026-06-28');
  });
});
