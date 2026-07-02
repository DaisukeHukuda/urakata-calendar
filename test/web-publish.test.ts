import { describe, it, expect, vi } from 'vitest';
import { toDTOs, selectForWeb, fetchReminded, publishReminded } from '../src/web-publish.js';
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
  it('それ以外のステータス（キャンセル等）は除外する', () => {
    const list = [mk('a', '予約確定'), mk('x', 'キャンセル'), mk('y', 'キャンセル待ち')];
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

describe('fetchReminded / publishReminded', () => {
  it('fetchReminded はID集合を返す', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({ ids: ['1', '2'] }), { status: 200 }));
    vi.stubGlobal('fetch', mock);
    const set = await fetchReminded('https://web.example', 'sec');
    expect([...set].sort()).toEqual(['1', '2']);
    expect(mock).toHaveBeenCalledWith('https://web.example/api/reminded',
      expect.objectContaining({ headers: { authorization: 'Bearer sec' } }));
    vi.unstubAllGlobals();
  });
  it('fetchReminded は非200で例外（送信中止のため）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ng', { status: 500 })));
    await expect(fetchReminded('https://web.example', 'sec')).rejects.toThrow();
    vi.unstubAllGlobals();
  });
  it('publishReminded はids+summaryをPOSTする', async () => {
    const mock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', mock);
    const summary = { at: '2026-07-02T10:00:00Z', sent: 1, skipped: 0, failed: 0, dryRun: false, test: false };
    await publishReminded('https://web.example', 'sec', { ids: ['1'], summary });
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe('https://web.example/ingest-reminded');
    expect(JSON.parse(init!.body as string)).toEqual({ ids: ['1'], summary });
    vi.unstubAllGlobals();
  });
});
