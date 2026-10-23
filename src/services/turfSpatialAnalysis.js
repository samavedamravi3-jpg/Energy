import * as turf from '@turf/turf';

/**
 * SunGrid Renewables - Turf.js Client-Side Spatial Engine
 *
 * Pure geometry and rule evaluation; no network calls. Written against
 * @turf/turf 7.x, where difference / intersect / union take a single
 * FeatureCollection and return null for an empty result.
 *
 * Every check has a data `state` and, once data exists, a `finding`:
 *   state:   pending | complete | incomplete | failed | not_assessed
 *            (incomplete = partial or truncated data; failed = no usable data)
 *   finding: favorable | caution | unfavorable | null
 * Only `complete` checks may feed a final score.
 */

export const SQ_M_PER_ACRE = 4046.8564224;
export const FEET_PER_METER = 3.28084;
export const HIGH_VOLTAGE_KV = 115;
// Rough utility-scale PV land use; an assumption, not a design figure.
export const ACRES_PER_MW = 7.5;

// Client-supplied (meeting notes): >5% slope is "super challenging";
// ~3 mi to a high-voltage substation is a good indicator (a preference, not a rule).
export const SLOPE_LIMIT_PERCENT = 5;
export const SUBSTATION_PREFERENCE_MILES = 3;
// Provisional (not supplied by the client):
export const SUBSTATION_SEARCH_MILES = 8;
export const SLOPE_SAMPLE_TARGET = 48;
const SLOPE_MIN_SPACING_M = 30;
const SLOPE_MIN_ESTIMATES = 8;
const SLOPE_COMPLETE_SHARE = 0.8;
export const STEEP_SHARE_UNFAVORABLE = 0.4;
const STEEP_SHARE_MINOR = 0.15;
const ACREAGE_MISMATCH_RATIO = 0.1;
export const NEAR_TOTAL_EXCLUSION = 0.05;

const toAcres = (sqMeters) => sqMeters / SQ_M_PER_ACRE;

export const pendingCheck = (label) => ({ state: 'pending', finding: null, label, summary: 'Checking…', sources: [] });
export const failedCheck = (label, message, sources = []) => ({
  state: 'failed',
  finding: null,
  label,
  summary: 'Unknown: data unavailable',
  detail: message,
  sources,
});

// ---------------------------------------------------------------- parcels

function boundaryKey(geometry) {
  return turf.bbox(geometry).map((v) => v.toFixed(5)).join(',') + ':' + Math.round(turf.area(geometry));
}

// NC OneMap GeoJSON -> parcel records. Records stacked on one identical
// boundary (condo / leasehold interests) are merged into one parcel.
export function normalizeParcels(features) {
  const byBoundary = new Map();
  for (const feature of features ?? []) {
    if (!feature.geometry) continue;
    const p = feature.properties || {};
    let key;
    try {
      key = boundaryKey(feature.geometry);
    } catch {
      continue; // unusable geometry
    }
    const existing = byBoundary.get(key);
    if (existing) {
      existing.sharedBoundaryParcels.push(p.parno || `objectid ${p.objectid}`);
      continue;
    }
    const recordedAcres = Number.isFinite(p.gisacres) ? p.gisacres : null;
    const polygonAcres = toAcres(turf.area(feature.geometry));
    byBoundary.set(key, {
      id: `${p.objectid ?? key}`,
      parcelNumber: p.parno || null,
      owner: p.ownname || null,
      county: p.cntyname || null,
      recordedAcres,
      polygonAcres,
      // County-supplied gisacres sometimes disagrees badly with the polygon
      // (e.g. 8,350 recorded vs 8.5 drawn). All area math uses the polygon.
      acreageMismatch:
        recordedAcres != null && polygonAcres > 0 && Math.abs(recordedAcres - polygonAcres) / polygonAcres > ACREAGE_MISMATCH_RATIO,
      landValue: Number.isFinite(p.landval) && p.landval > 0 ? p.landval : null,
      siteAddress: p.siteadd || null,
      landUse: p.parusedesc || null,
      sharedBoundaryParcels: [],
      geometry: feature.geometry,
    });
  }
  return [...byBoundary.values()];
}

