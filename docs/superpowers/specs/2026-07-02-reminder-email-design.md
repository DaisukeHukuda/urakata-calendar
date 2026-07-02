# リマインドメール機能 設計書（2026-07-02）

## 目的

同意書 or 緊急連絡先が未記入のまま参加日が近づいている予約に対し、
お客様本人へ Gmail でリマインドメールを送る。**起動は手動ボタンのみ**（自動定時送信はしない）。

## 決定事項（ユーザー確認済み）

| 論点 | 決定 |
|---|---|
| 送信方式 | **SMTP＋Gmailアプリパスワード**（通常の @gmail.com。Workspace は契約しない） |
| 起動方法 | **手動ボタンのみ**（web のボタン → workflow_dispatch。定時cronは付けない） |
| 送信先 | お客様本人。ただし**まずテスト期間**（`REMINDER_TEST_EMAIL` 宛てに全件転送） |
| フォームURL | GitHub Secrets（`FORM_URL_CONSENT` / `FORM_URL_EMERGENCY`）でユーザーが設定 |
| 進め方 | **まず動く形で試す**。①sync側ロジック（ローカルでドライラン可）→ ②ワークフロー → ③webボタン の順 |

## 全体構成

```
[web] 📧リマインドボタン → POST /remind（要ログイン、デバウンス）
   │  GitHub API workflow_dispatch で reminder.yml を起動（SYNC_DISPATCH_TOKEN 流用）
   ▼
[sync] npm run remind（tsx src/remind.ts）
   ├─ ウラカタCSV取得（既存 fetchReservationsCsv。今日〜+2日の範囲）
   ├─ parser に email 列（「メールアドレス」）を追加して予約を得る
   ├─ Google Sheets からフォーム回答を読み matchForms で照合（既存 forms.ts）
   ├─ 対象抽出（下記「判定ルール」）
   ├─ web から送信済みフラグを取得し、送信済みはスキップ
   ├─ nodemailer で Gmail SMTP 送信（またはドライラン）
   └─ 結果（送信済みID・サマリー）を web へ POST（Bearer INGEST_SECRET）
[web] KV に reminded:${id}（TTL 30日）と reminder:lastResult を保存
   └─ ボタン付近に最終実行結果を表示（GET /api/reminder-status）
```

メールアドレスは **sync 内でのみ扱い、web/KV には一切送らない**（PII保護）。

## 判定ルール（対象予約の抽出）

すべて満たすものが送信対象:

1. 参加開始が **「今から」〜「明日の終わり（JST 23:59）」** の間
   （前日にボタンを押す運用を想定。ローリング24hだと夕方押下で翌夜の予約が漏れるため）
2. ステータスが `予約確定` または `仮予約`（`WEB_PUBLISH_STATUSES` から `参加済` を除いたもの）
3. コース名が `L ` 始まりでない（ホテル経由はフォーム対象外。web のバッジ非表示と同基準）
4. forms 照合で consent / emergency の **少なくとも一方が未記入**
5. メールアドレスが CSV にある（無い予約はスキップしてログに件数を出す）
6. 送信済みフラグ `reminded:${id}` が無い（**1予約につき1回だけ**）

## sync 側の構成

### 変更

- `src/types.ts` — `Reservation` に `email?: string` を追加
- `src/parser.ts` — `メールアドレス` 列を読む
- `src/web-publish.ts` — `toDTOs` は email を**含めない**（現状維持を明示）

### 新規

- `src/reminder.ts` — 純粋ロジック（テスト対象の中心）
  - `selectReminderTargets(reservations, formsMap, now): ReminderTarget[]` … 判定ルール1〜5
  - `buildReminderEmail(target, urls): {subject, text}` … 本文組み立て（未記入のフォームURLだけ載せる）
- `src/mailer.ts` — nodemailer ラッパー
  - `sendMail(smtpConfig, {to, subject, text})`。`REMINDER_TEST_EMAIL` があれば宛先を差し替え、本文冒頭に `【テスト】本来の宛先: ○○様 <address>` を付記
- `src/remind.ts` — エントリポイント（`npm run remind`）
  - `REMINDER_DRY_RUN=1` なら送信せず対象一覧をログ出力のみ（SMTP資格情報・web接続が無くても動く）
  - web から `GET /api/reminded`（Bearer INGEST_SECRET）で送信済みIDを取得。失敗時は**送信を中止**（二重送信防止を優先）
  - 送信成功分を `POST /ingest-reminded` で報告 `{ids: string[], summary: {at, sent, skipped, dryRun}}`
- 依存追加: `nodemailer`（＋`@types/nodemailer`）

