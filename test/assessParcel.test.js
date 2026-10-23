import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import { assessParcel, CHECK_KEYS, resetOverpassCooldown } from '../src/services/assessParcel';
import { clearSessionCache } from '../src/services/httpClient';
import { makeParcel } from './fixtures';

// Routes fetch() by service; each handler returns a Response-like or throws.
function mockServices(handlers) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const u = String(url);
      // Dev-mode URLs for proxied services are local (/api/overpass, /api/nwi).
      const name = u.includes('overpass') ? 'overpass' : u.includes('NFHL') ? 'fema' : u.includes('PADUS') ? 'padus' : /wetlands|\/api\/nwi/.test(u) ? 'nwi' : u.includes('epqs') ? 'epqs' : null;
      if (!name) throw new Error(`unmocked request: ${u}`);
      return handlers[name](u, init);
    })
  );
}
const json = (body) => ({ ok: true, status: 200, json: async () => body });
const http = (status) => ({ ok: false, status, statusText: 'Error', json: async () => ({}) });
const hang = (_u, init) =>
  new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));

// A parcel well outside the bundled substation snapshot, so fallback cannot mask failures.
const parcel = makeParcel([-120.0, 40.0, -119.99, 40.01]);

beforeEach(() => {
  clearSessionCache();
  resetOverpassCooldown();
});
afterEach(() => vi.unstubAllGlobals());

describe('assessParcel', () => {
  test('every service failing -> every check failed, incomplete assessment, no score', async () => {
    mockServices({ overpass: () => http(400), fema: () => http(404), padus: () => http(404), nwi: () => http(404), epqs: () => http(404) });
    const r = await assessParcel(parcel, { deadlineMs: 10000 });
    for (const k of CHECK_KEYS) expect(r.checks[k].state).toBe('failed');
    expect(r.score.status).toBe('incomplete');
    expect(r.score.total).toBeNull();
    expect(r.checks.buildable.acres).toBeNull();
  });

  test('a hanging service is cut off by the deadline; nothing stays pending', async () => {
    const empty = json({ type: 'FeatureCollection', features: [] });
    mockServices({ overpass: hang, fema: () => empty, padus: () => empty, nwi: () => empty, epqs: () => json({ value: 300 }) });
    const updates = [];
    const t0 = Date.now();
    const r = await assessParcel(parcel, { deadlineMs: 400, onUpdate: (u) => updates.push(u) });
    expect(Date.now() - t0).toBeLessThan(3000);
    for (const k of CHECK_KEYS) expect(r.checks[k].state).not.toBe('pending');
    expect(r.checks.grid.state).toBe('failed');
    expect(r.checks.grid.detail).toMatch(/Did not finish within 0.4 s/);
    expect(r.checks.flood.state).toBe('complete');
    expect(r.checks.slope.state).toBe('complete');
    expect(r.score.status).toBe('incomplete');
    expect(updates.length).toBeGreaterThan(1);
  });

  test('all services answering -> complete score with source provenance on each check', async () => {
    const empty = json({ type: 'FeatureCollection', features: [] });
    mockServices({
      overpass: () => json({ elements: [{ type: 'node', id: 7, lat: 40.005, lon: -119.98, tags: { power: 'substation', voltage: '230000' } }], osm3s: { timestamp_osm_base: '2026-10-23T00:00:00Z' } }),
      fema: () => empty,
      padus: () => empty,
      nwi: () => empty,
      epqs: () => json({ value: 300 }),
    });
    const r = await assessParcel(parcel, { deadlineMs: 10000 });
    expect(r.score.status).toBe('complete');
    expect(r.checks.grid.metrics.nearestHv.recordedKv).toBe(230);
    // Proxied services still cite the upstream service, not the local proxy path.
    expect(r.checks.wetlands.sources[0].url).toMatch(/^https:\/\/fwspublicservices\.wim\.usgs\.gov\//);
    expect(r.checks.grid.sources[0].url).toMatch(/^https:\/\/overpass-api\.de\//);
    for (const k of CHECK_KEYS) {
      expect(r.checks[k].sources.length).toBeGreaterThan(0);
      expect(r.checks[k].sources[0].retrievedAt).toBeTruthy();
      expect(r.checks[k].sources[0].cache).toBe('live');
    }
  });

  test('after an Overpass failure the next run skips live and says so', async () => {
    const empty = json({ type: 'FeatureCollection', features: [] });
    const handlers = { overpass: vi.fn(() => http(502)), fema: () => empty, padus: () => empty, nwi: () => empty, epqs: () => json({ value: 300 }) };
    mockServices(handlers);
    await assessParcel(parcel, { deadlineMs: 10000 });
    const calls = handlers.overpass.mock.calls.length;
    const second = await assessParcel(parcel, { deadlineMs: 10000 });
    expect(handlers.overpass.mock.calls.length).toBe(calls);
    // Outside the snapshot, so the check fails and explains why live was skipped.
    expect(second.checks.grid.state).toBe('failed');
    expect(second.checks.grid.detail).toMatch(/not retried: it failed \d+ s ago/);
  });

  test('ArcGIS truncation keeps the check incomplete', async () => {
    const empty = json({ type: 'FeatureCollection', features: [] });
    mockServices({
      overpass: () => json({ elements: [] }),
      fema: () => json({ type: 'FeatureCollection', features: [], properties: { exceededTransferLimit: true } }),
      padus: () => empty,
      nwi: () => empty,
      epqs: () => json({ value: 300 }),
    });
    const r = await assessParcel(parcel, { deadlineMs: 10000 });
    expect(r.checks.flood.state).toBe('incomplete');
    expect(r.score.total).toBeNull();
  });
});
