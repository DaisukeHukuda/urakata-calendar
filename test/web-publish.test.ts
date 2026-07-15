import { describe, it, expect } from 'vitest';
import { toDTOs, selectForWeb } from '../src/web-publish.js';
import type { Reservation } from '../src/types.js';

const res: Reservation = {
  reservationId: '1', courseName: 'L SUP体験', start: new Date('2026-06-19T10:00:00+09:00'),
  pax: 2, customerName: 'A', customerKana: 'ナカオマミコ', status: '予約確定', phone: '090', memo: 'm', breakdown: 'b', media: 'Web',
  customerMemo: 'cm', totalAmount: '29000', supExperience: 'あり', companions: '同行者X', howFound: 'Instagram',
};

describe('selectForWeb', () => {
  const mk = (id: string, status: string): Reservation => ({ ...res, reservationId: id, status });
  it('予約確定・仮予約・参加済 を残す（参加済も保持してカレンダーから消えないように）', () => {
    const list = [mk('a', '予約確定'), mk('b', '仮予約'), mk('c', '参加済')];
    expect(selectForWeb(list).map(r => r.reservationId)).toEqual(['a', 'b', 'c']);
  });
  it('リクエスト（承認待ち）も残す', () => {
    const list = [mk('a', '予約確定'), mk('b', 'リクエスト')];
    expect(selectForWeb(list).map(r => r.reservationId)).toEqual(['a', 'b']);
  });
  it('それ以外のステータス（キャンセル等）は除外する', () => {
    const list = [mk('a', '予約確定'), mk('x', 'キャンセル'), mk('y', 'キャンセル待ち')];
    expect(selectForWeb(list).map(r => r.reservationId)).toEqual(['a']);
  });
  it('リクエストお断り・予約キャンセルは除外する', () => {
    const list = [mk('a', '予約確定'), mk('x', 'リクエストお断り'), mk('y', '予約キャンセル')];
    expect(selectForWeb(list).map(r => r.reservationId)).toEqual(['a']);
  });
});

describe('toDTOs', () => {
  it('Reservation を Web取り込み用DTO(必要項目のみ)に変換する', () => {
    const dto = toDTOs([res])[0];
    expect(dto).toEqual({
      reservationId: '1', courseName: 'L SUP体験',
      startISO: '2026-06-19T01:00:00.000Z', pax: 2, customerName: 'A', customerKana: 'ナカオマミコ',
      phone: '090', status: '予約確定',
      customerMemo: 'cm', totalAmount: '29000', breakdown: 'b',
      supExperience: 'あり', companions: '同行者X', howFound: 'Instagram',
    });
  });
});
