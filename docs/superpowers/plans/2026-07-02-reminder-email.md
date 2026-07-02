# リマインドメール機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同意書/緊急連絡先が未記入の直近予約（今日これから＋明日）にGmailでリマインドメールを送る。起動は手動（GitHub Actions手動実行 → 後にwebボタン）。

**Architecture:** メール（PII）は sync 内のみで扱う。sync に純粋ロジック `reminder.ts`・SMTPラッパー `mailer.ts`・エントリ `remind.ts` を追加。二重送信防止フラグは web の KV に置き、Bearer INGEST_SECRET の新エンドポイントで照会/記録。web のボタンは既存の更新ボタン（workflow_dispatch）と同型。

**Tech Stack:** sync = Node/TypeScript(ESM) + Playwright + googleapis + nodemailer + vitest。web = Cloudflare Worker(TS) + KV + vitest。

**Spec:** `docs/superpowers/specs/2026-07-02-reminder-email-design.md`

**リポジトリ注意:** Task 1〜6 は **sync リポジトリ**、Task 8〜12 は **web リポジトリ**（別git。パスに注意）。コミットは各リポジトリで行う。

---

## Phase 1: sync側ロジック（ここまでで GitHub Actions ドライラン可能）

### Task 1: Reservation に email を追加し parser で読む

**Files:**
- Modify: `sync/src/types.ts`（`Reservation` インターフェース）
- Modify: `sync/src/parser.ts`（`parseReservations`）
- Test: `sync/test/parser.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/parser.test.ts` の既存 describe 内に追記（既存テストのimport構文に合わせる。`../src/parser.js` からimport済みのはず）:

```ts
it('メールアドレス列を email として読む', () => {
  const csv = [
    '予約グループID,予約ID,予約者名,予約者名カナ,電話番号,メールアドレス,コース名,申込日時,参加日,ステータス,合計',
    '1,100,山田太郎,ヤマダタロウ,09011112222,taro@example.com,SUP体験,2026/06/01 10:00,2026/07/10（金） 10:00,予約確定,2',
    '1,101,山田次郎,ヤマダジロウ,09033334444,,SUP体験,2026/06/01 10:00,2026/07/10（金） 10:00,予約確定,2',
  ].join('\n');
  const rs = parseReservations(csv);
  expect(rs[0].email).toBe('taro@example.com');
  expect(rs[1].email).toBeUndefined();
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd sync && npx vitest run test/parser.test.ts`
Expected: FAIL（`email` プロパティが存在しない / undefined !== 'taro@example.com'）

- [ ] **Step 3: 実装**

`src/types.ts` の `Reservation` に追加（`phone?: string;` の次の行）:

```ts
  email?: string;
```

`src/parser.ts` の `out.push({...})` 内、`phone:` の行の次に追加:

```ts
      email: (rec['メールアドレス'] ?? '').trim() || undefined,
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd sync && npx tsc --noEmit && npx vitest run test/parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd sync && git add src/types.ts src/parser.ts test/parser.test.ts && git commit -m "feat(parser): メールアドレス列を email として読む（リマインド用）"
```

### Task 2: reminder.ts — 対象抽出ロジック

**Files:**
- Create: `sync/src/reminder.ts`
- Test: `sync/test/reminder.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/reminder.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest';
import { endOfTomorrowJst, selectReminderTargets } from '../src/reminder.js';
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd sync && npx vitest run test/reminder.test.ts`
Expected: FAIL（`../src/reminder.js` が存在しない）

- [ ] **Step 3: 実装**

`src/reminder.ts` を新規作成:

```ts
import type { Reservation } from './types.js';
import type { FormStatus } from './forms.js';

export interface ReminderTarget {
  reservationId: string;
  email: string;
  customerName: string;
  courseName: string;
  start: Date;
  missingConsent: boolean;
  missingEmergency: boolean;
}

// リマインド対象のステータス（参加済は対象外）
export const REMINDER_STATUSES = new Set(['予約確定', '仮予約']);

// JSTの「明日の終わり」= 翌々日0:00 JST の 1ms 前（UTCのDateで返す）
export function endOfTomorrowJst(now: Date): Date {
  const j = new Date(now.getTime() + 9 * 3600_000);
  const endShifted = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + 2) - 1;
  return new Date(endShifted - 9 * 3600_000);
}

// 判定ルール: 今から〜明日末(JST)開始 / 予約確定・仮予約 / Lコース除外 /
// 同意書or緊急連絡が未記入 / メール有り。メール無しは noEmail に数える。
export function selectReminderTargets(
  reservations: Reservation[],
  forms: Record<string, FormStatus>,
  now: Date,
): { targets: ReminderTarget[]; noEmail: number } {
  const until = endOfTomorrowJst(now).getTime();
  const targets: ReminderTarget[] = [];
  let noEmail = 0;
  for (const r of reservations) {
    if (!REMINDER_STATUSES.has(r.status)) continue;
    if (r.courseName.includes('L')) continue; // webのバッジ非表示(isL)と同じ基準
    const t = r.start.getTime();
    if (t <= now.getTime() || t > until) continue;
    const f = forms[r.reservationId] ?? { consent: false, emergency: false };
    if (f.consent && f.emergency) continue;
    if (!r.email) { noEmail++; continue; }
    targets.push({
      reservationId: r.reservationId,
      email: r.email,
      customerName: r.customerName,
      courseName: r.courseName,
      start: r.start,
      missingConsent: !f.consent,
      missingEmergency: !f.emergency,
    });
  }
  return { targets, noEmail };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd sync && npx tsc --noEmit && npx vitest run test/reminder.test.ts`
