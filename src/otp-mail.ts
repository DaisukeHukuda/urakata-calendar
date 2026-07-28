import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

/** OTPメール1通ぶんの最小情報 */
export interface OtpMailRecord {
  receivedAt: Date;
  text: string; // 件名+本文の連結テキスト
}

/** since 以降に受信したメール群を返す関数（IMAP実装をテストから差し替え可能にする） */
export type OtpMailFetcher = (since: Date) => Promise<OtpMailRecord[]>;

/**
 * メール本文から認証コード（4〜8桁）を抽出する。
 * ウラカタの実物は「■認証コード：208404」形式。日付等の無関係な数字を拾わないよう
 * 「認証コード」の直後（記号・空白を挟んで）に現れる数字列のみを対象にする。
 */
export function extractOtpCode(text: string): string | null {
  const m = text.match(/認証コード[^0-9]{0,10}(\d{4,8})/);
  return m ? m[1] : null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * since 以降に届くOTPメールをポーリングで待ち、認証コードを返す。
 * 既定: 5秒間隔・最大3分。時間内に届かなければ日本語メッセージで例外。
 * since には既定90秒の猶予を持たせる（GitHubランナーの時計がメールサーバーより
 * 進んでいると、ログイン直後に届いたメールを「since より古い」と誤判定して
 * 永遠に見つけられなくなるため。2026-07-29 の本番障害で実際に発生）。
 */
export async function waitForOtpCode(
  fetchMails: OtpMailFetcher,
  since: Date,
  opts: { timeoutMs?: number; intervalMs?: number; graceMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const intervalMs = opts.intervalMs ?? 5_000;
  const graceMs = opts.graceMs ?? 90_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mails = await fetchMails(since);
    const newest = mails
      .filter((m) => m.receivedAt.getTime() >= since.getTime() - graceMs)
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
    for (const mail of newest) {
      const code = extractOtpCode(mail.text);
      if (code) return code;
    }
    if (Date.now() >= deadline) {
      throw new Error('OTPの認証コードメールが時間内に届きませんでした（メール登録アドレスとIMAP設定を確認してください）');
    }
    await sleep(intervalMs);
  }
}

/**
 * Gmail(IMAP) から直近のメールを取得する OtpMailFetcher を作る。
 * 認証は Google の「アプリパスワード」を想定（2段階認証プロセス有効のアカウントで発行）。
 * IMAP の SINCE 検索は日単位のため、取得後に receivedAt で厳密に絞るのは waitForOtpCode 側の責務。
 */
export function createImapOtpFetcher(cfg: { user: string; password: string; host?: string }): OtpMailFetcher {
  return async (since: Date) => {
    const client = new ImapFlow({
      host: cfg.host ?? 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: cfg.user, pass: cfg.password },
      logger: false,
    });
    await client.connect();
    try {
      // 「すべてのメール」を開く（受信箱スキップのフィルタでアーカイブされたOTPメールも読めるように）。
      // Gmailのフォルダ名はUI言語でローカライズされるため、special-use属性(\All)で探す。
      // 見つからなければ INBOX にフォールバック。
      const boxes = await client.list();
      const allMail = boxes.find((b) => b.specialUse === '\\All');
      await client.mailboxOpen(allMail ? allMail.path : 'INBOX');
      const uids = await client.search({ since }, { uid: true });
      const recent = (uids || []).slice(-10); // 直近10通で十分（search は失敗時 false を返す）
      const out: OtpMailRecord[] = [];
      if (recent.length > 0) {
        for await (const msg of client.fetch(recent.join(','), { source: true, internalDate: true }, { uid: true })) {
          const parsed = await simpleParser(msg.source as Buffer);
          out.push({
            receivedAt: (msg.internalDate as Date | undefined) ?? new Date(0),
            text: `${parsed.subject ?? ''}\n${parsed.text ?? ''}`,
          });
        }
      }
      return out;
    } finally {
      await client.logout().catch(() => {/* 切断失敗は無視 */});
    }
  };
}
