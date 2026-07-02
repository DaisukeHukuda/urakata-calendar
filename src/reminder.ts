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

// 例: "7/3(金) 10:00"（Node ICUのja-JP出力。月/日は数字、曜日は括弧付き短縮形）
const JST_FMT = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
  weekday: 'short', hour: '2-digit', minute: '2-digit',
});

export function buildReminderEmail(
  t: ReminderTarget,
  urls: { consent: string; emergency: string },
): { subject: string; text: string } {
  const when = JST_FMT.format(t.start);
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