Expected: PASS（全ケース）

- [ ] **Step 5: Commit**

```bash
cd sync && git add src/reminder.ts test/reminder.test.ts && git commit -m "feat(reminder): リマインド対象の抽出ロジック（時間窓・L除外・未記入判定）"
```

### Task 3: reminder.ts — メール本文の組み立て

**Files:**
- Modify: `sync/src/reminder.ts`
- Test: `sync/test/reminder.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/reminder.test.ts` に追記（import に `buildReminderEmail` を追加）:

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd sync && npx vitest run test/reminder.test.ts`
Expected: FAIL（`buildReminderEmail` が未定義）

- [ ] **Step 3: 実装**

`src/reminder.ts` 末尾に追加:

```ts
const JST_FMT = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
  weekday: 'short', hour: '2-digit', minute: '2-digit',
});

export function buildReminderEmail(
  t: ReminderTarget,
  urls: { consent: string; emergency: string },
): { subject: string; text: string } {
  const when = JST_FMT.format(t.start); // 例: 7月3日(金) 10:00
  const sections: string[] = [];
  if (t.missingConsent) sections.push(`■ 参加同意書\n${urls.consent}`);
  if (t.missingEmergency) sections.push(`■ 緊急連絡先\n${urls.emergency}`);
  const text = `${t.customerName} 様

Sup! Sup!（日光・中禅寺湖）です。
${when}〜 ${t.courseName} にご参加予定の皆さまへ、事前フォームのご記入のお願いです。

以下のフォームがまだ確認できておりません。
当日の受付をスムーズにするため、参加前日までのご記入をお願いいたします。

${sections.join('\n\n')}

※すでにご記入いただいていた場合は、行き違いのためご容赦ください。
※このメールは送信専用です。ご不明点は予約時のご案内先までご連絡ください。

Sup! Sup!
`;
  return { subject: '【Sup! Sup!】同意書・緊急連絡先ご記入のお願い', text };
}
```

注: `Intl` の `ja-JP` 出力は「7月3日(金) 10:00」形式。テストが実際の出力とずれる場合（Node のICUで空白有無が違う等）は、テスト側を実出力に合わせて修正してよい（本文の正確な整形より含有チェックが目的）。

- [ ] **Step 4: テストが通ることを確認**

Run: `cd sync && npx tsc --noEmit && npx vitest run test/reminder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd sync && git add src/reminder.ts test/reminder.test.ts && git commit -m "feat(reminder): リマインドメール本文の組み立て（未記入分のみURL掲載）"
```

### Task 4: mailer.ts — テストモード差し替えとSMTP送信

**Files:**
- Create: `sync/src/mailer.ts`
- Test: `sync/test/mailer.test.ts`
- Modify: `sync/package.json`（nodemailer 追加）

- [ ] **Step 1: nodemailer をインストール**

Run: `cd sync && npm install nodemailer && npm install -D @types/nodemailer`
Expected: package.json の dependencies に `nodemailer`、devDependencies に `@types/nodemailer` が入る

- [ ] **Step 2: 失敗するテストを書く**

`test/mailer.test.ts` を新規作成（`applyTestMode` は純粋関数なのでテスト対象。SMTP送信自体はラッパーのみでユニットテストしない）:

```ts
import { describe, it, expect } from 'vitest';
import { applyTestMode } from '../src/mailer.js';

const MAIL = { to: 'taro@example.com', toName: '山田太郎', subject: '件名', text: '本文' };

