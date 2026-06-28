// 履歴(2015〜)スイープは重く、ウラカタ側の504を招くため毎回は実行しない。
// 「JSTの特定時刻(hour)に走った同期だけ履歴を取得する」ゲートを提供する純粋関数群。

/**
 * 履歴スイープを実行するJSTの時刻(hour 0-23)一覧を環境変数から解釈する。
 * - 未指定/空/全て無効 → 既定 [3]（深夜3時台＝低トラフィック）
 * - "3,15" のようなカンマ区切りに対応。0〜23以外や非数値は除外。
 */
export function parseHistoryHours(raw: string | undefined): number[] {
  const hours = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && /^\d+$/.test(s))
    .map((s) => Number(s))
    .filter((n) => n >= 0 && n <= 23);
  return hours.length > 0 ? hours : [3];
}

/** 指定時刻(now)のJST hour が hoursJst に含まれるか。含まれれば履歴スイープを実行する。 */
export function shouldSyncHistory(now: Date, hoursJst: number[]): boolean {
  const jstHour = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
  return hoursJst.includes(jstHour);
}
