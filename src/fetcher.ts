import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';

export interface FetchOptions {
  baseUrl: string; // 例 https://supsup.urkt.in/
  loginId: string;
  password: string;
  from: Date; // 参加日 from
  to: Date; // 参加日 to
  statuses: string[]; // 例 ['fixed', 'temporary_fixed']
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
type LoginCreds = Pick<FetchOptions, 'baseUrl' | 'loginId' | 'password'>;

/**
 * ウラカタにログインする（ラベルベースの頑健なロケータ。ログアウト時はベースURLがログイン画面）。
 * ログイン失敗時は例外を投げる。成功時は同一 context の request が認証済みになる。
 */
async function loginUrakata(page: Page, o: LoginCreds): Promise<void> {
  await page.goto(o.baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('ログインID').fill(o.loginId);
  await page.getByLabel('パスワード').fill(o.password);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.getByRole('button', { name: 'ログイン' }).click(),
  ]);

  // ログイン成功検証: 成功するとパスワード欄が消える。残っていれば失敗。
  if ((await page.getByLabel('パスワード').count()) > 0) {
    throw new Error(
      'ウラカタのログインに失敗しました（ログインID/パスワードを確認してください）',
    );
  }
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
 * ウラカタにログインし、指定範囲の予約CSV本文を返す。
 * ログイン失敗・CSV取得失敗・想定外レスポンス時は例外を投げる（空文字は返さない）。
 */
export async function fetchReservationsCsv(o: FetchOptions): Promise<string> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    await loginUrakata(page, o);

    // --- 認証済みクッキーを共有する request コンテキストでCSVを取得 ---
    const csvUrl = buildCsvUrl(o);
    // 履歴(2015〜)CSVは大きいためタイムアウトを延長（既定30秒→2分）
    const resp = await context.request.get(csvUrl, { timeout: 120000 });
    if (!resp.ok()) {
      throw new Error(`CSV取得に失敗しました: HTTP ${resp.status()} ${csvUrl}`);
    }
    const body = await resp.text();
    assertCsvBody(body);
    return body;
  } finally {
    await browser?.close();
  }
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
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    await loginUrakata(page, base);

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
  } finally {
    await browser?.close();
  }
}
