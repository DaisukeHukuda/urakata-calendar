export interface AppConfig {
  baseUrl: string;
  loginId: string;
  password: string;
  serviceAccountJson: string;
  calendarId: string;
  syncDaysAhead: number;
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
  };
}
