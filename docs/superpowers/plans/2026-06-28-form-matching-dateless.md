# フォーム照合の日付非依存化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同意書／緊急連絡フォームの照合を「参加日の完全一致」必須から、「電話 OR 氏名で予約を特定し、日付は同一人物の複数予約の選別にのみ使う」方式へ変え、全角入力でも壊れないようにする。

**Architecture:** `sync/src/forms.ts` 内部のみ変更。①正規化に `NFKC` を追加、②`parseFormResponses` を日付キー Map から `FormResponse[]`（回答リスト）に変更、③`matchForms` を「回答→予約への割り当て（電話/氏名一致、複数一致は回答日付に最も近い予約へ1件）」へ書き換え。`forms:latest` の出力形・web側・列検出キーワードは不変。`main.ts` は呼び出し文不変（型が流れるだけ）。

**Tech Stack:** TypeScript (ESM, .js import specifiers) / vitest。

設計書: `sync/docs/superpowers/specs/2026-06-28-form-matching-dateless-design.md`

---

### Task 1: 正規化に NFKC を追加（全角対応）

**Files:**
- Modify: `src/forms.ts:10-15`（`normName` / `normPhone`）
- Test: `test/forms.test.ts`（`normalizers` describe に追記）

- [ ] **Step 1: 失敗するテストを追記**

`test/forms.test.ts` の `describe('normalizers', ...)` 内、既存 `it('normName 空白除去 / normPhone 数字のみ', ...)` の直後に次の `it` を追加:
```ts
  it('NFKC: 全角数字・半角カナを正規化', () => {
    expect(normPhone('０９０２５５９８０４１')).toBe('09025598041'); // 全角数字
    expect(normPhone('090 1352 7617')).toBe('09013527617');       // 半角空白
    expect(normName('ﾏﾔﾊｼ ﾕｲ')).toBe('マヤハシユイ');               // 半角カナ→全角＋空白除去
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd sync && npx vitest run test/forms.test.ts -t NFKC`
Expected: FAIL（`normPhone('０９０…')` が `''` になる＝全角数字が除去される）

- [ ] **Step 3: 実装（NFKC を先頭に追加）**

`src/forms.ts` の `normName` / `normPhone` を次に置き換え:
```ts
export function normName(s: string): string {
  return (s ?? '').normalize('NFKC').replace(/[\s　]/g, '');
}
export function normPhone(s: string): string {
  return (s ?? '').normalize('NFKC').replace(/[^0-9]/g, '');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd sync && npx vitest run test/forms.test.ts`
Expected: PASS（既存の normalizers テストも含め全部）

- [ ] **Step 5: Commit**

```bash
cd sync && git add src/forms.ts test/forms.test.ts
git commit -m "fix(forms): 正規化にNFKCを追加し全角数字/半角カナに対応"
```

---

### Task 2: 解析を回答リスト化 + 照合を割り当て方式へ

`parseFormResponses` の戻り型と `matchForms` は連動するため一括で変更する。`FormIndexEntry` と旧 `entryMatches` は廃止し、`FormResponse` と `dayDiff` を追加する。

**Files:**
- Modify: `src/forms.ts:28-80`（`FormIndexEntry`, `parseFormResponses`, `entryMatches`, `matchForms`）
- Test: `test/forms.test.ts`（`parseFormResponses` と `matchForms` の describe を全面更新）

- [ ] **Step 1: 新しいテストに置き換え**

