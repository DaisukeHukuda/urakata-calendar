import { google, calendar_v3 } from 'googleapis';
import type { CalendarClient, CalendarEvent } from './types.js';

const TZ = 'Asia/Tokyo';
const WRITE_THROTTLE_MS = 120; // 書き込み間隔（バースト緩和）

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// レート制限(403 rateLimitExceeded / 429)や一時的なサーバーエラー(5xx)はリトライ対象
function isRetryable(err: any): boolean {
  const code = err?.code ?? err?.status;
  if (code === 429 || code === 500 || code === 503) return true;
  if (code === 403) {
    const reasons = (err?.errors ?? []).map((e: any) => e?.reason);
    return reasons.includes('rateLimitExceeded') || reasons.includes('userRateLimitExceeded');
  }
  return false;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || i === attempts - 1) throw err;
      lastErr = err;
      const delay = 1000 * 2 ** i + Math.floor(Math.random() * 250);
      console.warn(`[calendar] rate limited, retry ${i + 1}/${attempts - 1} after ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

export class GoogleCalendarClient implements CalendarClient {
  private cal: calendar_v3.Calendar;
  constructor(private calendarId: string, serviceAccountJson: string) {
    const creds = JSON.parse(serviceAccountJson);
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    this.cal = google.calendar({ version: 'v3', auth });
  }

  async listEventIds(opts: { timeMin: Date; timeMax: Date; idPrefix: string }): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const res = await withRetry(() => this.cal.events.list({
        calendarId: this.calendarId,
        timeMin: opts.timeMin.toISOString(),
        timeMax: opts.timeMax.toISOString(),
        singleEvents: true,
        maxResults: 2500,
        pageToken,
      }));
      for (const e of res.data.items ?? []) {
        if (e.id && e.id.startsWith(opts.idPrefix)) ids.push(e.id);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return ids;
  }

  // 任意カレンダーの予定を取得（このクライアントの認証を流用。calendarId はコンストラクタのものと別でよい）
  async listEvents(calendarId: string, timeMinISO: string, timeMaxISO: string): Promise<calendar_v3.Schema$Event[]> {
    const items: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const res = await withRetry(() => this.cal.events.list({
        calendarId,
        timeMin: timeMinISO,
        timeMax: timeMaxISO,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 2500,
        pageToken,
      }));
      items.push(...(res.data.items ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return items;
  }

  async upsertEvent(event: CalendarEvent): Promise<void> {
    const body: calendar_v3.Schema$Event = {
      id: event.id,
      summary: event.summary,
      description: event.description,
      colorId: event.colorId,
      start: { dateTime: event.start.toISOString(), timeZone: TZ },
      end: { dateTime: event.end.toISOString(), timeZone: TZ },
    };
    try {
      await withRetry(() => this.cal.events.insert({ calendarId: this.calendarId, requestBody: body }));
    } catch (err: any) {
      if (err?.code === 409) {
        await withRetry(() => this.cal.events.update({ calendarId: this.calendarId, eventId: event.id, requestBody: body }));
      } else {
        throw err;
      }
    }
    await sleep(WRITE_THROTTLE_MS);
  }

  async deleteEvent(id: string): Promise<void> {
    try {
      await withRetry(() => this.cal.events.delete({ calendarId: this.calendarId, eventId: id }));
    } catch (err: any) {
      if (err?.code !== 404 && err?.code !== 410) throw err;
    }
    await sleep(WRITE_THROTTLE_MS);
  }
}
