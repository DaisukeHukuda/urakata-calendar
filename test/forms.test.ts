import { describe, it, expect } from 'vitest';
import { normDate, normName, normPhone, parseFormResponses, matchForms, dayDiff, CONSENT_CFG, EMERGENCY_CFG } from '../src/forms.js';

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
  it('NFKC: 全角数字・半角カナを正規化', () => {
    expect(normPhone('０９０２５５９８０４１')).toBe('09025598041'); // 全角数字
    expect(normPhone('090 1352 7617')).toBe('09013527617');       // 半角空白
    expect(normName('ﾏﾔﾊｼ ﾕｲ')).toBe('マヤハシユイ');               // 半角カナ→全角＋空白除去
  });
});

describe('parseFormResponses（回答リストを返す）', () => {
  it('同意書: 1行を {date,names,phones} に。カナ氏名も names に入る', () => {
    const values = [
      ['タイムスタンプ', '日付（プラン参加日）', 'ご氏名（漢字フルネーム）', 'カナ氏名'],
      ['x', '2026/06/28', '厩橋 由衣', 'マヤハシ ユイ'],
    ];
    const list = parseFormResponses(values, CONSENT_CFG);
    expect(list).toHaveLength(1);
    expect(list[0].date).toBe('2026-06-28');
    expect(list[0].names).toContain('厩橋由衣');
    expect(list[0].names).toContain('マヤハシユイ');
    expect(list[0].phones.size).toBe(0);
  });
  it('緊急連絡先: 携帯番号のみ拾い、緊急連絡先電話は拾わない', () => {
    const values = [
      ['タイムスタンプ', '参加者ご本人のお名前', '携帯番号（ハイフンなし）', '緊急連絡先の電話番号（ハイフンなし）', 'ツアー参加の日付'],
      ['x', '厩橋 由衣', '09019048832', '09020100359', '2026/06/28'],
    ];
    const list = parseFormResponses(values, EMERGENCY_CFG);
    expect(list).toHaveLength(1);
    expect(list[0].phones.has('09019048832')).toBe(true);
    expect(list[0].phones.has('09020100359')).toBe(false);
  });
  it('名前も電話も無い行はスキップ。日付欄が空でも名前があれば残す', () => {
    const values = [
      ['タイムスタンプ', '参加者ご本人のお名前', '携帯番号（ハイフンなし）', 'ツアー参加の日付'],
      ['x', '', '', ''],                       // 全部空 → スキップ
      ['x', '田中太郎', '', ''],                // 日付空でも名前あり → 残す
    ];
    const list = parseFormResponses(values, EMERGENCY_CFG);
    expect(list).toHaveLength(1);
    expect(list[0].date).toBe('');
    expect(list[0].names).toContain('田中太郎');
  });
});

describe('dayDiff', () => {
  it('同日は0、跨ぎは絶対日数', () => {
    expect(dayDiff('2026-07-18', '2026-07-18')).toBe(0);
    expect(dayDiff('2026-07-18', '2026-07-19')).toBe(1);
    expect(dayDiff('2026-08-15', '2026-07-18')).toBe(28);
  });
});