`test/forms.test.ts` の `describe('parseFormResponses…')` ブロックと `describe('matchForms…')` ブロックを、まるごと次に置き換える（`describe('normalizers'…)` は残す）:
```ts
describe('parseFormResponses（回答リストを返す）', () => {
  it('同意書: 1行を {date,names,phones} に。カナ氏名も names に入る', () => {
    const values = [
      ['タイムスタンプ', '日付（プラン参加日）', 'ご氏名（漢字フルネーム）', 'カナ氏名'],
      ['x', '2026/06/28', '厩橋 由衣', 'マヤハシ ユイ'],
    ];
    const list = parseFormResponses(values, CONSENT_CFG);
    expect(list).toHaveLength(1);
    expect(list[0].date).toBe('2026-06-28');
    expect(list[0].names).toContain('厩橋由衣');
    expect(list[0].names).toContain('マヤハシユイ');
    expect(list[0].phones.size).toBe(0);
  });
  it('緊急連絡先: 携帯番号のみ拾い、緊急連絡先電話は拾わない', () => {
    const values = [
      ['タイムスタンプ', '参加者ご本人のお名前', '携帯番号（ハイフンなし）', '緊急連絡先の電話番号（ハイフンなし）', 'ツアー参加の日付'],
      ['x', '厩橋 由衣', '09019048832', '09020100359', '2026/06/28'],
    ];
    const list = parseFormResponses(values, EMERGENCY_CFG);
    expect(list).toHaveLength(1);
    expect(list[0].phones.has('09019048832')).toBe(true);
    expect(list[0].phones.has('09020100359')).toBe(false);
  });
  it('名前も電話も無い行はスキップ。日付欄が空でも名前があれば残す', () => {
    const values = [
      ['タイムスタンプ', '参加者ご本人のお名前', '携帯番号（ハイフンなし）', 'ツアー参加の日付'],
      ['x', '', '', ''],                       // 全部空 → スキップ
      ['x', '田中太郎', '', ''],                // 日付空でも名前あり → 残す
    ];
    const list = parseFormResponses(values, EMERGENCY_CFG);
    expect(list).toHaveLength(1);
    expect(list[0].date).toBe('');
    expect(list[0].names).toContain('田中太郎');
  });
});

describe('dayDiff', () => {
  it('同日は0、跨ぎは絶対日数', () => {
    expect(dayDiff('2026-07-18', '2026-07-18')).toBe(0);
    expect(dayDiff('2026-07-18', '2026-07-19')).toBe(1);
    expect(dayDiff('2026-08-15', '2026-07-18')).toBe(28);
  });
});

describe('matchForms（電話 OR 氏名・日付は割り当て選別のみ）', () => {
  const consent = parseFormResponses([
    ['ts', '日付', 'ご氏名', 'カナ氏名'],
    ['x', '2026/06/28', '厩橋 由衣', 'マヤハシ ユイ'],
  ], CONSENT_CFG);
  const emergency = parseFormResponses([
    ['ts', '参加者ご本人のお名前', '携帯番号', 'ツアー参加の日付'],
    ['x', '厩橋 由衣', '09019048832', '2026/06/28'],
  ], EMERGENCY_CFG);

  it('カナのみ一致で同意書 true', () => {
    const r = matchForms(
      [{ reservationId: 'a', start: new Date('2026-06-28T10:00:00+09:00'), customerName: 'マヤハシ ユイ', customerKana: 'マヤハシ ユイ', phone: '' }],
      consent, emergency,
    );
    expect(r['a'].consent).toBe(true);
  });
  it('電話一致で緊急 true（氏名が合わなくても）', () => {
    const r = matchForms(
      [{ reservationId: 'b', start: new Date('2026-06-28T10:00:00+09:00'), customerName: 'Mayahashi', customerKana: 'マヤハシ ユイ', phone: '090-1904-8832' }],
      consent, emergency,
    );
    expect(r['b'].emergency).toBe(true);
  });
  it('日付が違っても電話/氏名一致なら true（旧仕様からの変更点）', () => {
    const r = matchForms(
      [{ reservationId: 'd', start: new Date('2026-07-01T10:00:00+09:00'), customerName: '厩橋 由衣', customerKana: 'マヤハシ ユイ', phone: '090-1904-8832' }],
      consent, emergency,
    );
    expect(r['d']).toEqual({ consent: true, emergency: true });
  });
  it('一致する回答が無ければ false', () => {
    const r = matchForms(
      [{ reservationId: 'z', start: new Date('2026-06-28T10:00:00+09:00'), customerName: '別人', customerKana: 'ベツジン', phone: '08000000000' }],
      consent, emergency,
    );
    expect(r['z']).toEqual({ consent: false, emergency: false });
  });
  it('実データ: 日付ズレ/年違い/全角電話でも緊急 true', () => {
    const em = parseFormResponses([
      ['ts', '参加者ご本人のお名前（漢字フルネーム）', '参加者ご本人のお名前（カタカナ フルネーム）', '携帯番号（ハイフンなし）', '緊急連絡先の電話番号（ハイフンなし）', 'ツアー参加の日付'],
      ['x', '藤本　久子', 'フジモトヒサコ', '09093122407', '090 5319 2144', '2028/09/06'],
      ['x', '若林功太', 'ワカバヤシコウタ', '07075675718', '090 1352 7617', '2026/08/01'],
      ['x', '磯村　崇之', 'イソムラ　タカユキ', '０９０２５５９８０４１', '０４８－８７２－７８９３', '2026/07/19'],
    ], EMERGENCY_CFG);
    const r = matchForms([
      { reservationId: 'fuji', start: new Date('2026-09-06T10:00:00+09:00'), customerName: '藤本　久子', customerKana: 'フジモト　ヒサコ', phone: '09093122407' },
      { reservationId: 'waka', start: new Date('2026-07-18T10:00:00+09:00'), customerName: '若林功太', customerKana: 'ワカバヤシコウタ', phone: '07075675718' },
      { reservationId: 'iso',  start: new Date('2026-07-18T10:00:00+09:00'), customerName: '磯村　崇之', customerKana: 'イソムラ　タカユキ', phone: '09025598041' },
    ], [], em);
    expect(r['fuji'].emergency).toBe(true);
    expect(r['waka'].emergency).toBe(true);
    expect(r['iso'].emergency).toBe(true);
  });
  it('同一人物の複数予約は回答日付に近い1件だけに付く', () => {
    const c = parseFormResponses([
      ['ts', '日付', 'ご氏名', 'カナ氏名'],
      ['x', '2026/07/18', '山田太郎', 'ヤマダタロウ'],
    ], CONSENT_CFG);
    const r = matchForms([
      { reservationId: 'r1', start: new Date('2026-07-18T10:00:00+09:00'), customerName: '山田太郎', customerKana: 'ヤマダタロウ', phone: '08011112222' },
      { reservationId: 'r2', start: new Date('2026-08-15T10:00:00+09:00'), customerName: '山田太郎', customerKana: 'ヤマダタロウ', phone: '08011112222' },
    ], c, []);
    expect(r['r1'].consent).toBe(true);
    expect(r['r2'].consent).toBe(false);
  });
});
```

