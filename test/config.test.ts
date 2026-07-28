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
  it('shiftCalendarIdは未設定でも例外にならず既定値になる', () => {
    const c = loadConfig(base);
    expect(c.shiftCalendarId).toBe('2p5l9qaudhcjesc29pmrkhgs2o@group.calendar.google.com');
  });
  it('shiftCalendarIdはGOOGLE_SHIFT_CALENDAR_IDで上書きできる', () => {
    const c = loadConfig({ ...base, GOOGLE_SHIFT_CALENDAR_ID: 'override@group.calendar.google.com' });
    expect(c.shiftCalendarId).toBe('override@group.calendar.google.com');
  });
});

describe('MFA関連の設定', () => {
  const base = {
    URAKATA_URL: 'https://example.com/',
    URAKATA_LOGIN_ID: 'id',
    URAKATA_PASSWORD: 'pw',
    GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
    GOOGLE_CALENDAR_ID: 'cal',
  };

  it('未設定なら otpImapUser/otpImapPassword は undefined、storageStatePath は既定値', () => {
    const cfg = loadConfig(base);
    expect(cfg.otpImapUser).toBeUndefined();
    expect(cfg.otpImapPassword).toBeUndefined();
    expect(cfg.storageStatePath).toBe('.auth/storage-state.json');
  });

  it('設定すれば読み込まれる（前後空白は除去）', () => {
    const cfg = loadConfig({
      ...base,
      OTP_IMAP_USER: ' supsupnikko@gmail.com ',
      OTP_IMAP_PASSWORD: ' apppass ',
      STORAGE_STATE_PATH: ' /tmp/state.json ',
    });
    expect(cfg.otpImapUser).toBe('supsupnikko@gmail.com');
    expect(cfg.otpImapPassword).toBe('apppass');
    expect(cfg.storageStatePath).toBe('/tmp/state.json');
  });
});
