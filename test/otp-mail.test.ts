import { describe, it, expect } from 'vitest';
import { extractOtpCode, waitForOtpCode, type OtpMailRecord } from '../src/otp-mail.js';

describe('extractOtpCode', () => {
  it('実物パターン「■認証コード：208404」から抽出する', () => {
    const text = '※このメールはシステムからの自動送信です。\n■認証コード：208404\n※ログインした心当たりがない場合…';
    expect(extractOtpCode(text)).toBe('208404');
  });

  it('半角コロン・空白入りでも抽出する', () => {
    expect(extractOtpCode('認証コード: 123456 です')).toBe('123456');
  });

  it('コードが無ければ null', () => {
    expect(extractOtpCode('平素よりウラカタ予約をご利用いただきありがとうございます。')).toBeNull();
  });

  it('関係ない数字（日付等）は拾わない', () => {
    expect(extractOtpCode('2026年7月27日にリリースします')).toBeNull();
  });
});

describe('waitForOtpCode', () => {
  const mail = (receivedAt: Date, text: string): OtpMailRecord => ({ receivedAt, text });

  it('since 以降のメールからコードを返す', async () => {
    const since = new Date('2026-07-29T00:00:00Z');
    const fetcher = async () => [
      mail(new Date('2026-07-28T23:00:00Z'), '■認証コード：111111'), // since より前 → 無視
      mail(new Date('2026-07-29T00:01:00Z'), '■認証コード：222222'),
    ];
    await expect(waitForOtpCode(fetcher, since, { timeoutMs: 100, intervalMs: 1 })).resolves.toBe('222222');
  });

  it('時計ズレ対策: since より90秒以内に古いメールは受け入れる（2026-07-29の本番障害の再現）', async () => {
    // ランナーの時計が進んでいると、ログイン直後に届いたメールが since より「過去」になる
    const since = new Date('2026-07-28T16:11:51Z');
    const fetcher = async () => [
      mail(new Date('2026-07-28T16:11:30Z'), '■認証コード：378353'), // since の21秒前
    ];
    await expect(waitForOtpCode(fetcher, since, { timeoutMs: 100, intervalMs: 1 })).resolves.toBe('378353');
  });

  it('猶予90秒を大きく超える古いメールは無視する', async () => {
    const since = new Date('2026-07-29T00:00:00Z');
    const fetcher = async (): Promise<OtpMailRecord[]> => [
      mail(new Date('2026-07-28T23:50:00Z'), '■認証コード：999999'), // 10分前
    ];
    await expect(waitForOtpCode(fetcher, since, { timeoutMs: 20, intervalMs: 1 })).rejects.toThrow(/届きません/);
  });

  it('複数あれば最新のメールを優先する', async () => {
    const since = new Date('2026-07-29T00:00:00Z');
    const fetcher = async () => [
      mail(new Date('2026-07-29T00:01:00Z'), '■認証コード：333333'),
      mail(new Date('2026-07-29T00:05:00Z'), '■認証コード：444444'),
    ];
    await expect(waitForOtpCode(fetcher, since, { timeoutMs: 100, intervalMs: 1 })).resolves.toBe('444444');
  });

  it('届くまでポーリングして待つ', async () => {
    const since = new Date('2026-07-29T00:00:00Z');
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return calls < 3 ? [] : [mail(new Date('2026-07-29T00:01:00Z'), '■認証コード：555555')];
    };
    await expect(waitForOtpCode(fetcher, since, { timeoutMs: 1000, intervalMs: 1 })).resolves.toBe('555555');
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('時間内に届かなければ日本語メッセージで例外', async () => {
    const since = new Date('2026-07-29T00:00:00Z');
    const fetcher = async (): Promise<OtpMailRecord[]> => [];
    await expect(waitForOtpCode(fetcher, since, { timeoutMs: 20, intervalMs: 1 })).rejects.toThrow(/認証コード.*届きません/);
  });
});
