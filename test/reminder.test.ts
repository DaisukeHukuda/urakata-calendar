import { describe, it, expect } from 'vitest';
import { endOfTomorrowJst, selectReminderTargets, buildReminderEmail, selectTargetById } from '../src/reminder.js';
import type { Reservation } from '../src/types.js';

const NOW = new Date('2026-07-02T09:00:00+09:00');

function rsv(over: Partial<Reservation>): Reservation {
  return {
    reservationId: 'r1', courseName: 'SUP体験プラン', start: new Date('2026-07-03T10:00:00+09:00'),
    pax: 2, customerName: '山田太郎', status: '予約確定', email: 'taro@example.com',
    ...over,
  };
}

describe('endOfTomorrowJst', () => {
  it('JSTの明日23:59:59.999を返す', () => {
    expect(endOfTomorrowJst(NOW).toISOString()).toBe('2026-07-03T14:59:59.999Z');
  });
  it('JST深夜0時台でも正しい（日付境界）', () => {
    const midnight = new Date('2026-07-02T00:30:00+09:00');
    expect(endOfTomorrowJst(midnight).toISOString()).toBe('2026-07-03T14:59:59.999Z');
  });
});

describe('selectReminderTargets', () => {
  const noForms = {};
  it('明日開始・未記入・メール有りは対象', () => {
    const { targets } = selectReminderTargets([rsv({})], noForms, NOW);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      reservationId: 'r1', email: 'taro@example.com',
      missingConsent: true, missingEmergency: true,
    });
  });
  it('今日これから開始も対象、開始済みは対象外', () => {
    const future = rsv({ reservationId: 'a', start: new Date('2026-07-02T10:00:00+09:00') });
    const past = rsv({ reservationId: 'b', start: new Date('2026-07-02T08:00:00+09:00') });
    const { targets } = selectReminderTargets([future, past], noForms, NOW);
    expect(targets.map((t) => t.reservationId)).toEqual(['a']);
  });
  it('明後日0:00 JST開始は対象外（境界）', () => {
    const r = rsv({ start: new Date('2026-07-04T00:00:00+09:00') });
    expect(selectReminderTargets([r], noForms, NOW).targets).toHaveLength(0);
  });
  it('明日23:59 JST開始は対象（境界）', () => {
    const r = rsv({ start: new Date('2026-07-03T23:59:00+09:00') });
    expect(selectReminderTargets([r], noForms, NOW).targets).toHaveLength(1);
  });
  it('参加済・キャンセル等のステータスは対象外', () => {
    const r = rsv({ status: '参加済' });
    expect(selectReminderTargets([r], noForms, NOW).targets).toHaveLength(0);
  });
  it('リクエスト（未承認）は対象外', () => {
    const r = rsv({ status: 'リクエスト' });
    expect(selectReminderTargets([r], noForms, NOW).targets).toHaveLength(0);
  });
  it('Lコースは対象外（webのisLと同じ基準: courseNameにLを含む）', () => {
    const r = rsv({ courseName: 'L メガSUP ナイト' });
    expect(selectReminderTargets([r], noForms, NOW).targets).toHaveLength(0);
  });
  it('両方記入済みは対象外、片方未記入は対象で missing が立つ', () => {
    const both = rsv({ reservationId: 'a' });
    const half = rsv({ reservationId: 'b' });
    const forms = { a: { consent: true, emergency: true }, b: { consent: true, emergency: false } };
    const { targets } = selectReminderTargets([both, half], forms, NOW);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ reservationId: 'b', missingConsent: false, missingEmergency: true });
  });
  it('メール無しはスキップして noEmail に数える', () => {
    const r = rsv({ email: undefined });
    const res = selectReminderTargets([r], noForms, NOW);
    expect(res.targets).toHaveLength(0);
    expect(res.noEmail).toBe(1);
  });
});

describe('selectTargetById', () => {
  const forms = { r1: { consent: true, emergency: false } };
  it('未記入の予約を対象として返す（時間窓は適用しない＝何日先でも可）', () => {
    const r = rsv({ start: new Date('2026-08-15T10:00:00+09:00') });
    const res = selectTargetById([r], forms, 'r1');
    expect(res.target).toMatchObject({ reservationId: 'r1', missingConsent: false, missingEmergency: true });
    expect(res.reason).toBeUndefined();
  });
  it('存在しないIDは not_found', () => {
    expect(selectTargetById([rsv({})], forms, 'zzz').reason).toBe('not_found');
  });
  it('参加済など対象外ステータスは bad_status', () => {
    expect(selectTargetById([rsv({ status: '参加済' })], forms, 'r1').reason).toBe('bad_status');
  });
  it('リクエスト（未承認）は bad_status', () => {
    expect(selectTargetById([rsv({ status: 'リクエスト' })], forms, 'r1').reason).toBe('bad_status');
  });
  it('Lコースは hotel', () => {
    expect(selectTargetById([rsv({ courseName: 'L メガSUP' })], forms, 'r1').reason).toBe('hotel');
  });
  it('両方記入済みは filled', () => {
    const f = { r1: { consent: true, emergency: true } };
    expect(selectTargetById([rsv({})], f, 'r1').reason).toBe('filled');
  });
  it('メール無しは no_email', () => {
    expect(selectTargetById([rsv({ email: undefined })], forms, 'r1').reason).toBe('no_email');
  });
});

describe('buildReminderEmail', () => {
  const urls = { consent: 'https://forms.gle/CONSENT', emergency: 'https://forms.gle/EMERGENCY' };
  const base = {
    reservationId: 'r1', email: 'taro@example.com', customerName: '山田太郎',
    courseName: 'SUP体験プラン', start: new Date('2026-07-03T10:00:00+09:00'),
    missingConsent: true, missingEmergency: true,
  };
  it('氏名・日時(JST)・コース名・両フォームURLを含む', () => {
    const { subject, text } = buildReminderEmail(base, urls);
    expect(subject).toBe('【Sup! Sup!】同意書・緊急連絡先ご記入のお願い');
    expect(text).toContain('山田太郎 様');
    expect(text).toContain('7月3日(金) 10:00');
    expect(text).toContain('SUP体験プラン');
    expect(text).toContain('https://forms.gle/CONSENT');
    expect(text).toContain('https://forms.gle/EMERGENCY');
  });
  it('未記入のフォームURLだけ載せる', () => {
    const { text } = buildReminderEmail({ ...base, missingConsent: false }, urls);
    expect(text).not.toContain('https://forms.gle/CONSENT');
    expect(text).toContain('https://forms.gle/EMERGENCY');
  });
});
