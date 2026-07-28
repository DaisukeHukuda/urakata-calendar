import { describe, it, expect } from 'vitest';
import { detectLoginStage } from '../src/fetcher.js';

describe('detectLoginStage', () => {
  it('パスワード入力欄がある → loginForm', () => {
    expect(detectLoginStage('ログインID\nパスワード\nログイン', true)).toBe('loginForm');
  });

  it('「認証コード」を含む → otp（パスワード欄が無くても）', () => {
    expect(detectLoginStage('認証コードを入力してください\nこのデバイスを信頼する', false)).toBe('otp');
  });

  it('メールアドレス登録画面 → registerEmail', () => {
    expect(detectLoginStage('2段階認証で使用するメールアドレスを登録してください', false)).toBe('registerEmail');
  });

  it('どれでもない（ダッシュボード） → loggedIn', () => {
    expect(detectLoginStage('予約一覧\nCSVダウンロード\nログアウト', false)).toBe('loggedIn');
  });

  it('本文に「パスワード」の文字があっても入力欄が無ければ loginForm にしない', () => {
    expect(detectLoginStage('パスワードの変更はこちら', false)).toBe('loggedIn');
  });
});
