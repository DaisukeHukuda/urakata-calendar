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
