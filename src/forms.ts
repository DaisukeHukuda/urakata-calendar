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

function colIndexes(header: string[], keywords: string[]): number[] {
  const idx: number[] = [];
  header.forEach((h, i) => { if (keywords.some((k) => (h ?? '').includes(k))) idx.push(i); });
  return idx;
}

export interface FormIndexEntry { names: string[]; phones: Set<string> }

// 回答シートを「参加日 → {氏名(漢字/カナ等), 電話}」に索引化。列はキーワードで特定（名前・電話は複数列対応）。
export function parseFormResponses(
  values: string[][],
  cfg: { dateKeywords: string[]; nameKeywords: string[]; phoneKeywords: string[] },
): Map<string, FormIndexEntry> {
  const out = new Map<string, FormIndexEntry>();
  if (!values.length) return out;
  const header = values[0];
  const dateIdx = colIndexes(header, cfg.dateKeywords)[0];
  if (dateIdx === undefined) return out;
  const nameIdxs = colIndexes(header, cfg.nameKeywords);
  const phoneIdxs = colIndexes(header, cfg.phoneKeywords);
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const d = normDate(row[dateIdx] ?? '');
    if (!d) continue;
    const e = out.get(d) ?? { names: [], phones: new Set<string>() };
    for (const ni of nameIdxs) { const nm = normName(row[ni] ?? ''); if (nm) e.names.push(nm); }
    for (const pi of phoneIdxs) { const ph = normPhone(row[pi] ?? ''); if (ph) e.phones.add(ph); }
    out.set(d, e);
  }
  return out;
}

// 列特定キーワード。フォームに「カナ氏名」「携帯番号」が追加されれば自動で拾う。
export const CONSENT_CFG = { dateKeywords: ['日付'], nameKeywords: ['氏名', 'カナ', 'ふりがな', 'フリガナ'], phoneKeywords: ['携帯', '電話'] };
export const EMERGENCY_CFG = { dateKeywords: ['参加の日付', '日付'], nameKeywords: ['参加者', 'カナ', 'ふりがな', 'フリガナ'], phoneKeywords: ['携帯番号'] };

function entryMatches(e: FormIndexEntry | undefined, nameCands: string[], phone: string): boolean {
  if (!e) return false;
  if (phone && e.phones.has(phone)) return true;
  return nameCands.some((c) => !!c && e.names.some((n) => n.includes(c) || c.includes(n)));
}

export function matchForms(
  reservations: { reservationId: string; start: Date; customerName: string; customerKana?: string; phone?: string }[],
  consent: Map<string, FormIndexEntry>,
  emergency: Map<string, FormIndexEntry>,
): Record<string, FormStatus> {
  const out: Record<string, FormStatus> = {};
  for (const rv of reservations) {
    const d = jstDateOf(rv.start);
    const cands = [normName(rv.customerName), normName(rv.customerKana ?? '')].filter((s) => !!s);
    const p = normPhone(rv.phone ?? '');
    out[rv.reservationId] = {
      consent: entryMatches(consent.get(d), cands, p),
      emergency: entryMatches(emergency.get(d), cands, p),
    };
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