// Parcel bbox grown by `miles` on every side, as [minLon, minLat, maxLon, maxLat].
export function expandedBbox(geometry, miles) {
  const box = turf.bbox(geometry);
  if (!miles) return box;
  return turf.bbox(turf.buffer(turf.bboxPolygon(box), miles, { units: 'miles' }));
}

export const parcelBbox = (geometry) => turf.bbox(geometry);

// ---------------------------------------------------------------- grid proximity

function distanceMiles(pointFeature, geometry) {
  // Negative inside the polygon in Turf 7; a substation on the parcel is 0 mi away.
  return Math.max(0, turf.pointToPolygonDistance(pointFeature, turf.feature(geometry), { units: 'miles' }));
}

function substationSummary(s, miles) {
  const p = s.properties;
  return {
    osmId: p.osmId,
    name: p.name,
    recordedKv: p.maxKv,
    voltageTag: p.voltageTag ?? null,
    substationType: p.substationType,
    operator: p.operator,
    miles,
    coordinates: s.geometry.coordinates,
  };
}

const describeKv = (s) => (s.recordedKv != null ? `${s.recordedKv} kV recorded` : 'voltage not recorded');

// Straight-line distance from the parcel boundary to OSM substations.
// `input` = { features, meta, covers? } or { error, sources }.
export function assessGrid(parcel, input, { preferenceMiles = SUBSTATION_PREFERENCE_MILES, searchMiles = SUBSTATION_SEARCH_MILES } = {}) {
  const label = 'Grid proximity';
  if (input.error) return failedCheck(label, input.error, input.sources ?? []);

  const ranked = input.features
    .map((s) => ({ s, miles: distanceMiles(s, parcel.geometry) }))
    .filter((r) => r.miles <= searchMiles)
    .sort((a, b) => a.miles - b.miles);
  const nearest = ranked[0] ? substationSummary(ranked[0].s, ranked[0].miles) : null;
  const hv = ranked.find((r) => r.s.properties.maxKv != null && r.s.properties.maxKv >= HIGH_VOLTAGE_KV);
  const nearestHv = hv ? substationSummary(hv.s, hv.miles) : null;
  const metrics = { nearest, nearestHv, preferenceMiles, searchMiles };
  const limitations = [
    'Straight-line distance from the parcel boundary; not a connection route.',
    'Voltage is the OpenStreetMap "voltage" tag as recorded by volunteers. It is not hosting or interconnection capacity.',
    'OpenStreetMap may be missing substations.',
  ];
  const base = { state: 'complete', label, metrics, limitations, sources: input.sources ?? [] };

  if (nearestHv && nearestHv.miles <= preferenceMiles) {
    return {
      ...base,
      finding: 'favorable',
      summary: `${nearestHv.miles.toFixed(1)} mi to a substation with ${nearestHv.recordedKv} kV recorded`,
      detail: `Within the ~${preferenceMiles} mi preference.`,
    };
  }
  if (nearestHv) {
    return {
      ...base,
      finding: 'caution',
      summary: `${nearestHv.miles.toFixed(1)} mi to a substation with ${nearestHv.recordedKv} kV recorded`,
      detail: `Beyond the ~${preferenceMiles} mi preference; a longer connection line may still work for a large site.` +
        (nearest && nearest !== nearestHv ? ` Closer substation: ${nearest.miles.toFixed(1)} mi (${describeKv(nearest)}).` : ''),
    };
  }
  if (nearest) {
    return {
      ...base,
      finding: 'caution',
      summary: `${nearest.miles.toFixed(1)} mi to a substation (${describeKv(nearest)})`,
      detail: `No substation with >= ${HIGH_VOLTAGE_KV} kV recorded within ${searchMiles} mi.`,
    };
  }
  return {
    ...base,
    finding: 'unfavorable',
    summary: `No mapped substation within ${searchMiles} mi`,
    detail: `No OSM power=substation within ${searchMiles} mi of the parcel boundary.`,
  };
}

