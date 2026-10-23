import { ENDPOINTS, fetchSubstations, fetchFEMAFloodZones, fetchProtectedAreas, fetchWetlands, fetchElevations } from './geoServices';
import { substationsFromSnapshot } from './substationSnapshot';
import {
  SUBSTATION_PREFERENCE_MILES,
  SUBSTATION_SEARCH_MILES,
  expandedBbox,
  parcelBbox,
  pendingCheck,
  failedCheck,
  assessGrid,
  assessOverlay,
  computeBuildableArea,
  buildSlopeSampleGrid,
  estimateSlopes,
  assessSlope,
} from './turfSpatialAnalysis';
import { scoreAssessment } from './scoring';

/**
 * Single-parcel assessment. All checks run concurrently; each one settles
 * to complete / incomplete / failed. A hard deadline marks anything still
 * running as failed, so the UI can never be left "Screening".
 */

export const ASSESSMENT_DEADLINE_MS = 55000;
// After Overpass fails, go straight to the labeled snapshot for a while instead
// of waiting on the same overloaded server for every parcel.
const OVERPASS_COOLDOWN_MS = 120000;
let lastOverpassFailure = null; // { at, message }
export const resetOverpassCooldown = () => {
  lastOverpassFailure = null;
};
export const CHECK_KEYS = ['slope', 'wetlands', 'grid', 'flood', 'protectedLand'];

const LABELS = {
  slope: 'Terrain slope',
  wetlands: 'Mapped wetlands (NWI)',
  grid: 'Grid proximity',
  flood: 'FEMA flood hazard',
  protectedLand: 'Protected land (PAD-US)',
};

const OVERLAYS = {
  wetlands: {
    fetch: fetchWetlands,
    layerLabel: 'mapped NWI wetlands/waters',
    describe: (p) => `${p.WETLAND_TYPE || 'Wetland'}${p.ATTRIBUTE ? ` (${p.ATTRIBUTE})` : ''}`,
    // Provisional: a majority of the parcel mapped as wetland is unfavorable.
    thresholds: { unfavorablePct: 50 },
    limitations: [
      'NWI mapping is a screening finding, not a jurisdictional wetland delineation or legal determination.',
      'NWI includes open water (lakes, ponds, rivers) as well as vegetated wetlands; unmapped wetlands may exist.',
    ],
  },
  flood: {
    fetch: fetchFEMAFloodZones,
    layerLabel: 'FEMA Special Flood Hazard Area',
    describe: (p) => `Zone ${p.FLD_ZONE}${p.ZONE_SUBTY ? ` (${p.ZONE_SUBTY.toLowerCase()})` : ''}`,
    thresholds: { unfavorablePct: 50 },
    limitations: ['Effective FEMA NFHL zones only; preliminary or locally adopted maps are not included.'],
  },
  protectedLand: {
    fetch: fetchProtectedAreas,
    layerLabel: 'PAD-US protected land',
    describe: (p) => `${p.Unit_Nm || 'Unnamed area'} (GAP ${p.GAP_Sts ?? '?'}, ${p.Category || 'unknown type'})`,
    thresholds: { unfavorablePct: 50 },
    limitations: ['All PAD-US GAP status codes 1-4 are treated as unavailable for development.', 'Polygons are generalized (~30 m) for speed.'],
  },
};

function summarizeElevationSources(results) {
  const metas = results.map((r) => r.meta).filter(Boolean);
  if (!metas.length) return [];
  const counts = metas.reduce((acc, m) => ({ ...acc, [m.cache]: (acc[m.cache] || 0) + 1 }), {});
  return [
    {
      service: 'USGS EPQS',
      url: `${ENDPOINTS.epqs} (${results.length} point queries, units=Feet, wkid=4326)`,
      retrievedAt: metas.map((m) => m.retrievedAt).sort().at(-1),
      durationMs: Math.max(...metas.map((m) => m.durationMs || 0)),
      cache: Object.keys(counts).length === 1 ? Object.keys(counts)[0] : 'mixed',
      cacheCounts: counts,
    },
  ];
}

