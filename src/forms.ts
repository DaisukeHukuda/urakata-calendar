import { google } from 'googleapis';

export interface FormStatus { consent: boolean; emergency: boolean }

export function normDate(s: string): string {
  const m = (s ?? '').match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}
export function normName(s: string): string {
  return (s ?? '').replace(/[\s　]/g, '');
}
export function normPhone(s: string): string {
  return (s ?? '').replace(/[^0-9]/g, '');
}

function jstDateOf(d: Date): string {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
}
function colIndex(header: string[], keyword: string): number {
  return header.findIndex((h) => (h ?? '').includes(keyword));
}

// 同意書: 参加日 → 氏名（連名フィールド）配列
export function parseConsent(values: string[][]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!values.length) return out;
  const header = values[0];
  const di = colIndex(header, '日付');
  const ni = colIndex(header, '氏名');
  if (di < 0 || ni < 0) return out;
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const d = normDate(row[di] ?? '');
    const name = normName(row[ni] ?? '');
    if (!d || !name) continue;
    const list = out.get(d) ?? [];
    list.push(name);
    out.set(d, list);
  }
  return out;
}

// 緊急連絡先: 参加日 → { 携帯番号集合, 参加者氏名配列 }
export function parseEmergency(values: string[][]): Map<string, { phones: Set<string>; names: string[] }> {
  const out = new Map<string, { phones: Set<string>; names: string[] }>();
  if (!values.length) return out;
  const header = values[0];
  const di = colIndex(header, '参加の日付') >= 0 ? colIndex(header, '参加の日付') : colIndex(header, '日付');
  const pi = colIndex(header, '携帯番号');
  const ni = colIndex(header, '参加者');
  if (di < 0) return out;
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const d = normDate(row[di] ?? '');
    if (!d) continue;
    const e = out.get(d) ?? { phones: new Set<string>(), names: [] };
    const ph = pi >= 0 ? normPhone(row[pi] ?? '') : '';
    if (ph) e.phones.add(ph);
    const nm = ni >= 0 ? normName(row[ni] ?? '') : '';
    if (nm) e.names.push(nm);
    out.set(d, e);
  }
  return out;
}

export function matchForms(
  reservations: { reservationId: string; start: Date; customerName: string; phone?: string }[],
  consent: Map<string, string[]>,
  emergency: Map<string, { phones: Set<string>; names: string[] }>,
): Record<string, FormStatus> {
  const out: Record<string, FormStatus> = {};
  for (const rv of reservations) {
    const d = jstDateOf(rv.start);
    const n = normName(rv.customerName);
    const p = normPhone(rv.phone ?? '');
    const cNames = consent.get(d) ?? [];
    const consentDone = !!n && cNames.some((cn) => cn.includes(n));
    const e = emergency.get(d);
    const emergencyDone = !!e && ((!!p && e.phones.has(p)) || (!!n && e.names.some((en) => en.includes(n))));
    out[rv.reservationId] = { consent: consentDone, emergency: emergencyDone };
  }
  return out;
}

// サービスアカウントで回答シートの値域を読む（最初のシート全体）。照合に使う列だけ後段で参照。
export async function readSheetValues(serviceAccountJson: string, sheetId: string): Promise<string[][]> {
  const creds = JSON.parse(serviceAccountJson);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'A1:AZ50000' });
  return (resp.data.values ?? []) as string[][];
}