// ---------------------------------------------------------------- polygon overlays

// Clip constraint polygons (flood, protected, wetlands) to the parcel.
// `input` = { features, truncated, meta } or { error }.
export function assessOverlay(parcel, input, { key, label, layerLabel, describe, thresholds, limitations = [] }) {
  if (input.error) return failedCheck(label, input.error, input.sources ?? []);
  const sources = input.sources ?? [];

  const pieces = [];
  const hits = new Map();
  let overlapSqM = 0;
  try {
    for (const zone of input.features) {
      const piece = turf.intersect(turf.featureCollection([turf.feature(parcel.geometry), zone]));
      if (!piece) continue;
      const name = describe(zone.properties || {});
      piece.properties = { name };
      pieces.push(piece);
      hits.set(name, (hits.get(name) || 0) + turf.area(piece));
    }
    if (pieces.length) overlapSqM = turf.area(pieces.length === 1 ? pieces[0] : turf.union(turf.featureCollection(pieces)));
  } catch (err) {
    return { ...failedCheck(label, `Geometry operation failed: ${err.message}`, sources), summary: 'Unknown: overlap could not be computed' };
  }

  const parcelSqM = parcel.polygonAcres * SQ_M_PER_ACRE;
  const overlapPct = parcelSqM > 0 ? Math.min(100, (overlapSqM / parcelSqM) * 100) : 0;
  const overlapAcres = toAcres(overlapSqM);
  // Largest contributors first. Records can stack (e.g. PAD-US fee + designation
  // on the same land), so these can sum past the parcel; overlapPct uses the union.
  const breakdown = [...hits.entries()]
    .filter(([, sqm]) => toAcres(sqm) >= 0.1)
    .sort((a, b) => b[1] - a[1])
    .map(([name, sqm]) => ({ name, acres: toAcres(sqm) }));
  const metrics = { overlapAcres, overlapPct, breakdown };
  const finding = overlapPct === 0 ? 'favorable' : overlapPct >= thresholds.unfavorablePct ? 'unfavorable' : 'caution';

  if (input.truncated) {
    // The service had more polygons than were returned: overlap is a lower bound,
    // and zero overlap proves nothing.
    return {
      state: 'incomplete',
      finding: overlapSqM > 0 ? finding : null,
      label,
      key,
      summary: overlapSqM > 0 ? `At least ${overlapPct.toFixed(1)}% in ${layerLabel} (results truncated)` : 'Unknown: results truncated',
      detail: 'The service returned only part of the polygons in this area.',
      metrics,
      pieces,
      limitations,
      sources,
    };
  }
  return {
    state: 'complete',
    finding,
    label,
    key,
    summary: overlapSqM === 0 ? `0% in ${layerLabel}` : `${overlapPct.toFixed(1)}% in ${layerLabel} (${overlapAcres.toFixed(1)} ac)`,
    detail: overlapSqM === 0 ? `No ${layerLabel} polygon intersects the parcel.` : null,
    metrics,
    pieces,
    limitations,
    sources,
  };
}

// ---------------------------------------------------------------- buildable area

