import type { Reservation } from './types.js';

// Webカレンダーへ公開するステータス。参加済も含める（実施後も当日の予約を表示し続けるため）。
export const WEB_PUBLISH_STATUSES = new Set(['予約確定', '仮予約', '参加済']);

export function selectForWeb(reservations: Reservation[]): Reservation[] {
  return reservations.filter(r => WEB_PUBLISH_STATUSES.has(r.status));
}

export interface ReservationDTO {
  reservationId: string; courseName: string; startISO: string;
  pax: number; customerName: string; customerKana?: string; phone?: string; status: string;
  customerMemo?: string; totalAmount?: string; breakdown?: string;
  supExperience?: string; companions?: string; howFound?: string;
}

export function toDTOs(reservations: Reservation[]): ReservationDTO[] {
  return reservations.map(r => ({
    reservationId: r.reservationId,
    courseName: r.courseName,
    startISO: r.start.toISOString(),
    pax: r.pax,
    customerName: r.customerName,
    customerKana: r.customerKana,
    phone: r.phone,
    status: r.status,
    customerMemo: r.customerMemo,
    totalAmount: r.totalAmount,
    breakdown: r.breakdown,
    supExperience: r.supExperience,
    companions: r.companions,
    howFound: r.howFound,
  }));
}

export async function publishToWeb(url: string, secret: string, reservations: Reservation[]): Promise<void> {
  const resp = await fetch(`${url.replace(/\/$/, '')}/ingest`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(toDTOs(reservations)),
  });
  if (!resp.ok) throw new Error(`web ingest failed: HTTP ${resp.status}`);
}

function normPhone(s?: string): string {
  return (s ?? '').replace(/[^0-9]/g, '');
}

export function countRepeats(reservations: Reservation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of reservations) {
    if (r.status !== '参加済') continue;
    if (r.courseName.includes('L')) continue;
    const phone = normPhone(r.phone);
    if (!phone || /^0+$/.test(phone)) continue;
    counts[phone] = (counts[phone] ?? 0) + 1;
  }
  return counts;
}

export async function publishRepeats(url: string, secret: string, repeats: Record<string, number>): Promise<void> {
  const resp = await fetch(`${url.replace(/\/$/, '')}/ingest-repeats`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(repeats),
  });
  if (!resp.ok) throw new Error(`repeats ingest failed: HTTP ${resp.status}`);
}
