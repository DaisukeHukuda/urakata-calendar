export interface Reservation {
  reservationId: string;
  courseName: string;
  start: Date;
  pax: number;
  customerName: string;
  customerKana?: string;
  status: string;
  phone?: string;
  breakdown?: string;
  memo?: string;
  media?: string;
  customerMemo?: string;
  totalAmount?: string;
  supExperience?: string;
  companions?: string;
  howFound?: string;
}

export interface SyncConfig {
  defaultDurationMinutes: number;
  courseDurations: Record<string, number>;
  confirmedColorId: string;
  provisionalColorId: string;
  idPrefix: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  colorId: string;
}

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  skippedDelete: boolean;
}

export interface CalendarClient {
  listEventIds(opts: { timeMin: Date; timeMax: Date; idPrefix: string }): Promise<string[]>;
  upsertEvent(event: CalendarEvent): Promise<void>;
  deleteEvent(id: string): Promise<void>;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  defaultDurationMinutes: 120,
  courseDurations: {},
  confirmedColorId: '9',
  provisionalColorId: '5',
  idPrefix: 'urkt',
};