- [ ] **Step 2: import を更新**

`test/forms.test.ts` 先頭の import に `dayDiff` を追加（`FormResponse` 型はテストで使わない）:
```ts
import { normDate, normName, normPhone, parseFormResponses, matchForms, dayDiff, CONSENT_CFG, EMERGENCY_CFG } from '../src/forms.js';
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd sync && npx vitest run test/forms.test.ts`
Expected: FAIL（`dayDiff` 未export、`parseFormResponses` が配列でない 等のコンパイル/実行エラー）

- [ ] **Step 4: 実装（forms.ts の該当部を置き換え）**

`src/forms.ts` の `export interface FormIndexEntry …` 行から `export function matchForms(…) { … }` の閉じ括弧までを、次に置き換える:
```ts
export interface FormResponse { date: string; names: string[]; phones: Set<string> }

// 回答シートを「回答の配列」に変換。日付は任意項目として保持（照合の必須キーにはしない）。
export function parseFormResponses(
  values: string[][],
  cfg: { dateKeywords: string[]; nameKeywords: string[]; phoneKeywords: string[] },
): FormResponse[] {
  const out: FormResponse[] = [];
  if (!values.length) return out;
  const header = values[0];
  const dateIdx = colIndexes(header, cfg.dateKeywords)[0];
  const nameIdxs = colIndexes(header, cfg.nameKeywords);
  const phoneIdxs = colIndexes(header, cfg.phoneKeywords);
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const date = dateIdx === undefined ? '' : normDate(row[dateIdx] ?? '');
    const names: string[] = [];
    for (const ni of nameIdxs) { const nm = normName(row[ni] ?? ''); if (nm) names.push(nm); }
    const phones = new Set<string>();
    for (const pi of phoneIdxs) { const ph = normPhone(row[pi] ?? ''); if (ph) phones.add(ph); }
    if (!names.length && !phones.size) continue;
    out.push({ date, names, phones });
  }
  return out;
}

// 'YYYY-MM-DD' 2つの絶対日数差。
export function dayDiff(a: string, b: string): number {
  const ta = Date.parse(a + 'T00:00:00Z');
  const tb = Date.parse(b + 'T00:00:00Z');
  return Math.abs(ta - tb) / 86400000;
}

// 列特定キーワード。フォームに「カナ氏名」「携帯番号」が追加されれば自動で拾う。
export const CONSENT_CFG = { dateKeywords: ['日付'], nameKeywords: ['氏名', 'カナ', 'ふりがな', 'フリガナ'], phoneKeywords: ['携帯', '電話'] };
export const EMERGENCY_CFG = { dateKeywords: ['参加の日付', '日付'], nameKeywords: ['参加者', 'カナ', 'ふりがな', 'フリガナ'], phoneKeywords: ['携帯番号'] };

// 回答 f が予約（氏名候補 cands / 電話 phone）に一致するか。日付は見ない。
function responseMatches(f: FormResponse, cands: string[], phone: string): boolean {
  if (phone && f.phones.has(phone)) return true;
  return cands.some((c) => !!c && f.names.some((n) => n.includes(c) || c.includes(n)));
}

export function matchForms(
  reservations: { reservationId: string; start: Date; customerName: string; customerKana?: string; phone?: string }[],
  consent: FormResponse[],
  emergency: FormResponse[],
): Record<string, FormStatus> {
  const rinfo = reservations.map((rv) => ({
    id: rv.reservationId,
    rdate: jstDateOf(rv.start),
    cands: [normName(rv.customerName), normName(rv.customerKana ?? '')].filter((s) => !!s),
    phone: normPhone(rv.phone ?? ''),
  }));
  const out: Record<string, FormStatus> = {};
  for (const r of rinfo) out[r.id] = { consent: false, emergency: false };

  const assign = (responses: FormResponse[], key: 'consent' | 'emergency'): void => {
    for (const f of responses) {
      const matched = rinfo.filter((r) => responseMatches(f, r.cands, r.phone));
      if (matched.length === 0) continue;
      let targets = matched;
      if (matched.length > 1 && f.date) {
        let best = matched[0];
        for (const r of matched) {
          if (dayDiff(f.date, r.rdate) < dayDiff(f.date, best.rdate)) best = r;
        }
        targets = [best];
      }
      for (const r of targets) out[r.id][key] = true;
    }
  };
  assign(consent, 'consent');
  assign(emergency, 'emergency');
  return out;
}
```

