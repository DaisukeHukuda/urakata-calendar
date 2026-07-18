import { describe, it, expect, vi, afterEach } from 'vitest';
import { publishLRepeats } from '../src/web-publish.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('publishLRepeats', () => {
  it('POSTs to /ingest-lrepeats with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await publishLRepeats('https://web.example/', 'sek', {
      '12345678': { count: 3, last: '2026-05-10' },
    });
    const [u, init] = fetchMock.mock.calls[0];
    expect(u).toBe('https://web.example/ingest-lrepeats');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer sek');
    expect(JSON.parse(init.body)).toEqual({ '12345678': { count: 3, last: '2026-05-10' } });
  });
  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(publishLRepeats('https://web.example', 'sek', {})).rejects.toThrow();
  });
});
