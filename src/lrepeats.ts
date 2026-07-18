// ホテル(L)予約の「リピーターの可能性」判定（同名一致による可能性表示）の純粋関数群。
// L予約は本人電話での確実な照合ができないため、名前の正規化キー(nameKey)が一致した
// 過去の参加履歴の件数を「可能性」として返す（断定はしない）。I/Oは持たない。

export interface LRepeatEntry {
  count: number;
  last?: string;
}

// 区切り文字: 半角/全角スペース・读点・句点等の揺れを吸収する（\s は全角スペースU+3000も含む）
const SEPARATOR_RE = /[\s,、，.．・]+/u;
// ひらがな(ぁ-ゖ = U+3041-U+3096) → カタカナ(ァ-ヶ) はコードポイントを0x60シフトするだけで変換できる
const HIRAGANA_RE = /[ぁ-ゖ]/g;

/**
 * 名前を「表記揺れに強い比較キー」へ正規化する。
 * NFKC正規化(全角英数字→半角等) → 小文字化 → ひらがな→カタカナ統一
 * → 区切り文字でトークン分割・空要素除去 → トークンをソートして`|`連結。
 *
 * 例: "Mori, Masahiko" と "masahiko mori"、"もり まさひこ" と "モリ　マサヒコ" は同じキーになる。
 * 空入力・区切り文字のみの入力は ''。
 */
export function nameKey(name: string): string {
  const normalized = name.normalize('NFKC').toLowerCase();
  const katakana = normalized.replace(HIRAGANA_RE, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  const tokens = katakana.split(SEPARATOR_RE).filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  return [...tokens].sort().join('|');
}

/**
 * 履歴(コース不問・全参加履歴)を名前キーごとの参加日集合に集約し、現在のL予約それぞれについて
 * 「予約日より前の同名参加日数」を数える。count>=1のもののみを予約IDキーで返す。
 * 名前が空("" = nameKeyが''になる)エントリは履歴側・現在L側どちらも無視する。
 */
export function buildLRepeatMap(
  historyEntries: { name: string; date: string }[],
  currentL: { reservationId: string; name: string; date: string }[],
): Record<string, LRepeatEntry> {
  const byKey = new Map<string, Set<string>>();
  for (const h of historyEntries) {
    const key = nameKey(h.name);
    if (!key) continue;
    let dates = byKey.get(key);
    if (!dates) { dates = new Set<string>(); byKey.set(key, dates); }
    dates.add(h.date);
  }

  const out: Record<string, LRepeatEntry> = {};
  for (const cur of currentL) {
    const key = nameKey(cur.name);
    if (!key) continue;
    const dates = byKey.get(key);
    if (!dates) continue;
    const prior = [...dates].filter((d) => d < cur.date).sort();
    if (prior.length === 0) continue;
    out[cur.reservationId] = { count: prior.length, last: prior[prior.length - 1] };
  }
  return out;
}