注: 旧 `FormIndexEntry` と `entryMatches` は削除する（上記置換に含まれる）。`normDate` / `normName` / `normPhone` / `colIndexes` / `jstDateOf` は既存のものを再利用（再定義しない）。

- [ ] **Step 5: テストが通ることを確認**

Run: `cd sync && npx vitest run test/forms.test.ts`
Expected: PASS（normalizers + parseFormResponses + dayDiff + matchForms すべて）

- [ ] **Step 6: Commit**

```bash
cd sync && git add src/forms.ts test/forms.test.ts
git commit -m "feat(forms): 照合を日付非依存化（電話/氏名一致＋複数は近い日付に割当）"
```

---

### Task 3: 全体検証（main.ts 無改修の確認）

**Files:** 変更なし（検証のみ。`main.ts` は `parseFormResponses`→`matchForms` の呼び出し文が不変で、型が流れるだけ）

- [ ] **Step 1: 型チェック**

Run: `cd sync && npx tsc --noEmit`
Expected: エラー無し（`main.ts` の `parseFormResponses(...)` 戻り値が `FormResponse[]` になり `matchForms(webReservations, consent, emergency)` にそのまま渡る）

- [ ] **Step 2: 全テスト**

Run: `cd sync && npm test`
Expected: 全テスト PASS

- [ ] **Step 3: main.ts に変更が無いことを確認**

Run: `cd sync && git status -s src/main.ts`
Expected: 出力なし（`main.ts` は未変更）

---

## Self-Review

- **Spec coverage:** NFKC正規化（Task 1）/ 回答リスト化 parseFormResponses（Task 2 Step4）/ 割り当て方式 matchForms＋dayDiff＋複数一致の近い日付選別（Task 2 Step4・テスト）/ 実データ3件（Task 2 テスト）/ 一致ゼロ無視（Task 2 テスト）/ main.ts 無改修（Task 3）/ forms:latest 形不変（出力 `Record<id,{consent,emergency}>` 維持）— すべてカバー。
- **Placeholder scan:** プレースホルダ無し。各コードステップに実コードを記載。
- **型整合:** `FormResponse{date,names,phones}` を Task 2 で定義し parse/match/テストで一貫使用。`dayDiff(a,b)`・`responseMatches(f,cands,phone)`・`matchForms(reservations,FormResponse[],FormResponse[])` の名称/シグネチャ一致。旧 `FormIndexEntry`/`entryMatches` は削除を明記。