export async function assessParcel(
  parcel,
  { signal, onUpdate = () => {}, preferenceMiles = SUBSTATION_PREFERENCE_MILES, deadlineMs = ASSESSMENT_DEADLINE_MS } = {}
) {
  const t0 = performance.now();
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const inner = controller.signal;

  const checks = Object.fromEntries(CHECK_KEYS.map((k) => [k, pendingCheck(LABELS[k])]));
  const timings = {};
  let finished = false;

  const snapshot = () => {
    const buildable = computeBuildableArea(parcel, [checks.wetlands, checks.flood, checks.protectedLand]);
    const all = { ...checks, buildable };
    return {
      version: 1,
      parcel,
      checks: all,
      score: scoreAssessment(all),
      preferenceMiles,
      startedAt,
      timings: { ...timings },
      elapsedMs: Math.round(performance.now() - t0),
    };
  };
  const set = (key, check) => {
    if (finished || checks[key].state !== 'pending') return;
    timings[key] = Math.round(performance.now() - t0);
    checks[key] = { ...check, label: LABELS[key] };
    onUpdate(snapshot());
  };
  // Any unexpected exception becomes a failed check, never a stuck one.
  const guard = (key, task) => task().catch((err) => set(key, failedCheck(LABELS[key], `Unexpected error: ${err.message}`)));

  const runGrid = async () => {
    const box = expandedBbox(parcel.geometry, SUBSTATION_SEARCH_MILES + 1);
    let input;
    try {
      const recent = lastOverpassFailure && Date.now() - lastOverpassFailure.at < OVERPASS_COOLDOWN_MS;
      if (recent) {
        const ago = Math.round((Date.now() - lastOverpassFailure.at) / 1000);
        throw new Error(`Live Overpass not retried: it failed ${ago} s ago (${lastOverpassFailure.message})`);
      }
      const live = await fetchSubstations([box], { signal: inner });
      lastOverpassFailure = null;
      input = { features: live.features, sources: [live.meta] };
    } catch (liveErr) {
      if (inner.aborted) throw liveErr;
      if (!/not retried/.test(liveErr.message)) lastOverpassFailure = { at: Date.now(), message: liveErr.message };
      const cached = await substationsFromSnapshot([box]);
      input = cached.covers(box)
        ? { features: cached.features, sources: [{ ...cached.meta, liveError: liveErr.message }] }
        : { error: `${liveErr.message}. The bundled substation snapshot does not cover this parcel's search area.` };
    }
    set('grid', assessGrid(parcel, input, { preferenceMiles }));
  };

  const runOverlay = (key) => async () => {
    const def = OVERLAYS[key];
    let input;
    try {
      const r = await def.fetch(parcelBbox(parcel.geometry), { signal: inner });
      input = { features: r.features, truncated: r.truncated, sources: [r.meta] };
    } catch (err) {
      input = { error: err.message };
    }
    set(key, assessOverlay(parcel, input, { key, label: LABELS[key], ...def }));
  };

  const runSlope = async () => {
    const grid = buildSlopeSampleGrid(parcel.geometry);
    const results = await fetchElevations(
      grid.points.map((p) => [p.lon, p.lat]),
      { signal: inner }
    );
    const samples = estimateSlopes(grid, results.map((r) => r.feet ?? null));
    set('slope', assessSlope(parcel, grid, samples, { sources: summarizeElevationSources(results), failures: results.filter((r) => r.error).length }));
  };

  onUpdate(snapshot());
  let deadlineTimer;
  const deadline = new Promise((resolve) => {
    deadlineTimer = setTimeout(() => {
      for (const key of CHECK_KEYS) {
        if (checks[key].state === 'pending') {
          set(key, failedCheck(LABELS[key], `Did not finish within ${deadlineMs / 1000} s; the service is slow or unavailable.`));
        }
      }
      controller.abort();
      resolve();
    }, deadlineMs);
  });

  await Promise.race([
    Promise.allSettled([
      guard('grid', runGrid),
      guard('wetlands', runOverlay('wetlands')),
      guard('flood', runOverlay('flood')),
      guard('protectedLand', runOverlay('protectedLand')),
      guard('slope', runSlope),
    ]),
    deadline,
  ]);
  clearTimeout(deadlineTimer);
  // A cancelled run (new parcel selected) leaves its checks to be discarded by the caller.
  const result = { ...snapshot(), finishedAt: new Date().toISOString(), totalMs: Math.round(performance.now() - t0), cancelled: Boolean(signal?.aborted) };
  finished = true;
  return result;
}