// Parcel area left after removing mapped wetlands, flood hazard and protected land.
// Only complete overlays count; otherwise the result is unknown (acres: null).
export function computeBuildableArea(parcel, overlays) {
  const label = 'Buildable area';
  const missing = overlays.filter((o) => o.state !== 'complete');
  if (missing.some((o) => o.state === 'pending')) return { ...pendingCheck(label), acres: null };
  if (missing.length) {
    // Derived value: it did not fail itself, it lacks complete inputs.
    return {
      state: 'incomplete',
      finding: null,
      label,
      acres: null,
      summary: 'Unknown until every exclusion layer is complete',
      detail: `Missing complete data from: ${missing.map((o) => `${o.label} (${o.state})`).join(', ')}.`,
      sources: [],
    };
  }

  const pieces = overlays.flatMap((o) => o.pieces);
  let acres = parcel.polygonAcres;
  if (pieces.length) {
    try {
      const exclusion = pieces.length === 1 ? pieces[0] : turf.union(turf.featureCollection(pieces));
      const remaining = turf.difference(turf.featureCollection([turf.feature(parcel.geometry), exclusion]));
      // null = the exclusions cover the whole parcel: nothing is left.
      acres = remaining ? toAcres(turf.area(remaining)) : 0;
      if (acres < 0.05) acres = 0;
    } catch (err) {
      return { ...failedCheck(label, `Geometry operation failed: ${err.message}`), acres: null };
    }
  }
  const share = parcel.polygonAcres > 0 ? acres / parcel.polygonAcres : 0;
  return {
    state: 'complete',
    finding: share < NEAR_TOTAL_EXCLUSION ? 'unfavorable' : share < 0.75 ? 'caution' : 'favorable',
    label,
    acres,
    share,
    summary: `${acres.toLocaleString(undefined, { maximumFractionDigits: 1 })} ac after exclusions (${(share * 100).toFixed(0)}% of parcel)`,
    detail: 'Parcel polygon minus mapped wetlands, FEMA flood hazard areas and PAD-US protected land. Slope is reported separately, not subtracted.',
    sources: [],
  };
}

// ---------------------------------------------------------------- slope

// Regular grid of sample points inside the parcel, spaced in metres.
// Returns { points: [{ lon, lat, row, col }], spacingM }.
export function buildSlopeSampleGrid(geometry, target = SLOPE_SAMPLE_TARGET) {
  // Start from area / target and rescale until the in-parcel count is near target
  // (irregular parcels fill less of their bbox than the first guess assumes).
  let spacingM = Math.max(SLOPE_MIN_SPACING_M, Math.sqrt(turf.area(geometry) / target));
  let points = latticeInside(geometry, spacingM);
  for (let attempt = 0; attempt < 5; attempt++) {
    const ratio = points.length / target;
    if (ratio >= 0.7 && ratio <= 1.3) break;
    const next = Math.max(SLOPE_MIN_SPACING_M, spacingM * Math.sqrt(Math.max(ratio, 0.05)));
    if (next === spacingM) break; // already at minimum spacing
    spacingM = next;
    points = latticeInside(geometry, spacingM);
  }
  return { points, spacingM };
}

function latticeInside(geometry, spacingM) {
  const feature = turf.feature(geometry);
  const [w, s, e, n] = turf.bbox(geometry);
  const dLat = spacingM / 111320;
  const dLon = spacingM / (111320 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  const rows = Math.floor((n - s) / dLat) + 1;
  const cols = Math.floor((e - w) / dLon) + 1;
  // Centre the lattice in the bbox so small parcels are not missed at the edge.
  const lat0 = s + (n - s - (rows - 1) * dLat) / 2;
  const lon0 = w + (e - w - (cols - 1) * dLon) / 2;
  const points = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lon = lon0 + col * dLon;
      const lat = lat0 + row * dLat;
      if (turf.booleanPointInPolygon([lon, lat], feature)) points.push({ lon, lat, row, col });
    }
  }
  return points;
}

// Slope (%) at each grid point from finite differences with its grid
// neighbours. Elevations are feet; spacing is converted to feet, so
// rise / run * 100 is a true percent grade.
export function estimateSlopes(grid, elevationsFt) {
  const spacingFt = grid.spacingM * FEET_PER_METER;
  const z = new Map();
  grid.points.forEach((p, i) => {
    if (Number.isFinite(elevationsFt[i])) z.set(`${p.row},${p.col}`, elevationsFt[i]);
  });
  const at = (r, c) => z.get(`${r},${c}`);
  const gradient = (here, plus, minus) => {
    if (plus != null && minus != null) return (plus - minus) / (2 * spacingFt);
    if (plus != null) return (plus - here) / spacingFt;
    if (minus != null) return (here - minus) / spacingFt;
    return null;
  };

  return grid.points.map((p) => {
    const here = at(p.row, p.col);
    if (here == null) return { ...p, elevationFt: null, slopePct: null };
    const dzdx = gradient(here, at(p.row, p.col + 1), at(p.row, p.col - 1));
    const dzdy = gradient(here, at(p.row + 1, p.col), at(p.row - 1, p.col));
    if (dzdx == null || dzdy == null) return { ...p, elevationFt: here, slopePct: null };
    return { ...p, elevationFt: here, slopePct: 100 * Math.hypot(dzdx, dzdy) };
  });
}