describe('matchForms（電話 OR 氏名・日付は割り当て選別のみ）', () => {
  const consent = parseFormResponses([
    ['ts', '日付', 'ご氏名', 'カナ氏名'],
    ['x', '2026/06/28', '厩橋 由衣', 'マヤハシ ユイ'],
  ], CONSENT_CFG);
  const emergency = parseFormResponses([
    ['ts', '参加者ご本人のお名前', '携帯番号', 'ツアー参加の日付'],
    ['x', '厩橋 由衣', '09019048832', '2026/06/28'],
  ], EMERGENCY_CFG);

  it('カナのみ一致で同意書 true', () => {
    const r = matchForms(
      [{ reservationId: 'a', start: new Date('2026-06-28T10:00:00+09:00'), customerName: 'マヤハシ ユイ', customerKana: 'マヤハシ ユイ', phone: '' }],
      consent, emergency,
    );
    expect(r['a'].consent).toBe(true);
  });
  it('電話一致で緊急 true（氏名が合わなくても）', () => {
    const r = matchForms(
      [{ reservationId: 'b', start: new Date('2026-06-28T10:00:00+09:00'), customerName: 'Mayahashi', customerKana: 'マヤハシ ユイ', phone: '090-1904-8832' }],
      consent, emergency,
    );
    expect(r['b'].emergency).toBe(true);
  });
  it('日付が違っても電話/氏名一致なら true（旧仕様からの変更点）', () => {
    const r = matchForms(
      [{ reservationId: 'd', start: new Date('2026-07-01T10:00:00+09:00'), customerName: '厩橋 由衣', customerKana: 'マヤハシ ユイ', phone: '090-1904-8832' }],
      consent, emergency,
    );
    expect(r['d']).toEqual({ consent: true, emergency: true });
  });
  it('一致する回答が無ければ false', () => {
    const r = matchForms(
      [{ reservationId: 'z', start: new Date('2026-06-28T10:00:00+09:00'), customerName: '別人', customerKana: 'ベツジン', phone: '08000000000' }],
      consent, emergency,
    );
    expect(r['z']).toEqual({ consent: false, emergency: false });
  });
  it('実データ: 日付ズレ/年違い/全角電話でも緊急 true', () => {
    const em = parseFormResponses([
      ['ts', '参加者ご本人のお名前（漢字フルネーム）', '参加者ご本人のお名前（カタカナ フルネーム）', '携帯番号（ハイフンなし）', '緊急連絡先の電話番号（ハイフンなし）', 'ツアー参加の日付'],
      ['x', '藤本　久子', 'フジモトヒサコ', '09093122407', '090 5319 2144', '2028/09/06'],
      ['x', '若林功太', 'ワカバヤシコウタ', '07075675718', '090 1352 7617', '2026/08/01'],
      ['x', '磯村　崇之', 'イソムラ　タカユキ', '０９０２５５９８０４１', '０４８－８７２－７８９３', '2026/07/19'],
    ], EMERGENCY_CFG);
    const r = matchForms([
      { reservationId: 'fuji', start: new Date('2026-09-06T10:00:00+09:00'), customerName: '藤本　久子', customerKana: 'フジモト　ヒサコ', phone: '09093122407' },
      { reservationId: 'waka', start: new Date('2026-07-18T10:00:00+09:00'), customerName: '若林功太', customerKana: 'ワカバヤシコウタ', phone: '07075675718' },
      { reservationId: 'iso',  start: new Date('2026-07-18T10:00:00+09:00'), customerName: '磯村　崇之', customerKana: 'イソムラ　タカユキ', phone: '09025598041' },
    ], [], em);
    expect(r['fuji'].emergency).toBe(true);
    expect(r['waka'].emergency).toBe(true);
    expect(r['iso'].emergency).toBe(true);
  });
  it('同一人物の複数予約は回答日付に近い1件だけに付く', () => {
    const c = parseFormResponses([
      ['ts', '日付', 'ご氏名', 'カナ氏名'],
      ['x', '2026/07/18', '山田太郎', 'ヤマダタロウ'],
    ], CONSENT_CFG);
    const r = matchForms([
      { reservationId: 'r1', start: new Date('2026-07-18T10:00:00+09:00'), customerName: '山田太郎', customerKana: 'ヤマダタロウ', phone: '08011112222' },
      { reservationId: 'r2', start: new Date('2026-08-15T10:00:00+09:00'), customerName: '山田太郎', customerKana: 'ヤマダタロウ', phone: '08011112222' },
    ], c, []);
    expect(r['r1'].consent).toBe(true);
    expect(r['r2'].consent).toBe(false);
  });
});
