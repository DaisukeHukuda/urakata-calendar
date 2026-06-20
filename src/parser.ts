import { parse } from 'csv-parse/sync';
import type { Reservation, CalendarEvent, SyncConfig } from './types.js';

export function parseSankabi(s: string): { start: Date } | null {
  const m = (s ?? '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2}).*?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const iso =
    `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}` +
    `T${h.padStart(2, '0')}:${mi}:00+09:00`;
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return null;
  return { start };
}

export function parseReservations(csvText: string): Reservation[] {
  const records = parse(csvText, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];

  const out: Reservation[] = [];
  for (const rec of records) {
    const id = (rec['予約ID'] ?? '').trim();
    if (!id) continue;
    const parsed = parseSankabi(rec['参加日'] ?? '');
    if (!parsed) continue;
    out.push({
      reservationId: id,
      courseName: (rec['コース名'] ?? '').trim(),
      start: parsed.start,
      pax: Number.parseInt((rec['合計'] ?? '0').trim(), 10) || 0,
      customerName: (rec['予約者名'] ?? '').trim(),
      customerKana: (rec['予約者名カナ'] ?? '').trim() || undefined,
      status: (rec['ステータス'] ?? '').trim(),
      phone: (rec['電話番号'] ?? '').trim() || undefined,
      breakdown: (rec['内訳'] ?? '').trim() || undefined,
      memo: (rec['予約メモ'] ?? '').trim() || undefined,
      media: (rec['媒体'] ?? '').trim() || undefined,
      customerMemo: (rec['予約者メモ'] ?? '').trim() || undefined,
      totalAmount: (rec['合計金額'] ?? '').trim() || undefined,
      supExperience: (rec['●予約者のSUP経験の有無'] ?? '').trim() || undefined,
      companions: (rec['●同行者の名前(カナ)とSUP経験の有無'] ?? '').trim() || undefined,
      howFound: (rec['●ご予約の経緯'] ?? '').trim() || undefined,
    });
  }
  return out;
}

function normalizeId(prefix: string, reservationId: string): string {
  return `${prefix}${reservationId}`.toLowerCase().replace(/[^0-9a-v]/g, '');
}

export function toCalendarEvent(r: Reservation, cfg: SyncConfig): CalendarEvent {
  const isProvisional = r.status === '仮予約';
  const durationMin = cfg.courseDurations[r.courseName] ?? cfg.defaultDurationMinutes;
  const end = new Date(r.start.getTime() + durationMin * 60000);
  const prefix = isProvisional ? '【仮】' : '';
  const summary = `${prefix}${r.courseName}・${r.customerName}（${r.pax}名）`;
  const description = [
    `予約ID: ${r.reservationId}`,
    `ステータス: ${r.status}`,
    r.phone ? `電話: ${r.phone}` : '',
    r.breakdown ? `内訳: ${r.breakdown}` : '',
    r.memo ? `予約メモ: ${r.memo}` : '',
    r.media ? `媒体: ${r.media}` : '',
  ].filter(Boolean).join('\n');

  return {
    id: normalizeId(cfg.idPrefix, r.reservationId),
    summary,
    description,
    start: r.start,
    end,
    colorId: isProvisional ? cfg.provisionalColorId : cfg.confirmedColorId,
  };
}

const SYNCED_STATUSES = new Set(['予約確定', '仮予約']);

export function csvToEvents(csvText: string, cfg: SyncConfig): CalendarEvent[] {
  return parseReservations(csvText)
    .filter(r => SYNCED_STATUSES.has(r.status))
    .map(r => toCalendarEvent(r, cfg));
}
