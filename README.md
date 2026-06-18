# urakata-calendar-sync

## 1. 概要

ウラカタ（予約管理システム）の「確定」「仮予約」ステータスの予約を、毎時0分に専用のGoogleカレンダーへ自動同期するツールです。

- **読み取り専用（閲覧目的）**: 社内スタッフがGoogleカレンダー上で予約状況を確認するための仕組みです。カレンダー側のイベントを人手で編集しても、次の同期で上書きされます。
- **冪等同期**: 同じ予約が何度同期されても、重複してイベントが作成されることはありません。2回目以降の実行では `created=0` になります。
- **対象期間**: 実行時刻から90日先まで（`SYNC_DAYS_AHEAD` 環境変数で変更可）。

---

## 2. アーキテクチャ

```
GitHub Actions (毎時 cron)
  └─ src/main.ts
       ├─ src/fetcher.ts  ── Playwright でウラカタにログイン → 予約CSV をダウンロード
       ├─ src/parser.ts   ── CSV を CalendarEvent[] に変換
       └─ src/syncer.ts   ── Google Calendar API で冪等 upsert / delete
```

処理の流れ:

1. **Playwright ログイン**: ヘッドレスChromiumでウラカタにログインし、認証済みクッキーを使ってCSVをダウンロード。
2. **CSV解析**: `csv-parse` で行を読み込み、コース名・所要時間・ステータスに応じてイベントIDとカラーを付与。
3. **Google Calendar 同期**: サービスアカウント認証で直接 API を呼び出し、既存イベントをupsert、不要なものを削除。

---

## 3. Googleサービスアカウントの準備

1. [GCPコンソール](https://console.cloud.google.com/) でプロジェクトを作成（または既存のプロジェクトを使用）。
2. 「APIとサービス」→「ライブラリ」から **Google Calendar API** を検索して有効化。
3. 「APIとサービス」→「認証情報」→「認証情報を作成」→「サービスアカウント」を選択し、任意の名前（例: `urakata-sync`）で作成。
4. 作成したサービスアカウントのページを開き、「キー」タブ →「鍵を追加」→「新しい鍵を作成」→「JSON」を選択してダウンロード。

   ダウンロードしたJSONファイルの内容（`{ "type": "service_account", ... }` の全体）が `GOOGLE_SERVICE_ACCOUNT_JSON` シークレットに登録する値になります。

---

## 4. 専用カレンダーの準備

1. Googleカレンダーを開き、左サイドバーの「他のカレンダー」の「+」→「新しいカレンダーを作成」をクリック。
2. 名前に `Sup! Sup! 予約` と入力して「カレンダーを作成」。
3. 作成したカレンダーの「...」→「設定と共有」を開く。
4. 「特定のユーザーやグループと共有する」→「ユーザーを追加」で、手順3で作成したサービスアカウントのメールアドレス（例: `urakata-sync@your-project.iam.gserviceaccount.com`）を入力し、権限を「**予定の変更**」に設定して「送信」。
5. 同じ設定ページの「カレンダーの統合」セクションから **カレンダーID**（例: `abc123@group.calendar.google.com`）をコピーする。これが `GOOGLE_CALENDAR_ID` シークレットの値になります。

---

## 5. GitHubリポジトリとSecrets

1. このリポジトリを **プライベート** でGitHubにpushします。

   ```bash
   git remote add origin https://github.com/DaisukeHukuda/urakata-calendar.git
   git push -u origin main
   ```

2. GitHubリポジトリの **Settings → Secrets and variables → Actions → New repository secret** で以下の5つを登録します。

   | シークレット名 | 値の説明 |
   |---|---|
   | `URAKATA_URL` | `https://supsup.urkt.in/` |
   | `URAKATA_LOGIN_ID` | ウラカタのログインID |
   | `URAKATA_PASSWORD` | ウラカタのパスワード |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | JSONキーファイルの内容全体（`{...}` ） |
   | `GOOGLE_CALENDAR_ID` | 手順4で取得したカレンダーID |

---

## 6. ローカル実行

```bash
# 1. 依存パッケージをインストール
npm install

# 2. Playwright用Chromiumをインストール
npx playwright install chromium

# 3. 環境変数ファイルを作成
cp .env.example .env
# .env を開いて各値を設定

# 4. 同期実行
npm run sync
```

`.env.example` の内容:

```
URAKATA_URL=https://supsup.urkt.in/
URAKATA_LOGIN_ID=
URAKATA_PASSWORD=
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_CALENDAR_ID=
SYNC_DAYS_AHEAD=90
```

> **注意**: `npm run sync` は実際にウラカタへのログインとGoogle Calendar APIの書き込みを行います。テスト目的では使用しないでください。テストは `npm test` で実行します。

---

## 7. 動作・運用

- **自動実行**: GitHub Actions の cron により、毎時0分 (UTC) に自動実行されます（日本時間で毎時9時・10時・...）。
- **手動実行**: GitHubリポジトリの **Actions タブ** → `urakata-calendar-sync` ワークフロー → 右上の **「Run workflow」** ボタンから即時実行できます。
- **実行ログ**: 各実行の詳細ログはActionsタブの該当ジョブで確認できます。最終行に以下のようなサマリが出力されます。

  ```
  [sync] created=5 updated=2 deleted=1 skippedDelete=false
  ```

---

## 8. トラブルシュート

**ログイン失敗 (`ウラカタのログインに失敗しました`)**
- `URAKATA_LOGIN_ID` / `URAKATA_PASSWORD` の値を確認してください。
- ウラカタ側でIPアドレス制限が追加された可能性があります。

**CSVが空・ヘッダが見つからないエラー**
- セッション切れの可能性があります（Playwrightはステートレスなので通常起こりにくいですが、サイト側の問題の場合があります）。
- `SYNC_DAYS_AHEAD` や日付範囲を確認し、対象期間に予約が存在するか確認してください。
- ウラカタのCSVエクスポートURL（`/reservations/search.csv`）のパスが変更された可能性があります。

**GitHub Actions失敗時**
- ジョブが失敗すると、GitHubから登録メールアドレスに通知が届きます。
- Actionsタブのログでエラー内容を確認し、上記の原因を参考に対処してください。

**冪等同期について**
- 同じ内容の予約に対して2回目以降の同期を実行すると `created=0 updated=0 deleted=0` となるのが正常な動作です。
- カレンダー上のイベントを手動で変更しても、次回の同期で元に戻ります。

---

## 9. 仕組みの制約

- **CAPTCHA / 2要素認証**: ウラカタ側にCAPTCHAや2要素認証が導入された場合、Playwrightによるログインが機能しなくなり、`src/fetcher.ts` の再設計が必要になります。
- **イベント所要時間**: デフォルトの所要時間は120分です。コース別に変更するには `src/types.ts` の `DEFAULT_SYNC_CONFIG.courseDurations` にコース名をキーとした分数を追加してください。

  ```ts
  // 例: 「体験コース」を60分、「ファミリーコース」を180分にする
  export const DEFAULT_SYNC_CONFIG: SyncConfig = {
    ...
    courseDurations: {
      '体験コース': 60,
      'ファミリーコース': 180,
    },
  };
  ```

- **タイムゾーン**: CSV内の日時はJST（+09:00）として解釈します。サーバーのシステムタイムゾーンに依存しない実装になっています。
- **削除の安全ガード**: 同期対象イベントが全件削除されそうな場合（バグや誤った日付範囲指定を想定）、`skippedDelete=true` となりイベントの削除をスキップします。
