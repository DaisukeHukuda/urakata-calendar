import { describe, it, expect } from 'vitest';
import { shouldSyncHistory, parseHistoryHours } from '../src/schedule.js';

describe('parseHistoryHours', () => {
  it('未指定なら既定 [3]', () => {
    expect(parseHistoryHours(undefined)).toEqual([3]);
    expect(parseHistoryHours('')).toEqual([3]);
  });
  it('カンマ区切りの時刻を配列化', () => {
    expect(parseHistoryHours('3,15')).toEqual([3, 15]);
    expect(parseHistoryHours(' 3 , 15 ')).toEqual([3, 15]);
  });
  it('0〜23以外や非数値は除外し、全滅なら既定 [3]', () => {
    expect(parseHistoryHours('25,foo,5')).toEqual([5]);
    expect(parseHistoryHours('99,bar')).toEqual([3]);
  });
});

describe('shouldSyncHistory', () => {
  // 2026-06-28T03:15:00 JST = 2026-06-27T18:15:00 UTC
  const at = (utcIso: string) => new Date(utcIso);
  it('JST時刻が対象hourに含まれれば true', () => {
    expect(shouldSyncHistory(at('2026-06-27T18:15:00Z'), [3])).toBe(true); // 03:15 JST
    expect(shouldSyncHistory(at('2026-06-27T18:30:00Z'), [3])).toBe(true); // 03:30 JST
  });
  it('対象hour外なら false', () => {
    expect(shouldSyncHistory(at('2026-06-27T19:00:00Z'), [3])).toBe(false); // 04:00 JST
    expect(shouldSyncHistory(at('2026-06-28T00:00:00Z'), [3])).toBe(false); // 09:00 JST
  });
  it('複数hour指定に対応', () => {
    expect(shouldSyncHistory(at('2026-06-28T06:00:00Z'), [3, 15])).toBe(true); // 15:00 JST
  });
});