describe('applyTestMode', () => {
  it('テスト宛先未設定ならそのまま', () => {
    expect(applyTestMode(MAIL, undefined)).toEqual(MAIL);
  });
  it('テスト宛先設定時は宛先を差し替え、件名に【テスト】、本文に本来の宛先を付記', () => {
    const m = applyTestMode(MAIL, 'me@example.com');
    expect(m.to).toBe('me@example.com');
    expect(m.subject).toBe('【テスト】件名');
    expect(m.text).toContain('本来の宛先: 山田太郎 様 <taro@example.com>');
    expect(m.text).toContain('本文');
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd sync && npx vitest run test/mailer.test.ts`
Expected: FAIL（`../src/mailer.js` が存在しない）

- [ ] **Step 4: 実装**

`src/mailer.ts` を新規作成:

```ts
import nodemailer from 'nodemailer';

export interface SmtpConfig { user: string; appPassword: string }
export interface MailInput { to: string; toName: string; subject: string; text: string }

// REMINDER_TEST_EMAIL 設定中は宛先を差し替え、本来の宛先を本文に付記する
export function applyTestMode(mail: MailInput, testEmail: string | undefined): MailInput {
  if (!testEmail) return mail;
  return {
    ...mail,
    to: testEmail,
    subject: `【テスト】${mail.subject}`,
    text: `【テスト送信】本来の宛先: ${mail.toName} 様 <${mail.to}>\n\n${mail.text}`,
  };
}

export async function sendMail(cfg: SmtpConfig, mail: MailInput): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: cfg.user, pass: cfg.appPassword },
  });
  await transporter.sendMail({
    from: `"Sup! Sup!" <${cfg.user}>`,
    to: mail.to, subject: mail.subject, text: mail.text,
  });
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd sync && npx tsc --noEmit && npx vitest run test/mailer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd sync && git add package.json package-lock.json src/mailer.ts test/mailer.test.ts && git commit -m "feat(mailer): Gmail SMTP送信とテストモード宛先差し替えを追加"
```

### Task 5: web-publish.ts — 送信済みフラグの照会/報告クライアント

**Files:**
- Modify: `sync/src/web-publish.ts`
- Test: `sync/test/web-publish.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/web-publish.test.ts` に追記（既存のfetchモック方式があればそれに合わせる。無ければ以下）:

```ts
import { vi } from 'vitest'; // 既にimport済みなら不要
import { fetchReminded, publishReminded } from '../src/web-publish.js';

describe('fetchReminded / publishReminded', () => {
  it('fetchReminded はID集合を返す', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({ ids: ['1', '2'] }), { status: 200 }));
    vi.stubGlobal('fetch', mock);
    const set = await fetchReminded('https://web.example', 'sec');
    expect([...set].sort()).toEqual(['1', '2']);
    expect(mock).toHaveBeenCalledWith('https://web.example/api/reminded',
      expect.objectContaining({ headers: { authorization: 'Bearer sec' } }));
    vi.unstubAllGlobals();
  });
  it('fetchReminded は非200で例外（送信中止のため）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ng', { status: 500 })));
    await expect(fetchReminded('https://web.example', 'sec')).rejects.toThrow();
    vi.unstubAllGlobals();
  });
  it('publishReminded はids+summaryをPOSTする', async () => {
    const mock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', mock);
    const summary = { at: '2026-07-02T10:00:00Z', sent: 1, skipped: 0, failed: 0, dryRun: false, test: false };
    await publishReminded('https://web.example', 'sec', { ids: ['1'], summary });
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe('https://web.example/ingest-reminded');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ ids: ['1'], summary });
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd sync && npx vitest run test/web-publish.test.ts`
Expected: FAIL（`fetchReminded` が未エクスポート）

- [ ] **Step 3: 実装**

`src/web-publish.ts` 末尾に追加:

```ts
export interface ReminderSummary {
  at: string; sent: number; skipped: number; failed: number; dryRun: boolean; test: boolean;
}

