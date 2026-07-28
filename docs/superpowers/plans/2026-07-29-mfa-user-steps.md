# MFA対応・ユーザー作業手順（2026-07-29）

syncのMFA(2段階認証)対応コードは実装・コミット済み。復旧には以下の福田さんの作業が必要。
上から順に実施する。所要時間の目安: 全部で15〜20分。

---

## Step 1: Gmail（supsupnikko@gmail.com）でアプリパスワードを発行

syncがOTPメールを自動で読むための「アプリ専用の合鍵」を作る。

1. ブラウザで supsupnikko@gmail.com にログイン
2. https://myaccount.google.com/security を開く
3. 「2段階認証プロセス」が**オフなら先にオンにする**（アプリパスワードは2段階認証が有効でないと発行できない）
4. https://myaccount.google.com/apppasswords を開く
5. アプリ名に「urakata-sync」と入力して作成
6. 表示される**16文字のパスワード**を控える（スペースは除いて使う）

## Step 2: ウラカタに一度手動ログインして認証用メールを登録

1. ブラウザ（シークレットウィンドウ推奨）で https://supsup.urkt.in/ を開く
2. **syncが使っているログインID/パスワード**（GitHub Secrets の URAKATA_LOGIN_ID / URAKATA_PASSWORD と同じもの）でログイン
3. 「2段階認証で使用するメールアドレス登録画面」が出たら **supsupnikko@gmail.com** を入力
4. supsupnikko@gmail.com に届いた認証コードを入力してログイン完了
5. ⚠️ もし登録画面が出ず、**既に別のメールアドレスに認証コードが飛ぶ**場合は、そのアドレスをClaudeに伝える（設定画面で supsupnikko@gmail.com に変更できるならそれでもOK）

※このとき「このデバイスを信頼する」のチェックは**どちらでもよい**（福田さんのブラウザの話で、syncには影響しない）。
※ついでにOTP画面のスクリーンショットを撮ってClaudeに共有してもらえると、画面の文言・ボタン名が想定と合っているか確認できて安心。

## Step 3: GitHub Secrets を2つ追加

https://github.com/DaisukeHukuda/urakata-calendar → Settings → Secrets and variables → Actions → New repository secret

| Name | Value |
|---|---|
| `OTP_IMAP_USER` | `supsupnikko@gmail.com` |
| `OTP_IMAP_PASSWORD` | Step 1 の16文字（**スペースなし**で貼り付け） |

## Step 4: sync.yml を書き換え（GitHub画面から）

https://github.com/DaisukeHukuda/urakata-calendar/edit/main/.github/workflows/sync.yml を開き、
**全文を以下に置き換えて** Commit changes する。

変更点は3つ: ①ログイン状態の復元ステップ追加 ②env に3行追加 ③ログイン状態の保存ステップ追加（+ OTP待ちがあるため timeout を10→15分に）。

```yaml
name: urakata-calendar-sync
on:
  schedule:
    - cron: '*/30 * * * *'
  workflow_dispatch: {}
concurrency:
  group: urakata-sync
  cancel-in-progress: false
jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 15
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
      - run: npx playwright install --with-deps chromium
      - name: Restore login state
        uses: actions/cache/restore@v4
        with:
          path: .auth
          key: urakata-auth-${{ github.run_id }}
          restore-keys: |
            urakata-auth-
      - run: npm run sync
        env:
          URAKATA_URL: ${{ secrets.URAKATA_URL }}
          URAKATA_LOGIN_ID: ${{ secrets.URAKATA_LOGIN_ID }}
          URAKATA_PASSWORD: ${{ secrets.URAKATA_PASSWORD }}
          GOOGLE_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
          GOOGLE_CALENDAR_ID: ${{ secrets.GOOGLE_CALENDAR_ID }}
          SYNC_DAYS_AHEAD: '240'
          WEB_INGEST_URL: ${{ secrets.WEB_INGEST_URL }}
          WEB_INGEST_SECRET: ${{ secrets.WEB_INGEST_SECRET }}
          HISTORY_SALT: ${{ secrets.HISTORY_SALT }}
          HISTORY_SYNC_HOURS: ${{ vars.HISTORY_SYNC_HOURS }}
          OTP_IMAP_USER: ${{ secrets.OTP_IMAP_USER }}
          OTP_IMAP_PASSWORD: ${{ secrets.OTP_IMAP_PASSWORD }}
          STORAGE_STATE_PATH: .auth/storage-state.json
      - name: Save login state
        if: always()
        uses: actions/cache/save@v4
        with:
          path: .auth
          key: urakata-auth-${{ github.run_id }}
```

## Step 5: 反映と動作確認

1. Claudeに「push して sync 回して」と言う（ローカルの実装コミットを push → Run workflow 起動）
2. Actions のログを確認。成功の目印:
   - いつもどおり `[sync] parsed N events` が出る
   - カレンダー/webが最新化される
3. 初回はOTPメール読取が走るので数分余計にかかる。2回目以降は保存された状態でOTPなしログインになるはず
4. 失敗した場合はログのエラーメッセージ（日本語で原因が出る）をClaudeに共有

---

## 仕組みの復習（1分版）

- ログイン成功時に「このデバイスを信頼する」をチェック → その状態（Cookie等）をファイルに保存し、GitHub Actionsのキャッシュで次回実行に引き継ぐ → **30日間はOTPなし**
- 30日切れ等で失敗したら、自動で状態を捨ててフルログイン → supsupnikko@gmail.com に届く認証コードをIMAPで自動読取して入力 → 新しい状態を保存
- つまり**セットアップ後は放置でOK**。OTPメールが supsupnikko@gmail.com に月1回程度届くのは正常な動作
- 注意: GitHub Actionsのキャッシュは**7日間使われないと消える**が、このsyncは30分ごとに動くので実質問題なし。長期間ワークフローを止めた後の再開時はOTP読取から自動復旧する
