import { describe, it, expect } from 'vitest';
import { normDate, normName, normPhone, parseConsent, parseEmergency, matchForms } from '../src/forms.js';

describe('normalizers', () => {
  it('normDate: スラッシュ日付や時刻付きを YYYY-MM-DD に', () => {
    expect(normDate('2026/02/14')).toBe('2026-02-14');
    expect(normDate('2026/2/4 12:00:00')).toBe('2026-02-04');
    expect(normDate('2026-02-14')).toBe('2026-02-14');
    expect(normDate('')).toBe('');
  });
  it('normName: 全角/半角空白を除去', () => {
    expect(normName('林 真智子')).toBe('林真智子');
    expect(normName('林　真智子')).toBe('林真智子');
  });
  it('normPhone: 数字のみ', () => {
    expect(normPhone('090-9230-0464')).toBe('09092300464');
  });
});

describe('parseConsent', () => {
  it('日付ごとに氏名（連名）を集約（列はキーワードで特定）', () => {
    const values = [
      ['タイムスタンプ', '日付（プラン参加日をご選択ください）', 'ご氏名（漢字フルネーム）'],
      ['2026/02/12 21:36', '2026/02/14', '林真智子・林宏至'],
      ['2026/02/13 09:00', '2026/02/15', '佐藤太郎'],
    ];
    const m = parseConsent(values);
    expect(m.get('2026-02-14')).toEqual(['林真智子・林宏至']);
    expect(m.get('2026-02-15')).toEqual(['佐藤太郎']);
  });
});

describe('parseEmergency', () => {
  it('日付ごとに電話番号と参加者氏名を集約', () => {
    const values = [
      ['タイムスタンプ', '参加者ご本人のお名前', '携帯番号（ハイフンなし）', '緊急連絡先の電話番号', 'ツアー参加の日付'],
      ['2026/02/12', '林真智子', '09092300464', '0289762586', '2026/02/14'],
      ['2026/02/12', '林宏至', '09029887339', '0289762586', '2026/02/14'],
    ];
    const m = parseEmergency(values);
    const e = m.get('2026-02-14')!;
    expect(e.phones.has('09092300464')).toBe(true);
    expect(e.phones.has('09029887339')).toBe(true);
    expect(e.names).toContain('林真智子');
  });
});

describe('matchForms', () => {
  const consent = parseConsent([
    ['ts', '日付', 'ご氏名'],
    ['x', '2026/02/14', '林真智子・林宏至'],
  ]);
  const emergency = parseEmergency([
    ['ts', '参加者ご本人のお名前', '携帯番号', '参加の日付'],
    ['x', '林真智子', '09092300464', '2026/02/14'],
  ]);
  it('同意書=連名に予約者名を含む→true / 緊急=電話一致→true', () => {
    const r = matchForms(
      [{ reservationId: 'a', start: new Date('2026-02-14T10:00:00+09:00'), customerName: '林真智子', phone: '090-9230-0464' }],
      consent, emergency,
    );
    expect(r['a']).toEqual({ consent: true, emergency: true });
  });
  it('日付違いは両方false', () => {
    const r = matchForms(
      [{ reservationId: 'b', start: new Date('2026-02-20T10:00:00+09:00'), customerName: '林真智子', phone: '090-9230-0464' }],
      consent, emergency,
    );
    expect(r['b']).toEqual({ consent: false, emergency: false });
  });
  it('緊急は電話なくても氏名一致でtrue', () => {
    const r = matchForms(
      [{ reservationId: 'c', start: new Date('2026-02-14T10:00:00+09:00'), customerName: '林真智子', phone: '' }],
      consent, emergency,
    );
    expect(r['c'].emergency).toBe(true);
  });
});