// 送信済み予約IDを web(KV) から取得。失敗は例外＝呼び出し側で送信中止（二重送信防止を優先）
export async function fetchReminded(url: string, secret: string): Promise<Set<string>> {
  const resp = await fetch(`${url.replace(/\/$/, '')}/api/reminded`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  if (!resp.ok) throw new Error(`reminded fetch failed: HTTP ${resp.status}`);
  const body = (await resp.json()) as { ids?: string[] };
  return new Set(body.ids ?? []);
}

export async function publishReminded(
  url: string, secret: string,
  payload: { ids: string[]; summary: ReminderSummary },
): Promise<void> {
  const resp = await fetch(`${url.replace(/\/$/, '')}/ingest-reminded`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`reminded ingest failed: HTTP ${resp.status}`);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd sync && npx tsc --noEmit && npx vitest run test/web-publish.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd sync && git add src/web-publish.ts test/web-publish.test.ts && git commit -m "feat(web-publish): 送信済みリマインドの照会/報告クライアントを追加"
```

### Task 6: remind.ts — エントリポイントと npm script

**Files:**
- Create: `sync/src/remind.ts`
- Modify: `sync/package.json`（scripts に `remind`）

エントリは配線のみ（ロジックはTask 2-5でテスト済み）なのでユニットテストは書かない。動作確認はドライラン実行（Phase 1 検証参照）。

- [ ] **Step 1: 実装**

`src/remind.ts` を新規作成:

```ts
import { fetchReservationsCsv } from './fetcher.js';
import { parseReservations } from './parser.js';
import { parseFormResponses, CONSENT_CFG, EMERGENCY_CFG, matchForms, readSheetValues } from './forms.js';
import { selectReminderTargets, buildReminderEmail, endOfTomorrowJst } from './reminder.js';
import { applyTestMode, sendMail } from './mailer.js';
import { fetchReminded, publishReminded } from './web-publish.js';

// main.ts と同じ公開情報（回答シートID・web URL）
const SHEET_CONSENT = '1QzGBhtOLy89KvdPVOALg7_yTRnJZvz0ynS2hg2kSZSM';
const SHEET_EMERGENCY = '12Y9HEiAjICMFVNjmjH0ndLixkdAORhkcCFQmHtr3ADY';
const WEB_URL = 'https://supsup-urakata-calendar.ymty.workers.dev';

async function run(): Promise<void> {
  const env = process.env;
  const req = (k: string): string => {
    const v = (env[k] ?? '').trim();
    if (!v) throw new Error(`環境変数 ${k} が未設定です`);
    return v;
  };
  const dryRun = (env.REMINDER_DRY_RUN ?? '').trim() === '1';
  const now = new Date();

  // 今日〜明日(JST)の予約だけあればよい。fromは今日を確実に含むよう24h前。
  const csv = await fetchReservationsCsv({
    baseUrl: req('URAKATA_URL'), loginId: req('URAKATA_LOGIN_ID'), password: req('URAKATA_PASSWORD'),
    from: new Date(now.getTime() - 24 * 3600_000), to: endOfTomorrowJst(now),
    statuses: ['fixed', 'temporary_fixed'],
  });
  const reservations = parseReservations(csv);
  console.log(`[remind] fetched ${reservations.length} reservations`);

  const sa = req('GOOGLE_SERVICE_ACCOUNT_JSON');
  const consent = parseFormResponses(await readSheetValues(sa, SHEET_CONSENT), CONSENT_CFG);
  const emergency = parseFormResponses(await readSheetValues(sa, SHEET_EMERGENCY), EMERGENCY_CFG);
  const formsMap = matchForms(reservations, consent, emergency);

  const { targets, noEmail } = selectReminderTargets(reservations, formsMap, now);
  console.log(`[remind] targets=${targets.length} noEmail=${noEmail}`);

  if (dryRun) {
    for (const t of targets) {
      console.log(`[remind][DRY] ${t.reservationId} ${t.customerName} ${t.start.toISOString()} ` +
        `同意書=${t.missingConsent ? '未' : '済'} 緊急連絡=${t.missingEmergency ? '未' : '済'}`);
    }
    console.log(`[remind][DRY] ${targets.length}件に送信予定（実送信・フラグ記録なし）`);
    return;
  }

  const webSecret = req('WEB_INGEST_SECRET').replace(/\s/g, '');
  // 送信済みの取得に失敗したら送信しない（二重送信防止を優先）
  const reminded = await fetchReminded(WEB_URL, webSecret);
  const pending = targets.filter((t) => !reminded.has(t.reservationId));
  const skipped = targets.length - pending.length;
  console.log(`[remind] pending=${pending.length} skipped(already)=${skipped}`);

  const urls = { consent: req('FORM_URL_CONSENT'), emergency: req('FORM_URL_EMERGENCY') };
  const smtp = { user: req('GMAIL_USER'), appPassword: req('GMAIL_APP_PASSWORD') };
  const testEmail = (env.REMINDER_TEST_EMAIL ?? '').trim() || undefined;
  if (testEmail) console.log(`[remind] TEST MODE: all mails to ${testEmail}`);

  const sentIds: string[] = [];
  let failed = 0;
  for (const t of pending) {
    const mail = applyTestMode({ to: t.email, toName: t.customerName, ...buildReminderEmail(t, urls) }, testEmail);
    try {
      await sendMail(smtp, mail);
      sentIds.push(t.reservationId);
      console.log(`[remind] sent ${t.reservationId}`);
    } catch (e) {
      failed++;
      console.error(`[remind] send failed ${t.reservationId}:`, e);
    }
  }

  // テストモードではフラグを記録しない（本番切替後に本人へ届くように）。結果サマリーは常に記録。
  await publishReminded(WEB_URL, webSecret, {
    ids: testEmail ? [] : sentIds,
    summary: {
      at: new Date().toISOString(),
      sent: sentIds.length, skipped, failed,
      dryRun: false, test: !!testEmail,
    },
  });
  console.log(`[remind] done sent=${sentIds.length} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error('[remind] FAILED:', err); process.exit(1); });
```

`package.json` の scripts に追加:

```json
    "remind": "tsx src/remind.ts"
```

- [ ] **Step 2: typecheck と全テスト**

Run: `cd sync && npx tsc --noEmit && npm test`
Expected: PASS（既存テスト含め全て）

- [ ] **Step 3: Commit**

```bash
cd sync && git add src/remind.ts package.json && git commit -m "feat(remind): リマインド送信エントリポイント（DRY_RUN/テストモード/送信済みスキップ）"
```

### Task 7: Phase 1 検証（GitHub Actions でドライラン）

**Files:**
- なし（GitHub 画面での作業＋push）

- [ ] **Step 1: push**

```bash
cd sync && git push
```

- [ ] **Step 2: ユーザー作業 — reminder.yml を GitHub 画面で作成**

PAT に workflow スコープが無いため Claude は push 不可。`https://github.com/DaisukeHukuda/urakata-calendar/new/main/.github/workflows` で `reminder.yml` を作成し、以下を貼り付け:

```yaml
name: urakata-reminder
on:
  workflow_dispatch: {}
concurrency:
  group: urakata-remind
  cancel-in-progress: false
jobs:
  remind:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: package-lock.json
      - run: npm ci
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            playwright-${{ runner.os }}-
      - run: npm run remind
        env:
          URAKATA_URL: ${{ secrets.URAKATA_URL }}
          URAKATA_LOGIN_ID: ${{ secrets.URAKATA_LOGIN_ID }}
          URAKATA_PASSWORD: ${{ secrets.URAKATA_PASSWORD }}
          GOOGLE_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
          WEB_INGEST_SECRET: ${{ secrets.WEB_INGEST_SECRET }}
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          FORM_URL_CONSENT: ${{ secrets.FORM_URL_CONSENT }}
          FORM_URL_EMERGENCY: ${{ secrets.FORM_URL_EMERGENCY }}
          REMINDER_TEST_EMAIL: ${{ secrets.REMINDER_TEST_EMAIL }}
          REMINDER_DRY_RUN: ${{ vars.REMINDER_DRY_RUN }}
```

- [ ] **Step 3: ユーザー作業 — リポジトリ変数でドライランON**

GitHub → Settings → Secrets and variables → Actions → **Variables** タブ → New repository variable: `REMINDER_DRY_RUN` = `1`
（Secrets は Phase 2 まで未設定でよい。ドライランは既存 Secrets のみで動く）

- [ ] **Step 4: 実行と確認**

Actions タブ → urakata-reminder → Run workflow。ログに `[remind][DRY] …件に送信予定` と対象一覧が出れば Phase 1 完了。
（Claude からも API で起動可能: `POST /repos/DaisukeHukuda/urakata-calendar/actions/workflows/reminder.yml/dispatches` body `{"ref":"main"}`）

---

## Phase 2: web側 — フラグ保存/照会（実メール送信が可能になる）

### Task 8: KV put の TTL 対応と reminded ヘルパー

**Files:**
- Modify: `web/src/kv.ts`
- Modify: `web/src/data.ts`
- Test: `web/test/data.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/data.test.ts` に追記（既存の FakeKV を使う。FakeKV の `put` が第3引数未対応でも構造的部分型で代入可能）:

```ts
import { putReminded, listReminded, putReminderResult, getReminderResult } from '../src/data.js';

describe('reminded flags', () => {
  it('putReminded で保存し listReminded でID一覧を返す', async () => {
    const kv = new FakeKV();
    await putReminded(kv, ['100', '200']);
    expect((await listReminded(kv)).sort()).toEqual(['100', '200']);
  });
  it('空配列なら何も書かない', async () => {
    const kv = new FakeKV();
    await putReminded(kv, []);
    expect(await listReminded(kv)).toEqual([]);
  });
  it('reminder result を保存・取得できる', async () => {
    const kv = new FakeKV();
    const summary = { at: '2026-07-02T10:00:00Z', sent: 2, skipped: 1, failed: 0, dryRun: false, test: true };
    await putReminderResult(kv, summary);
    expect(await getReminderResult(kv)).toEqual(summary);
    expect(await getReminderResult(new FakeKV())).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd web && npx vitest run test/data.test.ts`
Expected: FAIL（`putReminded` が未エクスポート）

- [ ] **Step 3: 実装**

`src/kv.ts` の `put` シグネチャを変更:

```ts
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
```

`src/data.ts` 末尾に追加:

```ts
const REMINDED_PREFIX = 'reminded:';
const REMINDER_RESULT_KEY = 'reminder:lastResult';
const REMINDED_TTL_S = 30 * 24 * 3600; // 30日で自動失効

export async function putReminded(kv: KV, ids: string[]): Promise<void> {
  for (const id of ids) await kv.put(`${REMINDED_PREFIX}${id}`, '1', { expirationTtl: REMINDED_TTL_S });
}

export async function listReminded(kv: KV): Promise<string[]> {
  const res = await kv.list({ prefix: REMINDED_PREFIX });
  return res.keys.map((k) => k.name.slice(REMINDED_PREFIX.length));
}

export async function putReminderResult(kv: KV, summary: unknown): Promise<void> {
  await kv.put(REMINDER_RESULT_KEY, JSON.stringify(summary));
}

export async function getReminderResult(kv: KV): Promise<unknown> {
  const raw = await kv.get(REMINDER_RESULT_KEY);
  return raw ? JSON.parse(raw) : null;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd web && npm run typecheck && npx vitest run test/data.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd web && git add src/kv.ts src/data.ts test/data.test.ts && git commit -m "feat(data): リマインド送信済みフラグ(TTL30日)と結果サマリーのKV保存"
```

### Task 9: ハンドラ — /ingest-reminded と /api/reminded

**Files:**
- Modify: `web/src/handlers.ts`
- Modify: `web/src/index.ts`
- Test: `web/test/handlers-reminded.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/handlers-reminded.test.ts` を新規作成（Envの組み立ては `test/handlers-ingest.test.ts` の流儀に合わせる。以下は雛形）:

```ts
import { describe, it, expect } from 'vitest';
import { handleIngestReminded, handleApiReminded, type Env } from '../src/handlers.js';
import { listReminded, getReminderResult } from '../src/data.js';

// FakeKV は既存テストと同じものを使う（コピーか共有ヘルパー）
class FakeKV {
  store = new Map<string, string>();
  async get(k: string) { return this.store.get(k) ?? null; }
  async put(k: string, v: string) { this.store.set(k, v); }
  async delete(k: string) { this.store.delete(k); }
  async list(o: { prefix: string }) {
    return { keys: [...this.store.keys()].filter((n) => n.startsWith(o.prefix)).map((name) => ({ name })) };
  }
}
const env = (): Env => ({
  USERS: new FakeKV(), DATA: new FakeKV(),
  ADMIN_USER: 'a', ADMIN_PASSWORD: 'p', SESSION_SECRET: 's', INGEST_SECRET: 'sec',
  SYNC_DISPATCH_TOKEN: 'tok',
} as unknown as Env);
const post = (body: unknown, auth = 'Bearer sec') =>
  new Request('https://x/ingest-reminded', {
    method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('handleIngestReminded', () => {
  it('Bearer不一致は401', async () => {
    expect((await handleIngestReminded(post({ ids: [] }, 'Bearer bad'), env())).status).toBe(401);
  });
  it('ids配列でなければ400', async () => {
    expect((await handleIngestReminded(post({ ids: 'x' }), env())).status).toBe(400);
  });
  it('idsをフラグ保存しsummaryも保存する', async () => {
    const e = env();
    const summary = { at: '2026-07-02T10:00:00Z', sent: 1, skipped: 0, failed: 0, dryRun: false, test: false };
    const res = await handleIngestReminded(post({ ids: ['100'], summary }), e);
    expect(res.status).toBe(200);
    expect(await listReminded(e.DATA)).toEqual(['100']);
    expect(await getReminderResult(e.DATA)).toEqual(summary);
  });
});

describe('handleApiReminded', () => {
  it('Bearer必須・保存済みIDを返す', async () => {
    const e = env();
    await handleIngestReminded(post({ ids: ['1', '2'] }), e);
    const ok = await handleApiReminded(new Request('https://x/api/reminded', { headers: { authorization: 'Bearer sec' } }), e);
    expect(((await ok.json()) as { ids: string[] }).ids.sort()).toEqual(['1', '2']);
    const ng = await handleApiReminded(new Request('https://x/api/reminded'), e);
    expect(ng.status).toBe(401);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd web && npx vitest run test/handlers-reminded.test.ts`
Expected: FAIL（handler未定義）

- [ ] **Step 3: 実装**

`src/handlers.ts` に追加（`handleIngestForms` の下。importに `putReminded, listReminded, putReminderResult, getReminderResult` を追加）:

```ts
export async function handleIngestReminded(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${env.INGEST_SECRET}`) return new Response('unauthorized', { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  const b = body as { ids?: unknown; summary?: unknown };
  if (!Array.isArray(b?.ids) || !b.ids.every((x) => typeof x === 'string')) {
    return new Response('invalid', { status: 400 });
  }
  await putReminded(env.DATA, b.ids as string[]);
  if (b.summary && typeof b.summary === 'object') await putReminderResult(env.DATA, b.summary);
  return new Response(JSON.stringify({ ok: true, count: (b.ids as string[]).length }), {
    headers: { 'content-type': 'application/json' },
  });
}

export async function handleApiReminded(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${env.INGEST_SECRET}`) return new Response('unauthorized', { status: 401 });
  const ids = await listReminded(env.DATA);
  return new Response(JSON.stringify({ ids }), { headers: { 'content-type': 'application/json' } });
}
```

`src/index.ts` のルーティング（認証**前**、`/ingest-forms` の下）に追加。importも更新:

```ts
  if (path === '/ingest-reminded' && method === 'POST') return handleIngestReminded(req, env);
  if (path === '/api/reminded' && method === 'GET') return handleApiReminded(req, env);
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS（全テスト）

- [ ] **Step 5: Commit**

```bash
cd web && git add src/handlers.ts src/index.ts test/handlers-reminded.test.ts && git commit -m "feat(api): リマインド送信済みフラグの記録/照会エンドポイント（Bearer INGEST_SECRET）"
```

### Task 10: Phase 2 検証（デプロイ＋実テストメール）

- [ ] **Step 1: デプロイ**

```bash
cd web && npm run typecheck && npm test && npx wrangler deploy
```

- [ ] **Step 2: ユーザー作業 — Gmail アプリパスワードと Secrets**

1. 送信元にする Google アカウントで 2段階認証を有効化 → `https://myaccount.google.com/apppasswords` でアプリパスワード発行（16文字）
2. GitHub → Settings → Secrets and variables → Actions → Secrets に登録:
   - `GMAIL_USER`（送信元アドレス）
   - `GMAIL_APP_PASSWORD`（発行した16文字。空白は除いて貼る）
   - `FORM_URL_CONSENT`（同意書フォームの回答用URL）
   - `FORM_URL_EMERGENCY`（緊急連絡先フォームの回答用URL）
   - `REMINDER_TEST_EMAIL`（テスト期間中の受け取り先。例: fukuda.d@gmail.com）
3. Variables の `REMINDER_DRY_RUN` を `0` に変更（または削除）

- [ ] **Step 3: テスト送信**

Actions → urakata-reminder → Run workflow。`REMINDER_TEST_EMAIL` 宛てに「【テスト】…」メールが届き、ログに `[remind] done sent=…` が出れば成功。
※テストモード中は送信済みフラグを記録しない（本番切替後に本人へ届くようにするため）。テスト実行のたびに同じ対象へテストメールが届くのは正常。

---

## Phase 3: web UI — 📧ボタンと結果表示

### Task 11: /remind と /api/reminder-status ハンドラ（dispatch共通化）

**Files:**
- Modify: `web/src/handlers.ts`
- Modify: `web/src/index.ts`
- Test: `web/test/handlers-remind.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/handlers-remind.test.ts` を新規作成（fetchモック等は `test/handlers-refresh.test.ts` の流儀に合わせる。要点のみ）:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleRemind, handleReminderStatus, type Env } from '../src/handlers.js';
import { putReminderResult } from '../src/data.js';
// FakeKV / env() は handlers-reminded.test.ts と同じものを使う

afterEach(() => vi.unstubAllGlobals());

describe('handleRemind', () => {
  it('reminder.yml をdispatchし started を返す', async () => {
    const mock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', mock);
    const res = await handleRemind(env());
    expect(((await res.json()) as { status: string }).status).toBe('started');
    expect(String(mock.mock.calls[0][0])).toContain('/actions/workflows/reminder.yml/dispatches');
  });
  it('15秒以内の連打は already（meta:lastRemindDispatchAt でデバウンス）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    const e = env();
    await handleRemind(e);
    const res = await handleRemind(e);
    expect(((await res.json()) as { status: string }).status).toBe('already');
  });
  it('GitHubが204以外なら error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ng', { status: 401 })));
    expect((await handleRemind(env())).status).toBe(500);
  });
});

