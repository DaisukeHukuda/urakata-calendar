import { describe, it, expect } from 'vitest';
import { applyTestMode } from '../src/mailer.js';

const MAIL = { to: 'taro@example.com', toName: '山田太郎', subject: '件名', text: '本文' };

describe('applyTestMode', () => {
  it('テスト宛先未設定ならそのまま', () => {
    expect(applyTestMode(MAIL, undefined)).toEqual(MAIL);
  });
  it('テスト宛先設定時は宛先を差し替え、件名に【テスト】、本文に本来の宛先を付記', () => {
    const m = applyTestMode(MAIL, 'me@example.com');
    expect(m.to).toBe('me@example.com');
    expect(m.subject).toBe('【テスト】件名');
    expect(m.text).toContain('本来の宛先: 山田太郎 様 <taro@example.com>');
    expect(m.text).toContain('本文');
  });
});
