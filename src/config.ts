export interface AppConfig {
  baseUrl: string;
  loginId: string;
  password: string;
  serviceAccountJson: string;
  calendarId: string;
  syncDaysAhead: number;
  shiftCalendarId: string;
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const req = (k: string): string => {
    const v = (env[k] ?? '').trim();
    if (!v) throw new Error(`環境変数 ${k} が未設定です`);
    return v;
  };
  return {
    baseUrl: req('URAKATA_URL'),
    loginId: req('URAKATA_LOGIN_ID'),
    password: req('URAKATA_PASSWORD'),
    serviceAccountJson: req('GOOGLE_SERVICE_ACCOUNT_JSON'),
    calendarId: req('GOOGLE_CALENDAR_ID'),
    syncDaysAhead: Number.parseInt((env['SYNC_DAYS_AHEAD'] ?? '90').trim(), 10) || 90,
    // シフト決定用カレンダー: 必須ではない（未共有の間は取得側でwarnして継続）。envで上書き可。
    shiftCalendarId: (env['GOOGLE_SHIFT_CALENDAR_ID'] ?? '').trim() || '2p5l9qaudhcjesc29pmrkhgs2o@group.calendar.google.com',
  };
}
