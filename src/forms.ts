import { google } from 'googleapis';

export interface FormStatus { consent: boolean; emergency: boolean }

export function normDate(s: string): string {
  const m = (s ?? '').match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}
export function normName(s: string): string {
  return (s ?? '').normalize('NFKC').replace(/[\s　]/g, '');
}
export function normPhone(s: string): string {
  return (s ?? '').normalize('NFKC').replace(/[^0-9]/g, '');
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

export interface FormResponse { date: string; names: string[]; phones: Set<string> }

// 回答シートを「回答の配列」に変換。日付は任意項目として保持（照合の必須キーにはしない）。
export function parseFormResponses(
  values: string[][],
  cfg: { dateKeywords: string[]; nameKeywords: string[]; phoneKeywords: string[] },
): FormResponse[] {
  const out: FormResponse[] = [];
  if (!values.length) return out;
  const header = values[0];
  const dateIdx = colIndexes(header, cfg.dateKeywords)[0];
  const nameIdxs = colIndexes(header, cfg.nameKeywords);
  const phoneIdxs = colIndexes(header, cfg.phoneKeywords);
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const date = dateIdx === undefined ? '' : normDate(row[dateIdx] ?? '');
    const names: string[] = [];
    for (const ni of nameIdxs) { const nm = normName(row[ni] ?? ''); if (nm) names.push(nm); }
    const phones = new Set<string>();
    for (const pi of phoneIdxs) { const ph = normPhone(row[pi] ?? ''); if (ph) phones.add(ph); }
    if (!names.length && !phones.size) continue;
    out.push({ date, names, phones });
  }
  return out;
}

// 'YYYY-MM-DD' 2つの絶対日数差。
export function dayDiff(a: string, b: string): number {
  const ta = Date.parse(a + 'T00:00:00Z');
  const tb = Date.parse(b + 'T00:00:00Z');
  return Math.abs(ta - tb) / 86400000;
}

// 列特定キーワード。フォームに「カナ氏名」「携帯番号」が追加されれば自動で拾う。
export const CONSENT_CFG = { dateKeywords: ['日付'], nameKeywords: ['氏名', 'カナ', 'ふりがな', 'フリガナ'], phoneKeywords: ['携帯', '電話'] };
export const EMERGENCY_CFG = { dateKeywords: ['参加の日付', '日付'], nameKeywords: ['参加者', 'カナ', 'ふりがな', 'フリガナ'], phoneKeywords: ['携帯番号'] };

// 回答 f が予約（氏名候補 cands / 電話 phone）に一致するか。日付は見ない。
function responseMatches(f: FormResponse, cands: string[], phone: string): boolean {
  if (phone && f.phones.has(phone)) return true;
  return cands.some((c) => !!c && f.names.some((n) => n.includes(c) || c.includes(n)));
}

export function matchForms(
  reservations: { reservationId: string; start: Date; customerName: string; customerKana?: string; phone?: string }[],
  consent: FormResponse[],
  emergency: FormResponse[],
): Record<string, FormStatus> {
  const rinfo = reservations.map((rv) => ({
    id: rv.reservationId,
    rdate: jstDateOf(rv.start),
    cands: [normName(rv.customerName), normName(rv.customerKana ?? '')].filter((s) => !!s),
    phone: normPhone(rv.phone ?? ''),
  }));
  const out: Record<string, FormStatus> = {};
  for (const r of rinfo) out[r.id] = { consent: false, emergency: false };

  const assign = (responses: FormResponse[], key: 'consent' | 'emergency'): void => {
    for (const f of responses) {
      const matched = rinfo.filter((r) => responseMatches(f, r.cands, r.phone));
      if (matched.length === 0) continue;
      let targets = matched;
      if (matched.length > 1 && f.date) {
        let best = matched[0];
        for (const r of matched) {
          if (dayDiff(f.date, r.rdate) < dayDiff(f.date, best.rdate)) best = r;
        }
        targets = [best];
      }
      for (const r of targets) out[r.id][key] = true;
    }
  };
  assign(consent, 'consent');
  assign(emergency, 'emergency');
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
