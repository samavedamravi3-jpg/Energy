import { test, expect, vi, afterEach, beforeEach } from 'vitest';
import { fetchJson, clearSessionCache } from '../src/services/httpClient';

const store = new Map();
beforeEach(() => {
  clearSessionCache();
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('live, then session cache, with provenance', async () => {
  const fetch = vi.fn(async () => ok({ a: 1 }));
  vi.stubGlobal('fetch', fetch);
  const first = await fetchJson('Svc', 'https://x.test/q?a=1');
  expect(first.meta.cache).toBe('live');
  expect(first.meta.url).toBe('https://x.test/q?a=1');
  expect(Date.parse(first.meta.retrievedAt)).not.toBeNaN();
  const second = await fetchJson('Svc', 'https://x.test/q?a=1');
  expect(second.meta.cache).toBe('session');
  expect(second.meta.retrievedAt).toBe(first.meta.retrievedAt);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('aborting a run after its request succeeded keeps the session cache', async () => {
  const fetch = vi.fn(async () => ok({ a: 1 }));
  vi.stubGlobal('fetch', fetch);
  const run = new AbortController();
  await fetchJson('Svc', 'https://x.test/keep', { signal: run.signal });
  run.abort(); // e.g. the user selects the same parcel again
  const again = await fetchJson('Svc', 'https://x.test/keep');
  expect(again.meta.cache).toBe('session');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('aborting mid-flight evicts, so the next run does not join a cancelled request', async () => {
  vi.stubGlobal('fetch', vi.fn((_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))));
  const run = new AbortController();
  const first = fetchJson('Svc', 'https://x.test/inflight', { signal: run.signal });
  run.abort();
  await expect(first).rejects.toThrow(/cancelled/);
  vi.stubGlobal('fetch', vi.fn(async () => ok({ b: 2 })));
  const second = await fetchJson('Svc', 'https://x.test/inflight');
  expect(second.meta.cache).toBe('live');
});

test('live failure falls back to the stored copy, labeled with its original retrieval date', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ok({ a: 1 })));
  const first = await fetchJson('Svc', 'https://x.test/q');
  clearSessionCache();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) })));
  const fallback = await fetchJson('Svc', 'https://x.test/q');
  expect(fallback.meta.cache).toBe('stored');
  expect(fallback.meta.retrievedAt).toBe(first.meta.retrievedAt);
  expect(fallback.meta.liveError).toMatch(/HTTP 404/);
});

test('no stored copy -> the error propagates', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) })));
  await expect(fetchJson('Svc', 'https://x.test/none')).rejects.toThrow(/Svc returned HTTP 404/);
});

test('ArcGIS error bodies on HTTP 200 are failures', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ok({ error: { code: 400, message: 'Invalid query' } })));
  await expect(fetchJson('ArcGIS', 'https://x.test/bad')).rejects.toThrow(/ArcGIS error 400: Invalid query/);
});

test('timeouts produce a clear message', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))))
  );
  await expect(fetchJson('Slow', 'https://x.test/slow', { timeoutMs: 50 })).rejects.toThrow('Slow timed out after 0.05s');
});