// `samples` from estimateSlopes; `failures` = EPQS points with no value.
export function assessSlope(parcel, grid, samples, { sources = [], failures = 0 } = {}) {
  const label = 'Terrain slope';
  const estimates = samples.filter((s) => s.slopePct != null).map((s) => s.slopePct);
  const planned = grid.points.length;
  const elevated = samples.filter((s) => s.elevationFt != null).length;
  const spacingFt = grid.spacingM * FEET_PER_METER;
  const limitations = [
    `Sampled on a ~${Math.round(spacingFt).toLocaleString()} ft grid; terrain features smaller than the spacing (ditches, short banks) are not resolved.`,
    'Slope is a finite-difference estimate between neighbouring USGS 3DEP point elevations, not a survey or DEM analysis.',
    'Location of steep ground (edge vs. middle of the parcel) is shown on the map but not scored.',
  ];
  const coverage = {
    plannedPoints: planned,
    elevationsReceived: elevated,
    failedPoints: failures,
    slopeEstimates: estimates.length,
    spacingFt,
    acresPerEstimate: estimates.length ? parcel.polygonAcres / estimates.length : null,
  };
  if (planned === 0) return { ...failedCheck(label, 'Parcel too small or irregular to place sample points.', sources), metrics: { coverage } };
  if (estimates.length === 0) return { ...failedCheck(label, `No slope estimates: ${failures} of ${planned} elevation requests failed.`, sources), metrics: { coverage }, samples };

  const sorted = [...estimates].sort((a, b) => a - b);
  const steep = estimates.filter((v) => v > SLOPE_LIMIT_PERCENT).length;
  const steepShare = steep / estimates.length;
  const metrics = {
    coverage,
    steepShare,
    medianPct: sorted[Math.floor(sorted.length / 2)],
    p90Pct: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))],
    maxPct: sorted[sorted.length - 1],
  };
  // Some steep ground is a flag, not a rejection (client: "if the slope is only a
  // little bit of the parcel" it can work). Provisional: >= 40% steep is unfavorable.
  const finding = steep === 0 ? 'favorable' : steepShare < STEEP_SHARE_UNFAVORABLE ? 'caution' : 'unfavorable';
  const enough = estimates.length >= SLOPE_MIN_ESTIMATES && elevated >= planned * SLOPE_COMPLETE_SHARE;
  const summary =
    steep === 0
      ? `All ${estimates.length} sampled locations ≤ ${SLOPE_LIMIT_PERCENT}% (median ${metrics.medianPct.toFixed(1)}%)`
      : `${(steepShare * 100).toFixed(0)}% of sampled locations > ${SLOPE_LIMIT_PERCENT}% (median ${metrics.medianPct.toFixed(1)}%, max ${metrics.maxPct.toFixed(1)}%)`;
  return {
    state: enough ? 'complete' : 'incomplete',
    finding,
    label,
    summary: enough ? summary : `${summary}; coverage too low to rely on`,
    detail:
      steep === 0
        ? null
        : steepShare < STEEP_SHARE_MINOR
          ? 'Steep ground is a small share of the samples; review where it sits before ruling the parcel out.'
          : 'A large share of sampled ground is above 5%, which the client describes as very challenging to build on.',
    metrics,
    samples,
    limitations,
    sources,
  };
}