describe('handleReminderStatus', () => {
  it('保存済みサマリーを返す（未保存は null）', async () => {
    const e = env();
    expect(((await (await handleReminderStatus(e)).json()) as { summary: unknown }).summary).toBeNull();
    const s = { at: '2026-07-02T10:00:00Z', sent: 1, skipped: 0, failed: 0, dryRun: false, test: false };
    await putReminderResult(e.DATA, s);
    expect(((await (await handleReminderStatus(e)).json()) as { summary: unknown }).summary).toEqual(s);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd web && npx vitest run test/handlers-remind.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装（handleRefresh を共通化）**

`src/handlers.ts` の `handleRefresh` を、共通関数＋薄いラッパー2つに置き換え:

```ts
const GH_OWNER_REPO = 'DaisukeHukuda/urakata-calendar';
const DISPATCH_DEBOUNCE_MS = 15000;

// workflow_dispatch 起動の共通処理。連打はデバウンス。トークンやGitHub応答本文はクライアントに出さない。
async function dispatchWorkflow(env: Env, workflowFile: string, debounceKey: string): Promise<Response> {
  const json = (o: unknown, status = 200): Response =>
    new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const token = env.SYNC_DISPATCH_TOKEN;
  if (!token) return json({ status: 'error' }, 500);
  const now = Date.now();
  if (now - (await getMetaTs(env.DATA, debounceKey)) < DISPATCH_DEBOUNCE_MS) {
    return json({ status: 'already' });
  }
  let status = 0;
  try {
    const resp = await fetch(`https://api.github.com/repos/${GH_OWNER_REPO}/actions/workflows/${workflowFile}/dispatches`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'accept': 'application/vnd.github+json',
        'user-agent': 'urakata-calendar',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    status = resp.status;
  } catch {
    return json({ status: 'error' }, 500);
  }
  if (status !== 204) return json({ status: 'error' }, 500);
  await setMetaTs(env.DATA, debounceKey, now);
  return json({ status: 'started' });
}

export async function handleRefresh(env: Env): Promise<Response> {
  return dispatchWorkflow(env, 'sync.yml', 'meta:lastDispatchAt');
}

export async function handleRemind(env: Env): Promise<Response> {
  return dispatchWorkflow(env, 'reminder.yml', 'meta:lastRemindDispatchAt');
}

export async function handleReminderStatus(env: Env): Promise<Response> {
  const summary = await getReminderResult(env.DATA);
  return new Response(JSON.stringify({ summary }), { headers: { 'content-type': 'application/json' } });
}
```

（旧 `GH_WORKFLOW` 定数は削除）

`src/index.ts` のルーティング（認証**後**、`/refresh` の下）に追加。importも更新:

```ts
  if (path === '/remind' && method === 'POST') return handleRemind(env);
  if (path === '/api/reminder-status' && method === 'GET') return handleReminderStatus(env);
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS（既存 handlers-refresh.test.ts も含め全て）

- [ ] **Step 5: Commit**

```bash
cd web && git add src/handlers.ts src/index.ts test/handlers-remind.test.ts && git commit -m "feat(api): /remind でリマインドWFを起動、/api/reminder-status で前回結果を返す"
```

### Task 12: 📧ボタンのUI

**Files:**
- Modify: `web/src/i18n.ts`（`remind` キー）
- Modify: `web/src/month.ts:223` 付近（refresh-btn の隣）
- Modify: `web/src/pages.ts`（CSS と NAV_SCRIPT）
- Test: `web/test/month.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/month.test.ts` に追記（既存のレンダリングテストの流儀で。要点は remind-btn の存在）:

```ts
it('詳細ツールバーに remind-btn を表示する', () => {
  // 既存の refresh-btn を検証しているテストと同じ呼び出しで html を得る
  expect(html).toContain('class="remind-btn"');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd web && npx vitest run test/month.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/i18n.ts` の ja/en 辞書に追加:

```ts
  remind: { ja: '📧リマインド', en: '📧 Remind' },
  remindTitle: { ja: '未記入の直近予約（今日これから＋明日）にリマインドメールを送信', en: 'Send reminder emails for upcoming bookings with missing forms' },
```

（既存辞書の形式が `ja: {...}, en: {...}` 分離型ならそれに合わせて2箇所に追加）

`src/month.ts:223` の refresh ボタンの直後に追加:

```ts
    <button type="button" class="remind-btn" title="${t(lang, 'remindTitle')}">${t(lang, 'remind')}</button>
```

`src/pages.ts` の CSS `.refresh-btn{...}` のセレクタを `.refresh-btn,.remind-btn{...}` に変更。

`src/pages.ts` の NAV_SCRIPT、doRefresh のクリックバインドの下に追加:

```js
  // --- リマインドボタン：確認 → reminder ワークフローを起動 ---
  function doRemind(btn){
    if (!window.confirm('同意書・緊急連絡先が未記入の直近予約（今日これから＋明日）にリマインドメールを送ります。よろしいですか？')) return;
    var orig = btn.getAttribute('data-orig') || btn.textContent;
    btn.setAttribute('data-orig', orig);
    function flash(msg){ btn.disabled = false; btn.textContent = msg; setTimeout(function(){ btn.textContent = orig; }, 4000); }
    btn.disabled = true; btn.textContent = '送信処理中…';
    fetch('/remind', { method: 'POST', credentials: 'same-origin' }).then(function(r){ return r.json(); }).then(function(res){
      if (res && res.status === 'started') { flash('開始しました（2〜3分後に完了）'); return; }
      if (res && res.status === 'already') { flash('処理中です'); return; }
      flash('開始できませんでした');
    }).catch(function(){ flash('開始できませんでした'); });
  }
  document.addEventListener('click', function(e){
    var mb = e.target.closest ? e.target.closest('.remind-btn') : null;
    if (mb) { e.preventDefault(); doRemind(mb); }
  });
  // 前回のリマインド結果をボタンtitleに表示
  (function(){
    var mb = document.querySelector('.remind-btn');
    if (!mb) return;
    fetch('/api/reminder-status', { credentials: 'same-origin' }).then(function(r){ return r.json(); }).then(function(s){
      var sm = s && s.summary;
      if (sm) mb.title = '前回: ' + (sm.at || '') + ' / 送信' + sm.sent + '件・スキップ' + sm.skipped + '件・失敗' + sm.failed + '件' + (sm.test ? '（テスト）' : sm.dryRun ? '（ドライラン）' : '');
    }).catch(function(){});
  })();
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd web && git add src/i18n.ts src/month.ts src/pages.ts test/month.test.ts && git commit -m "feat(ui): 📧リマインドボタン（確認→起動→前回結果をtitle表示）"
```

### Task 13: 仕上げ — デプロイと HANDOFF 更新

- [ ] **Step 1: 両リポジトリの反映**

```bash
cd web && npm run typecheck && npm test && npx wrangler deploy
cd ../sync && npx tsc --noEmit && npm test && git push
```

- [ ] **Step 2: E2E確認（ユーザーと）**

1. web にログイン → 📧リマインドボタン → confirm → 「開始しました」
2. 数分後、`REMINDER_TEST_EMAIL` にメール到着・ボタンtitleに前回結果
3. 数日テスト運用後、`REMINDER_TEST_EMAIL` Secret を削除（または空に）して本番切替

- [ ] **Step 3: HANDOFF.md 更新**

ルートの `HANDOFF.md` §13 を「実装済み」に書き換え（構成・KVキー・Secrets一覧・テスト/本番切替手順・§9の最新コミット）。コミットはsyncリポジトリ外（ルート直下）なのでファイル保存のみ。

- [ ] **Step 4: sync リポジトリの残コミットをpush済みか確認**

Run: `cd sync && git status && git log origin/main..main --oneline`
Expected: クリーン・未pushなし
