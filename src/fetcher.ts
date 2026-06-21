import { chromium } from 'playwright';
import type { Browser } from 'playwright';

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
function fmtDateJst(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildCsvUrl(o: FetchOptions): string {
  const u = new URL('reservations/search.csv', o.baseUrl);
  for (const s of o.statuses) u.searchParams.append('reservation_statuses[]', s);
  u.searchParams.set(ENTRY_DATE_START_PARAM, fmtDateJst(o.from));
  u.searchParams.set(ENTRY_DATE_END_PARAM, fmtDateJst(o.to));
  return u.toString();
}

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

    // --- ログイン（ラベルベースの頑健なロケータ。ログアウト時はベースURLがログイン画面） ---
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

    // --- 認証済みクッキーを共有する request コンテキストでCSVを取得 ---
    const csvUrl = buildCsvUrl(o);
    // 履歴(2015〜)CSVは大きいためタイムアウトを延長（既定30秒→2分）
    const resp = await context.request.get(csvUrl, { timeout: 120000 });
    if (!resp.ok()) {
      throw new Error(`CSV取得に失敗しました: HTTP ${resp.status()} ${csvUrl}`);
    }
    const body = await resp.text();
    if (!body.includes('予約ID')) {
      throw new Error(
        'CSVの内容が想定と異なります（ヘッダ「予約ID」が見つかりません）。ログイン切れの可能性があります。',
      );
    }
    return body;
  } finally {
    await browser?.close();
  }
}
