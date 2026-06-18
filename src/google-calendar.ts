import { google, calendar_v3 } from 'googleapis';
import type { CalendarClient, CalendarEvent } from './types.js';

const TZ = 'Asia/Tokyo';

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
      const res = await this.cal.events.list({
        calendarId: this.calendarId,
        timeMin: opts.timeMin.toISOString(),
        timeMax: opts.timeMax.toISOString(),
        singleEvents: true,
        maxResults: 2500,
        pageToken,
      });
      for (const e of res.data.items ?? []) {
        if (e.id && e.id.startsWith(opts.idPrefix)) ids.push(e.id);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return ids;
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
      await this.cal.events.insert({ calendarId: this.calendarId, requestBody: body });
    } catch (err: any) {
      if (err?.code === 409) {
        await this.cal.events.update({ calendarId: this.calendarId, eventId: event.id, requestBody: body });
      } else {
        throw err;
      }
    }
  }

  async deleteEvent(id: string): Promise<void> {
    try {
      await this.cal.events.delete({ calendarId: this.calendarId, eventId: id });
    } catch (err: any) {
      if (err?.code !== 404 && err?.code !== 410) throw err;
    }
  }
}
