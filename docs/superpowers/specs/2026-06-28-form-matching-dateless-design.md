# フォーム照合の日付非依存化 設計書

作成日: 2026-06-28

## 背景・目的

同意書／緊急連絡フォームの記入状況（✓）照合が、**お客様がフォームに入力した「参加日」を必須キー**にしているため、日付の打ち間違いで一致しない取りこぼしが発生している。

実例（緊急連絡シート、本番データで確認）:

| 氏名 | フォーム入力の参加日 | 実際の予約日 | 不一致の内容 |
|---|---|---|---|
| 藤本久子 | 2028/09/06 | 2026/09/06 | 年の打ち間違い（2028）|
| 若林功太 | 2026/08/01 | 2026/07/18 | 別日 |
| 磯村崇之 | 2026/07/19 | 2026/07/18 | 1日ずれ |

加えて、磯村の電話番号がフォームに**全角数字**（`０９０…`）で入力されており、現行の `normPhone`（`[^0-9]` 除去）では全角数字も消えてしまい電話照合も効かない。

**ゴール**: お客様の参加日入力が誤っていても、**電話番号 OR 氏名**で予約を特定して ✓ を付ける。参加日は「同一人物が複数予約を持つときにどれかを選ぶヒント」としてのみ使う。全角入力でも壊れないようにする。

## 現状

`sync/src/forms.ts`:
- `parseFormResponses(values, cfg)` → 回答シートを **参加日をキーにした Map**（`Map<date, {names, phones}>`）へ索引化。
- `matchForms(reservations, consent, emergency)` → 予約ごとに `consent.get(d)` / `emergency.get(d)`（`d = jstDateOf(rv.start)`）を引き、`entryMatches` で電話 or 氏名一致を見る。**日付が一致しないと弾かれる**。
- 正規化: `normName`（空白除去）, `normPhone`（数字以外除去）, `normDate`（YYYY-MM-DD抽出）。
- 列特定: `CONSENT_CFG` / `EMERGENCY_CFG`（キーワードで日付・氏名・電話の列を検出）。
- `main.ts` が `parseFormResponses` → `matchForms` → `publishForms` を呼ぶ。出力は `forms:latest = Record<reservationId, {consent, emergency}>`（web が読む形）。

## 設計

外部I/O（`forms:latest` の形・列検出キーワード・読み取り専用のシート運用）は変更しない。`sync/src/forms.ts` 内部の解析・照合と正規化のみ変更する。

### 1. 正規化に NFKC を追加

```ts
export function normPhone(s: string): string {
  return (s ?? '').normalize('NFKC').replace(/[^0-9]/g, '');
}
export function normName(s: string): string {
  return (s ?? '').normalize('NFKC').replace(/[\s　]/g, '');
}
```

- 効果: 全角数字 `０９０…` → `090…`（磯村の電話が一致）。半角カナ→全角カナ等の互換分解で氏名/カナ照合も頑健化。
- `normDate` は現状維持（半角の `YYYY/MM/DD` 形式で十分）。

### 2. 解析を「日付キー Map」から「回答リスト」へ

`parseFormResponses` の戻り値を **回答の配列**に変更する。

```ts
export interface FormResponse { date: string; names: string[]; phones: Set<string> }
export function parseFormResponses(values, cfg): FormResponse[]
```

- ヘッダから日付列・氏名列（複数可）・電話列（複数可）を現行同様キーワード検出。
- 各データ行を1 `FormResponse` にする: `date = normDate(行の日付列)`（読めなければ空文字）、`names = 各氏名列の normName`（非空のみ）、`phones = 各電話列の normPhone`（非空のみ）。
- `names` も `phones` も空の行はスキップ（情報がない行）。

### 3. 照合を「割り当て方式」に変更（`matchForms`）

```ts
export function matchForms(
  reservations: { reservationId: string; start: Date; customerName: string; customerKana?: string; phone?: string }[],
  consent: FormResponse[],
  emergency: FormResponse[],
): Record<string, FormStatus>
```

