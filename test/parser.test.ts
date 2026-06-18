import { describe, it, expect } from 'vitest';
import { parseSankabi } from '../src/parser.js';

describe('parseSankabi', () => {
  it('日付＋時刻をJSTの絶対時刻として解釈する', () => {
    const r = parseSankabi('2025/11/12（水） 15:00');
    expect(r).not.toBeNull();
    expect(r!.start.toISOString()).toBe('2025-11-12T06:00:00.000Z');
  });
  it('時刻がない/壊れた文字列は null', () => {
    expect(parseSankabi('')).toBeNull();
    expect(parseSankabi('未定')).toBeNull();
  });
  it('1桁の月日でも解釈できる', () => {
    const r = parseSankabi('2026/6/8（月） 9:30');
    expect(r!.start.toISOString()).toBe('2026-06-08T00:30:00.000Z');
  });
});
