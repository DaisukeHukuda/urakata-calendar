import { describe, it, expect } from 'vitest';
import { toDTOs } from '../src/web-publish.js';
import type { Reservation } from '../src/types.js';

const res: Reservation = {
  reservationId: '1', courseName: 'L SUP体験', start: new Date('2026-06-19T10:00:00+09:00'),
  pax: 2, customerName: 'A', status: '予約確定', phone: '090', memo: 'm', breakdown: 'b', media: 'Web',
  customerMemo: 'cm', totalAmount: '29000', supExperience: 'あり', companions: '同行者X', howFound: 'Instagram',
};

describe('toDTOs', () => {
  it('Reservation を Web取り込み用DTO(必要項目のみ)に変換する', () => {
    const dto = toDTOs([res])[0];
    expect(dto).toEqual({
      reservationId: '1', courseName: 'L SUP体験',
      startISO: '2026-06-19T01:00:00.000Z', pax: 2, customerName: 'A',
      phone: '090', status: '予約確定',
      customerMemo: 'cm', totalAmount: '29000', breakdown: 'b',
      supExperience: 'あり', companions: '同行者X', howFound: 'Instagram',
    });
  });
});
