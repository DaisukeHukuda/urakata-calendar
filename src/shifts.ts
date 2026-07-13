// 「シフト決定用」カレンダーの予定 → Web公開用の日付別マップに変換する純粋関数群（副作用なし・単体テスト対象）

export interface ShiftEntry {
  title: string;
  time?: string; // JST HH:mm。終日予定は省略
}

// googleapis の calendar_v3.Schema$Event と構造的互換（必要なフィールドのみ）
export interface ShiftCalendarEvent {
  summary?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
}

// JSTの日付(YYYY-MM-DD)と時刻(HH:mm)を同時に取り出す（ロケール表記ゆれを避けるため formatToParts を使う）
const JST_DATETIME_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function jstDateTime(iso: string): { date: string; time: string } {
  const parts = JST_DATETIME_FMT.formatToParts(new Date(iso));
  const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

// [startDate, endDateExclusive) の YYYY-MM-DD を1日刻みで列挙する（Googleの終日予定の end は排他的）
function* dateRange(startDate: string, endDateExclusive: string): Generator<string> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDateExclusive}T00:00:00Z`);
  for (let d = start; d < end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    yield d.toISOString().slice(0, 10);
  }
}

export function buildShiftMap(items: ShiftCalendarEvent[]): Record<string, ShiftEntry[]> {
  const map: Record<string, ShiftEntry[]> = {};
  const push = (date: string, entry: ShiftEntry): void => {
    (map[date] ??= []).push(entry);
  };

  for (const item of items ?? []) {
    const title = (item.summary ?? '').trim() || '(無題)';
    if (item.start?.dateTime) {
      const { date, time } = jstDateTime(item.start.dateTime);
      push(date, { title, time });
    } else if (item.start?.date) {
      // end.date は排他的。無い/開始以前でも最低1日分は載せる（範囲が空になり予定が消えるのを防ぐ）
      if (item.end?.date && item.end.date > item.start.date) {
        for (const date of dateRange(item.start.date, item.end.date)) {
          push(date, { title });
        }
      } else {
        push(item.start.date, { title });
      }
    }
  }

  // 終日予定（timeなし）を先頭、時間指定は時刻の昇順
  for (const date of Object.keys(map)) {
    map[date].sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return -1;
      if (!b.time) return 1;
      return a.time.localeCompare(b.time);
    });
  }

  return map;
}
