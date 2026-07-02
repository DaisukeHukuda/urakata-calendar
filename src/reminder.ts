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