### 環境変数（GitHub Secrets / ローカル .env）

| 変数 | 用途 |
|---|---|
| `GMAIL_USER` | 送信元 Gmail アドレス |
| `GMAIL_APP_PASSWORD` | アプリパスワード（2段階認証必須） |
| `FORM_URL_CONSENT` | 同意書フォームURL |
| `FORM_URL_EMERGENCY` | 緊急連絡先フォームURL |
| `REMINDER_TEST_EMAIL` | 設定中は全件この宛先へ（空にすると本番） |
| `REMINDER_DRY_RUN` | `1` なら送信もフラグ記録もしない（ローカル確認用） |
| 既存流用 | `URAKATA_*`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `WEB_INGEST_SECRET` |

### GitHub Actions `reminder.yml`（ユーザーが GitHub 画面で作成）

- `on: workflow_dispatch` のみ（cron無し）。`concurrency: urakata-remind`
- 手順は sync.yml と同型（checkout / node / npm ci / Playwright キャッシュ＋install / `npm run remind`）
- ※ PAT に workflow スコープが無いため Claude は push 不可。完成内容を用意しユーザーが貼り付け

## web 側の構成

- `POST /ingest-reminded`（Bearer INGEST_SECRET）: `reminded:${id}` を TTL 30日で保存、`reminder:lastResult` に summary を保存
- `GET /api/reminded`（Bearer INGEST_SECRET）: 保存済みIDの一覧を返す（`list({prefix:'reminded:'})`）
- `POST /remind`（要ログイン）: reminder.yml を workflow_dispatch。15秒デバウンス（`meta:lastRemindDispatchAt`）。`handleRefresh` と同型
- `GET /api/reminder-status`（要ログイン）: `reminder:lastResult` を返す
- UI: ヘッダーに 📧 ボタン。押下時 `confirm()` で確認 → 「リマインド処理を開始しました（2〜3分）」→ 完了後は再訪/更新時に最終結果（例「7/2 18:05 2件送信・1件スキップ」）をボタンtitle/トーストで表示（ポーリングはしない。MVPでは表示は簡素に）

## メール文面（初稿。specレビューで修正可）

- 件名: `【Sup! Sup!】同意書・緊急連絡先ご記入のお願い`
- 本文（text/plain）:

```
{予約者名} 様

Sup! Sup!（日光・中禅寺湖）です。
{M月D日(曜) HH:mm}〜 {コース名} にご参加予定の皆さまへ、
事前フォームのご記入のお願いです。

以下のフォームがまだ確認できておりません。
当日の受付をスムーズにするため、参加前日までのご記入をお願いいたします。

{未記入のものだけ表示}
■ 参加同意書
{FORM_URL_CONSENT}
■ 緊急連絡先
{FORM_URL_EMERGENCY}

※すでにご記入いただいていた場合は、行き違いのためご容赦ください。
※このメールは送信専用です。ご不明点は予約時のご案内先までご連絡ください。

Sup! Sup!
```

## エラー処理

- 送信済みフラグの取得失敗 → **全件送信中止**（安全側に倒す）
- 個別の送信失敗 → その予約はフラグを付けず続行（次回再試行される）。失敗件数をログとsummaryに含める
- CSVにメール無し → スキップし件数をログ
- Gmail SMTP の日次上限（通常アカウント約500通/日）は運用上問題にならない規模

## テスト方針

- `reminder.test.ts`: 判定ルール（時間窓の境界=今ちょうど/明日23:59/明後日0:00、L除外、参加済除外、未記入の組合せ、email無し、送信済みスキップ）、本文組み立て（片方だけ未記入時のURL出し分け、テストモードの付記）
- `parser.test.ts`: email 列の追加読み取り
- web: `/ingest-reminded` `/api/reminded` `/remind` のハンドラテスト（既存 handlers のテスト様式に合わせる）
- E2E（手動）: ①ローカル `REMINDER_DRY_RUN=1 npm run remind` で対象一覧を目視 → ②`REMINDER_TEST_EMAIL` で実送信確認 → ③本番切替

## 実装順（「まず試したい」対応）

1. **Phase 1（ローカルで試せる）**: parser email ＋ reminder.ts ＋ mailer ＋ remind.ts。`REMINDER_DRY_RUN=1` でローカル実行し対象一覧を確認できる。web未改修でも DRY_RUN は動く（フラグ取得スキップ）
2. **Phase 2**: web のフラグ保存/照会エンドポイント ＋ reminder.yml（ユーザー作成）＋ Secrets 登録 → テストメール送信
3. **Phase 3**: web の 📧 ボタン ＋ /remind ＋ 結果表示 → テスト期間を経て本番切替
