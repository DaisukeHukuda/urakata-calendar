import { describe, it, expect, vi, afterEach } from 'vitest';
import { publishHistory } from '../src/web-publish.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('publishHistory', () => {
  it('POSTs to /ingest-history with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await publishHistory('https://web.example/', 'sek', [
      { date: '2023-06-10', course: 'SUP', pax: 2, amount: 12000, status: '参加済', phoneHash: 'abc' },
    ]);
    const [u, init] = fetchMock.mock.calls[0];
    expect(u).toBe('https://web.example/ingest-history');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer sek');
    expect(JSON.parse(init.body)[0].course).toBe('SUP');
  });
  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(publishHistory('https://web.example', 'sek', [])).rejects.toThrow();
  });
});
