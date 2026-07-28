import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import type { BrowserContext, Page } from 'playwright';

export interface FetchOptions {
  baseUrl: string; // 例 https://supsup.urkt.in/
  loginId: string;
  password: string;
  from: Date; // 参加日 from
  to: Date; // 参加日 to
  statuses: string[]; // 例 ['fixed', 'temporary_fixed']
  otpProvider?: OtpProvider; // OTP画面遭遇時にメールから認証コードを取得する（未設定なら明示エラー）
  storageStatePath?: string; // ログイン状態(storageState)の保存先（未設定なら保存しない）
}

// 実機（2026-06-18）で確認したウラカタ検索のクエリパラメータ名
const ENTRY_DATE_START_PARAM = 'entry_date_start';
const ENTRY_DATE_END_PARAM = 'entry_date_end';

// サーバーのタイムゾーンに依存せず、JST(+09:00)のカレンダー日付を YYYY-MM-DD で返す
export function fmtDateJst(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * [from, to] を暦年（JST基準）ごとの { from, to } レンジ配列に分割する純粋関数。
 * - 最初のレンジは from 〜 その年の 12/31、中間は各年の 1/1〜12/31、最後は その年の 1/1〜to。
 * - from と to が同年なら 1 要素 [{ from, to }]。
 * - 返す Date は fmtDateJst に通すと正しい JST 日付になる値（各年 1/1 00:00 JST = Date.UTC(y,0,1,-9) 相当）。
 */
export function yearlyRanges(from: Date, to: Date): { from: Date; to: Date }[] {
  // 年の境界判定は JST で行う（fmtDateJst と同じ +9h オフセット）
  const fromYear = new Date(from.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
  const toYear = new Date(to.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();

  // 各年 1/1 00:00 JST に相当する Date
  const jan1Jst = (y: number): Date => new Date(Date.UTC(y, 0, 1, -9, 0, 0));
  // 各年 12/31 00:00 JST に相当する Date（fmtDateJst で YYYY-12-31 になる）
  const dec31Jst = (y: number): Date => new Date(Date.UTC(y, 11, 31, -9, 0, 0));

  const ranges: { from: Date; to: Date }[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    const rFrom = y === fromYear ? from : jan1Jst(y);
    const rTo = y === toYear ? to : dec31Jst(y);
    ranges.push({ from: rFrom, to: rTo });
  }
  return ranges;
}

function buildCsvUrl(o: FetchOptions): string {
  const u = new URL('reservations/search.csv', o.baseUrl);
  for (const s of o.statuses) u.searchParams.append('reservation_statuses[]', s);
  u.searchParams.set(ENTRY_DATE_START_PARAM, fmtDateJst(o.from));
  u.searchParams.set(ENTRY_DATE_END_PARAM, fmtDateJst(o.to));
  return u.toString();
}

// ログインに必要な認証情報（from/to なしの FetchOptions サブセット）
type LoginCreds = Pick<FetchOptions, 'baseUrl' | 'loginId' | 'password' | 'otpProvider' | 'storageStatePath'>;

/** OTP画面で認証コードを取ってくる関数（実装は otp-mail.ts。main.ts で結線） */
export type OtpProvider = (since: Date) => Promise<string>;

export type LoginStage = 'loggedIn' | 'loginForm' | 'otp' | 'registerEmail';

/**
 * 画面テキストとパスワード欄の有無からログインフローのどの段階かを判定する（純関数）。
 * 判定順序が重要: OTP画面・メール登録画面にも「ログイン」等の語が含まれうるため、
 * 特徴的な文言（認証コード→メールアドレス登録）を先に見る。
 */
export function detectLoginStage(pageText: string, hasPasswordField: boolean): LoginStage {
  const t = pageText.replace(/\s+/g, '');
  if (t.includes('認証コード')) return 'otp';
  if (t.includes('メールアドレス') && t.includes('登録')) return 'registerEmail';
  if (hasPasswordField) return 'loginForm';
  return 'loggedIn';
}

/** 現在のページの段階を判定する（DOM問い合わせ込み） */
async function currentStage(page: Page): Promise<LoginStage> {
  const text = await page.locator('body').innerText();
  const hasPasswordField = (await page.locator('input[type="password"]').count()) > 0;
  return detectLoginStage(text, hasPasswordField);
}

interface LoginDeps {
  otpProvider?: OtpProvider;
}

/**
 * ウラカタにログインする（2段階認証対応）。
 * - storageState 復元などで既ログインなら何もしない
 * - ID/PW送信後にOTP画面が出たら、「このデバイスを信頼する」をチェックし、
 *   otpProvider でメールから認証コードを取得して入力する（30日間はOTP免除になる）
 * - メールアドレス未登録画面なら、手動登録を促す日本語メッセージで fail-loud
 */
async function loginUrakata(page: Page, o: LoginCreds, deps: LoginDeps = {}): Promise<void> {
  await page.goto(o.baseUrl, { waitUntil: 'networkidle' });
  let stage = await currentStage(page);
  if (stage === 'loggedIn') {
    console.log('[fetcher] 保存済みログイン状態で認証済み（OTPなし）');
    return;
  }
  if (stage === 'otp') {
    // 復元した状態が「認証コード入力待ち」に巻き戻されている（別マシンからのアクセスで
    // セッションが格下げされた等）。ID/PWを送信していないので新しいコードは飛んでこない。
    // この状態は使えないため例外にし、呼び出し側(withAuthedContext)の状態破棄→再ログインに任せる。
    throw new Error('保存済みログイン状態が無効になっています（認証コード入力を要求された）');
  }

  if (stage === 'loginForm') {
    // OTPメールはログイン送信時に発射されるため、送信直前の時刻を since にする
    const otpRequestedAt = new Date();
    await page.getByLabel('ログインID').fill(o.loginId);
    await page.getByLabel('パスワード').fill(o.password);
    await Promise.all([
      page.waitForLoadState('networkidle'),
      page.getByRole('button', { name: 'ログイン' }).click(),
    ]);
    stage = await currentStage(page);
    if (stage === 'otp') {
      await completeOtp(page, otpRequestedAt, deps);
      stage = await currentStage(page);
    }
  }

  if (stage === 'registerEmail') {
    throw new Error(
      '2段階認証のメールアドレスが未登録です。ブラウザでウラカタに一度手動ログインし、認証用メールアドレス（supsupnikko@gmail.com）を登録してください。',
    );
  }
  if (stage !== 'loggedIn') {
    throw new Error('ウラカタのログインに失敗しました（ログインID/パスワード/認証コードを確認してください）');
  }
}

/** OTP画面: 信頼チェック → メールからコード取得 → 入力 → 送信 */
async function completeOtp(page: Page, since: Date, deps: LoginDeps): Promise<void> {
  if (!deps.otpProvider) {
    throw new Error(
      '認証コードの入力が必要ですが、OTPメール自動読取が未設定です（OTP_IMAP_USER / OTP_IMAP_PASSWORD を設定してください）',
    );
  }

  // 「このデバイスを信頼する」にチェック（30日間OTP免除）。ラベルで見つからなければ
  // 画面上に唯一のチェックボックスがある場合のみそれを使う。見つからなくても続行。
  // どの経路になったかは運用ログで判別できるよう必ず出力する（信頼が効かない原因調査用）。
  const trustByLabel = page.getByLabel(/このデバイスを信頼/);
  if ((await trustByLabel.count()) > 0) {
    await trustByLabel.first().check().catch(() => {/* チェック不可でも続行 */});
    console.log('[fetcher] 「このデバイスを信頼する」をチェックしました');
  } else {
    const checkboxes = page.locator('input[type="checkbox"]');
    if ((await checkboxes.count()) === 1) {
      await checkboxes.first().check().catch(() => {/* チェック不可でも続行 */});
      console.log('[fetcher] 信頼チェックボックス（ラベル不一致・唯一のcheckbox）をチェックしました');
    } else {
      console.warn(`[fetcher] 信頼チェックボックスが見つかりません（checkbox数=${await checkboxes.count()}）。毎回OTPになる可能性`);
    }
  }

  const code = await deps.otpProvider(since);
  console.log('[fetcher] OTP認証コードをメールから取得して入力します');

  // コード入力欄: ラベル→種別の順で探す
  const byLabel = page.getByLabel(/認証コード/);
  const codeInput = (await byLabel.count()) > 0
    ? byLabel.first()
    : page.locator('input[type="text"], input[type="tel"], input[type="number"]').first();
  await codeInput.fill(code);

  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.getByRole('button', { name: /認証|確認|送信|ログイン/ }).first().click(),
  ]);
}

// 取得したCSV本文が想定どおりか検証する（ヘッダ「予約ID」の存在）。
function assertCsvBody(body: string): void {
  if (!body.includes('予約ID')) {
    throw new Error(
      'CSVの内容が想定と異なります（ヘッダ「予約ID」が見つかりません）。ログイン切れの可能性があります。',
    );
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 認証済み BrowserContext を用意して fn を実行する共通処理。
 * - storageStatePath があり保存済み state があれば復元して使う（既ログイン→OTP不要）
 * - ログイン成功後に state を保存する（信頼デバイスCookieを次回実行へ引き継ぐ）
 * - 保存済み state 使用時に fn が失敗（=実は未ログインでCSV検証NG等）なら、
 *   state を破棄してフルログインで1回だけやり直す（30日期限切れの自動復旧）
 */
async function withAuthedContext<T>(
  o: LoginCreds,
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const statePath = o.storageStatePath;

  const attempt = async (useSavedState: boolean): Promise<T> => {
    const browser = await chromium.launch();
    try {
      const restore = useSavedState && statePath !== undefined && existsSync(statePath);
      const context = await browser.newContext(restore ? { storageState: statePath } : {});
      const page = await context.newPage();
      await loginUrakata(page, o, { otpProvider: o.otpProvider });
      if (statePath !== undefined) {
        mkdirSync(dirname(statePath), { recursive: true });
        await context.storageState({ path: statePath });
      }
      return await fn(context);
    } finally {
      await browser.close();
    }
  };

  const hadSavedState = statePath !== undefined && existsSync(statePath);
  try {
    return await attempt(true);
  } catch (e) {
    if (!hadSavedState) throw e;
    console.warn(`[fetcher] 保存済みログイン状態で失敗したため、状態を破棄して再ログインします: ${(e as Error).message}`);
    rmSync(statePath!, { force: true });
    return await attempt(false);
  }
}

/**
 * ウラカタにログインし、指定範囲の予約CSV本文を返す。
 * ログイン失敗・CSV取得失敗・想定外レスポンス時は例外を投げる（空文字は返さない）。
 */
export async function fetchReservationsCsv(o: FetchOptions): Promise<string> {
  return withAuthedContext(o, async (context) => {
    const csvUrl = buildCsvUrl(o);
    // 履歴(2015〜)CSVは大きいためタイムアウトを延長（既定30秒→2分）
    const resp = await context.request.get(csvUrl, { timeout: 120000 });
    if (!resp.ok()) {
      throw new Error(`CSV取得に失敗しました: HTTP ${resp.status()} ${csvUrl}`);
    }
    const body = await resp.text();
    assertCsvBody(body);
    return body;
  });
}

/**
 * ログインは1回だけ行い、認証済み context を使い回して複数レンジのCSV本文を取得する。
 * 一括取得が重く 504 を招くため、履歴(2015〜)取得を暦年レンジ等に分割する用途で使う。
 * 各レンジ取得は失敗時（resp が ok でない／例外）に最大 retries 回まで指数バックオフ的に再試行する。
 * 全リトライ失敗ならそのレンジで例外を投げる。
 */
export async function fetchReservationsCsvRanges(
  base: Omit<FetchOptions, 'from' | 'to'>,
  ranges: { from: Date; to: Date }[],
  opts?: { retries?: number },
): Promise<string[]> {
  const retries = opts?.retries ?? 2;
  return withAuthedContext(base, async (context) => {
    const bodies: string[] = [];
    for (const range of ranges) {
      const csvUrl = buildCsvUrl({ ...base, from: range.from, to: range.to });
      let lastErr: unknown;
      let body: string | undefined;
      // 初回 + retries 回まで試行（指数バックオフ的に少し待つ）
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s, ...
        try {
          const resp = await context.request.get(csvUrl, { timeout: 120000 });
          if (!resp.ok()) {
            throw new Error(`CSV取得に失敗しました: HTTP ${resp.status()} ${csvUrl}`);
          }
          const text = await resp.text();
          assertCsvBody(text);
          body = text;
          lastErr = undefined;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (body === undefined) throw lastErr;
      bodies.push(body);
    }
    return bodies;
  });
}
