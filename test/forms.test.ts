import { describe, it, expect } from 'vitest';
import { normDate, normName, normPhone, parseFormResponses, matchForms, CONSENT_CFG, EMERGENCY_CFG } from '../src/forms.js';

describe('normalizers', () => {
  it('normDate', () => {
    expect(normDate('2026/02/14')).toBe('2026-02-14');
    expect(normDate('2026/2/4 12:00:00')).toBe('2026-02-04');
    expect(normDate('')).toBe('');
  });
  it('normName 空白除去 / normPhone 数字のみ', () => {
    expect(normName('林　真智子')).toBe('林真智子');
    expect(normPhone('090-1234-5678')).toBe('09012345678');
  });
});

describe('parseFormResponses（キーワードで列特定・複数名前列対応）', () => {
  it('同意書: 日付+氏名(漢字)+カナ氏名 を集約', () => {
    const values = [
      ['タイムスタンプ', '日付（プラン参加日）', 'ご氏名（漢字フルネーム）', 'カナ氏名'],
      ['x', '2026/06/28', '厩橋 頌志、厩橋 由衣', 'マヤハシ ショウジ、マヤハシ ユイ'],
    ];
    const m = parseFormResponses(values, CONSENT_CFG);
    const e = m.get('2026-06-28')!;
    expect(e.names).toContain('厩橋頌志、厩橋由衣');
    expect(e.names).toContain('マヤハシショウジ、マヤハシユイ');
    expect(e.phones.size).toBe(0);
  });
  it('緊急連絡先: 参加者名+携帯番号 を集約（緊急連絡先側の電話は拾わない）', () => {
    const values = [
      ['タイムスタンプ', '参加者ご本人のお名前', '携帯番号（ハイフンなし）', '緊急連絡先の電話番号（ハイフンなし）', 'ツアー参加の日付'],
      ['x', '厩橋 由衣', '09019048832', '09020100359', '2026/06/28'],
    ];
    const m = parseFormResponses(values, EMERGENCY_CFG);
    const e = m.get('2026-06-28')!;
    expect(e.names).toContain('厩橋由衣');
    expect(e.phones.has('09019048832')).toBe(true);
    expect(e.phones.has('09020100359')).toBe(false);
  });
});

describe('matchForms（複合: 電話 OR 漢字氏名 OR カナ氏名）', () => {
  const consent = parseFormResponses([
    ['ts', '日付', 'ご氏名', 'カナ氏名'],
    ['x', '2026/06/28', '厩橋 頌志、厩橋 由衣', 'マヤハシ ショウジ、マヤハシ ユイ'],
  ], CONSENT_CFG);
  const emergency = parseFormResponses([
    ['ts', '参加者ご本人のお名前', '携帯番号', 'ツアー参加の日付'],
    ['x', '厩橋 由衣', '09019048832', '2026/06/28'],
  ], EMERGENCY_CFG);

  it('予約者名がカナのみでも、フォームにカナがあれば同意書一致', () => {
    const r = matchForms(
      [{ reservationId: 'a', start: new Date('2026-06-28T10:00:00+09:00'), customerName: 'マヤハシ ユイ', customerKana: 'マヤハシ ユイ', phone: '' }],
      consent, emergency,
    );
    expect(r['a'].consent).toBe(true);
  });
  it('緊急は電話一致で true（氏名が合わなくても）', () => {
    const r = matchForms(
      [{ reservationId: 'b', start: new Date('2026-06-28T10:00:00+09:00'), customerName: 'Mayahashi', customerKana: 'マヤハシ ユイ', phone: '090-1904-8832' }],
      consent, emergency,
    );
    expect(r['b'].emergency).toBe(true);
  });
  it('漢字氏名一致でも true', () => {
    const r = matchForms(
      [{ reservationId: 'c', start: new Date('2026-06-28T10:00:00+09:00'), customerName: '厩橋 由衣', customerKana: '', phone: '' }],
      consent, emergency,
    );
    expect(r['c']).toEqual({ consent: true, emergency: true });
  });
  it('日付違いは false', () => {
    const r = matchForms(
      [{ reservationId: 'd', start: new Date('2026-07-01T10:00:00+09:00'), customerName: '厩橋 由衣', customerKana: 'マヤハシ ユイ', phone: '090-1904-8832' }],
      consent, emergency,
    );
    expect(r['d']).toEqual({ consent: false, emergency: false });
  });
});
