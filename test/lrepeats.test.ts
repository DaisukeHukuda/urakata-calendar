import { describe, it, expect } from 'vitest';
import { nameKey, buildLRepeatMap } from '../src/lrepeats.js';

describe('nameKey', () => {
  it('NFKC正規化で全角英数を半角に統一する', () => {
    expect(nameKey('Ｍｏｒｉ　Ｍａｓａｈｉｋｏ')).toBe(nameKey('Mori Masahiko'));
  });
  it('大文字小文字を区別しない', () => {
    expect(nameKey('MORI MASAHIKO')).toBe(nameKey('mori masahiko'));
  });
  it('ひらがな→カタカナ統一で「もり まさひこ」と「モリ　マサヒコ」を同一視する', () => {
    expect(nameKey('もり まさひこ')).toBe(nameKey('モリ　マサヒコ'));
  });
  it('トークン順序を無視する（"Mori, Masahiko" と "masahiko mori"）', () => {
    expect(nameKey('Mori, Masahiko')).toBe(nameKey('masahiko mori'));
  });
  it('区切り文字の揺れ（、 ， . ． ・ 半角/全角スペース）を吸収する', () => {
    const expected = nameKey('mori masahiko');
    expect(nameKey('mori、masahiko')).toBe(expected);
    expect(nameKey('mori，masahiko')).toBe(expected);
    expect(nameKey('mori.masahiko')).toBe(expected);
    expect(nameKey('mori．masahiko')).toBe(expected);
    expect(nameKey('mori・masahiko')).toBe(expected);
    expect(nameKey('mori　masahiko')).toBe(expected); // 全角スペース
  });
  it('空文字・区切り文字のみの入力は ""', () => {
    expect(nameKey('')).toBe('');
    expect(nameKey('   ')).toBe('');
    expect(nameKey('　、，・')).toBe('');
  });
});

describe('buildLRepeatMap', () => {
  it('予約日より前の同名参加日数のみを数える', () => {
    const map = buildLRepeatMap(
      [
        { name: '森正彦', date: '2024-01-10' },
        { name: '森正彦', date: '2024-06-10' }, // これは予約日以降→対象外
      ],
      [{ reservationId: 'L1', name: '森正彦', date: '2024-06-10' }],
    );
    expect(map['L1']).toEqual({ count: 1, last: '2024-01-10' });
  });
  it('last は一致した直近(最大)の過去日', () => {
    const map = buildLRepeatMap(
      [
        { name: '森正彦', date: '2022-01-01' },
        { name: '森正彦', date: '2023-05-05' },
        { name: '森正彦', date: '2024-02-02' },
      ],
      [{ reservationId: 'L1', name: '森正彦', date: '2024-06-10' }],
    );
    expect(map['L1']).toEqual({ count: 3, last: '2024-02-02' });
  });
  it('count 0（一致なし・全て予約日以降）は結果から除外する', () => {
    const map = buildLRepeatMap(
      [{ name: '森正彦', date: '2024-06-10' }], // 予約日と同日→ < 判定で対象外
      [{ reservationId: 'L1', name: '森正彦', date: '2024-06-10' }],
    );
    expect(map['L1']).toBeUndefined();
    expect(map).toEqual({});
  });
  it('名前が空(nameKeyが"")のエントリは履歴側・現在L側どちらも無視する', () => {
    const map = buildLRepeatMap(
      [{ name: '', date: '2024-01-01' }, { name: '森正彦', date: '2024-01-01' }],
      [
        { reservationId: 'L1', name: '', date: '2024-06-10' },
        { reservationId: 'L2', name: '森正彦', date: '2024-06-10' },
      ],
    );
    expect(map['L1']).toBeUndefined();
    expect(map['L2']).toEqual({ count: 1, last: '2024-01-01' });
  });
  it('予約IDをキーにする（表記揺れが同じでも別予約は別キー）', () => {
    const map = buildLRepeatMap(
      [{ name: 'モリ マサヒコ', date: '2024-01-01' }],
      [
        { reservationId: 'L1', name: '森正彦', date: '2024-06-01' }, // 表記が違うので不一致（偽陰性は仕様通り）
        { reservationId: 'L2', name: 'もり まさひこ', date: '2024-06-01' }, // かな一致
      ],
    );
    expect(map['L1']).toBeUndefined();
    expect(map['L2']).toEqual({ count: 1, last: '2024-01-01' });
  });
  it('同名でも他の予約と混ざらず、それぞれの予約日基準で数える', () => {
    const map = buildLRepeatMap(
      [
        { name: '森正彦', date: '2024-01-01' },
        { name: '森正彦', date: '2024-03-01' },
      ],
      [
        { reservationId: 'L1', name: '森正彦', date: '2024-02-01' }, // 1件目のみ過去
        { reservationId: 'L2', name: '森正彦', date: '2024-12-01' }, // 2件とも過去
      ],
    );
    expect(map['L1']).toEqual({ count: 1, last: '2024-01-01' });
    expect(map['L2']).toEqual({ count: 2, last: '2024-03-01' });
  });
});
