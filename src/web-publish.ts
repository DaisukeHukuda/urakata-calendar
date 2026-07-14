import { createHmac } from 'node:crypto';
import type { Reservation } from './types.js';
import type { FormStatus } from './forms.js';
import type { ShiftEntry } from './shifts.js';

// Webカレンダーへ公開するステータス。参加済も含める（実施後も当日の予約を表示し続けるため）。
// 承認待ちのリクエスト予約もカレンダーに表示する（承認/お断りで自動的に置き換わる）。
export const WEB_PUBLISH_STATUSES = new Set(['予約確定', '仮予約', '参加済', 'リクエスト']);

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

function jstDateOf(d: Date): string {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
}

export function repeatVisitDates(reservations: Reservation[]): Record<string, string[]> {
  const sets: Record<string, Set<string>> = {};
  for (const r of reservations) {
    if (r.status !== '参加済') continue;
    if (r.courseName.includes('L')) continue;
    const phone = normPhone(r.phone);
    if (!phone || /^0+$/.test(phone)) continue;
    (sets[phone] ??= new Set<string>()).add(jstDateOf(r.start));
  }
  const out: Record<string, string[]> = {};
  for (const [p, set] of Object.entries(sets)) out[p] = [...set].sort();
  return out;
}

export async function publishRepeats(url: string, secret: string, repeats: Record<string, string[]>): Promise<void> {
  const resp = await fetch(`${url.replace(/\/$/, '')}/ingest-repeats`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(repeats),
  });
  if (!resp.ok) throw new Error(`repeats ingest failed: HTTP ${resp.status}`);
}

export async function publishForms(url: string, secret: string, map: Record<string, FormStatus>): Promise<void> {
  const resp = await fetch(`${url.replace(/\/$/, '')}/ingest-forms`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(map),
  });
  if (!resp.ok) throw new Error(`forms ingest failed: HTTP ${resp.status}`);
}

export async function publishShifts(url: string, secret: string, map: Record<string, ShiftEntry[]>): Promise<void> {
  const resp = await fetch(`${url.replace(/\/$/, '')}/ingest-shifts`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(map),
  });
  if (!resp.ok) throw new Error(`shifts ingest failed: HTTP ${resp.status}`);
}

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

export interface HistoryRecord {
  date: string; course: string; pax: number; amount: number; status: string; phoneHash: string;
}

export function parseAmount(s: string | undefined): number {
  const digits = (s ?? '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

export function hashPhone(phone: string | undefined, salt: string): string {
  const p = (phone ?? '').replace(/[^0-9]/g, '');
  if (!p || /^0+$/.test(p)) return '';
  return createHmac('sha256', salt).update(p).digest('hex').slice(0, 16);
}

export function buildHistoryRecords(reservations: Reservation[], salt: string): HistoryRecord[] {
  return reservations.map(r => ({
    date: jstDateOf(r.start),
    course: r.courseName,
    pax: r.pax,
    amount: parseAmount(r.totalAmount),
    status: r.status,
    phoneHash: hashPhone(r.phone, salt),
  }));
}
