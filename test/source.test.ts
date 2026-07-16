import { describe, it, expect } from 'vitest';
import { normalizeSource, buildHistoryRecords } from '../src/web-publish.js';
import type { Reservation } from '../src/types.js';

describe('normalizeSource', () => {
  it('categorizes SNS', () => {
    expect(normalizeSource('インスタグラムで見ました')).toBe('Instagram');
    expect(normalizeSource('Instagramの投稿')).toBe('Instagram');
    expect(normalizeSource('Facebookで知った')).toBe('Facebook');
  });
  it('categorizes repeat and referral', () => {
    expect(normalizeSource('以前参加したことがあります')).toBe('リピート');
    expect(normalizeSource('毎年来ています')).toBe('リピート');
    expect(normalizeSource('友人の紹介')).toBe('紹介');
    expect(normalizeSource('知人にすすめられて')).toBe('紹介');
  });
  it('categorizes search/web and asoview', () => {
    expect(normalizeSource('Google検索')).toBe('検索・Web');
    expect(normalizeSource('ネットで調べて')).toBe('検索・Web');
    expect(normalizeSource('ホームページを見て')).toBe('検索・Web');
    expect(normalizeSource('アソビューで見つけた')).toBe('アソビュー');
    expect(normalizeSource(undefined, 'asoview')).toBe('アソビュー');
  });
  it('precedence: SNS/repeat beat search when both appear', () => {
    expect(normalizeSource('インスタで検索して')).toBe('Instagram');
    expect(normalizeSource('以前も参加、今回はネットで')).toBe('リピート');
  });
  it('empty → 未回答, unmatched text → その他', () => {
    expect(normalizeSource(undefined, undefined)).toBe('未回答');
    expect(normalizeSource('', '')).toBe('未回答');
    expect(normalizeSource('テレビで見た')).toBe('その他');
  });
});

describe('buildHistoryRecords with source', () => {
  it('includes normalized source and never the raw free text', () => {
    const r = {
      reservationId: '1', courseName: 'SUP体験', start: new Date('2023-06-10T01:00:00Z'),
      pax: 2, customerName: '山田太郎', status: '参加済', phone: '090-1234-5678',
      totalAmount: '12,000', howFound: '友人の佐藤さんの紹介です',
    } as Reservation;
    const recs = buildHistoryRecords([r], 's1');
    expect(recs[0].source).toBe('紹介');
    const json = JSON.stringify(recs[0]);
    expect(json).not.toContain('佐藤');   // 生の自由記述（PII候補）を含まない
    expect(json).not.toContain('山田');
  });
});
