import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const base = {
    URAKATA_URL: 'https://x/', URAKATA_LOGIN_ID: 'a', URAKATA_PASSWORD: 'b',
    GOOGLE_SERVICE_ACCOUNT_JSON: '{}', GOOGLE_CALENDAR_ID: 'c',
  };
  it('必須が揃えば読み込める。SYNC_DAYS_AHEAD既定は90', () => {
    const c = loadConfig(base);
    expect(c.syncDaysAhead).toBe(90);
    expect(c.calendarId).toBe('c');
  });
  it('必須が欠けると例外', () => {
    expect(() => loadConfig({ ...base, URAKATA_LOGIN_ID: '' })).toThrow();
  });
});