各シート（consent / emergency）について独立に、回答を予約へ割り当てる:

1. 予約ごとに照合キーを用意: `cands = [normName(customerName), normName(customerKana)]`(非空), `phone = normPhone(reservation.phone)`, `rdate = jstDateOf(start)`。
2. 各 `FormResponse` `f` について、**一致する予約**を求める（日付は条件にしない）:
   - 電話一致: `f.phones` と予約の `phone` が一致（両方非空）、OR
   - 氏名一致: `f.names` のいずれか `n` と予約の `cands` のいずれか `c` が `n.includes(c) || c.includes(n)`（両方非空）。
3. 一致した予約集合 `M` に対し:
   - `M` が空 → その回答は無視（提出者に対象期間の予約なし）。
   - `M` が1件 → その予約に `f` を割り当て。
   - `M` が複数 → `f.date` が読めれば **`f.date` と各予約 `rdate` の日数差が最小**の予約1件に割り当て（同点なら先頭）。`f.date` が空なら `M` 全件に割り当て（曖昧で選べないため取りこぼし回避優先）。
4. 予約の状態: `consent[id] = (consent回答が1つ以上割り当てられた)`、`emergency[id] = (emergency回答が1つ以上割り当てられた)`。

日数差は `YYYY-MM-DD` を `Date.parse` し絶対差で比較する純粋関数 `dayDiff(a, b)` を用意。

### 4. `main.ts` の呼び出し更新

`parseFormResponses` の戻り値が配列になったため、`matchForms(webReservations, consent, emergency)` の引数はそのまま（型だけ `FormResponse[]`）。`main.ts` 側のロジック変更は最小（型の整合のみ）。

## データフロー

```
回答シート(values) ──parseFormResponses──▶ FormResponse[]
予約(webReservations) ─┐
                       ├─ matchForms（電話/氏名で一致→近い日付で割り当て）─▶ Record<id,{consent,emergency}>
FormResponse[](consent/emergency)─┘                                           │
                                                              publishForms ──▶ forms:latest（形は不変）
```

## エッジケース

- 全角数字/全角空白/半角カナ → NFKCで正規化。
- 参加日が誤り（別日・年違い 2028 等）→ 電話/氏名一致で救済、日付は割り当て選別のみ。
- 回答が予約に一致しない → 無視（✓に影響なし）。
- 同一人物が複数予約＋回答1枚 → 回答日付に最も近い予約へ1件だけ割り当て（過剰✓を防止）。
- 国際表記 `+81 70…` のプレフィックス差 → **今回は対象外**（必要になれば別途）。

## テスト（TDD・純粋関数中心）

`sync/test/forms.test.ts` を新方式へ更新し、最低限:

- `normPhone`: `'０９０２５５９８０４１'` → `'09025598041'`、`'090-1352-7617'` → `'09013527617'`。
- `normName`: 全角空白除去＋NFKC（半角カナ→全角カナで一致）。
- `parseFormResponses`: ヘッダ検出＋各行が `{date, names, phones}` になる。日付欄が空でも `names/phones` があれば残る。
- `matchForms` 割り当て:
  - 単一一致（電話のみ一致）で ✓。
  - 氏名のみ一致（電話空）で ✓。
  - **実データ3件**: 藤本(日付2028/09/06・電話一致)、若林(日付08/01・電話一致)、磯村(全角電話・日付07/19)が emergency ✓ になる。
  - 複数予約一致時、回答日付に近い方1件だけに付く（他方は付かない）。
  - 一致ゼロの回答は無視。
- `dayDiff` の純粋関数テスト（同日0、跨ぎの絶対差）。

## 非対象（YAGNI）

- 回答シート自体の日付の自動書き換え（読み取り専用運用を維持）。
- 国際電話プレフィックスの正規化。
- 列検出キーワードの変更（現行のままで足りる）。
