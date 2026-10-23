import * as turf from '@turf/turf';

/**
 * Saved assessments in this browser's localStorage. A saved record is the
 * assessment exactly as computed (findings, score, sources with retrieval
 * dates) plus cost assumptions; reopening never re-queries the services.
 */

const KEY = 'sungrid.assessments.v1';
const HTTP_CACHE_PREFIX = 'sungrid.http.v1';

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readAll() {
  const ls = storage();
  if (!ls) return [];
  try {
    const list = JSON.parse(ls.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Saved assessments outrank the HTTP response cache when storage is full.
function freeHttpCache(ls) {
  for (let i = ls.length - 1; i >= 0; i--) {
    const k = ls.key(i);
    if (k?.startsWith(HTTP_CACHE_PREFIX)) ls.removeItem(k);
  }
}

function writeAll(list) {
  const ls = storage();
  if (!ls) throw new Error('Browser storage is unavailable (private window or blocked site data).');
  const text = JSON.stringify(list);
  try {
    ls.setItem(KEY, text);
  } catch {
    freeHttpCache(ls);
    try {
      ls.setItem(KEY, text);
    } catch {
      throw new Error('Browser storage is full. Export older assessments as JSON and delete them.');
    }
  }
}

const compactGeometry = (g) => turf.truncate(turf.simplify(turf.feature(g), { tolerance: 0.00002, highQuality: false }), { precision: 6 }).geometry;
const compactPieces = (pieces) =>
  (pieces || []).map((p) => ({ type: 'Feature', properties: p.properties, geometry: compactGeometry(p.geometry) }));

// Strip bulky intermediate data while keeping everything the UI and briefing show.
export function compactAssessment(assessment) {
  const checks = {};
  for (const [key, check] of Object.entries(assessment.checks)) {
    const c = { ...check };
    if (c.pieces) c.pieces = compactPieces(c.pieces);
    if (c.samples) c.samples = c.samples.map(({ lon, lat, elevationFt, slopePct }) => ({ lon, lat, elevationFt, slopePct }));
    checks[key] = c;
  }
  return { ...assessment, checks, parcel: { ...assessment.parcel, geometry: turf.truncate(turf.feature(assessment.parcel.geometry), { precision: 6 }).geometry } };
}

export function listSavedAssessments() {
  return readAll()
    .map(({ id, savedAt, title, parcel, score }) => ({
      id,
      savedAt,
      title,
      parcelNumber: parcel?.parcelNumber,
      county: parcel?.county,
      scoreStatus: score?.status,
      scoreTotal: score?.total ?? null,
    }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function loadSavedAssessment(id) {
  return readAll().find((r) => r.id === id) ?? null;
}

// Returns the saved record. Saving the same parcel again replaces the earlier record.
export function saveAssessment(assessment, costInputs, notes = '') {
  const record = {
    ...compactAssessment(assessment),
    id: `${assessment.parcel.id}-${assessment.startedAt}`,
    savedAt: new Date().toISOString(),
    title: `${assessment.parcel.parcelNumber || 'Parcel'} · ${assessment.parcel.county || ''}`.trim(),
    costInputs,
    notes,
  };
  const list = readAll().filter((r) => r.id !== record.id);
  list.push(record);
  writeAll(list);
  return record;
}

export function deleteSavedAssessment(id) {
  writeAll(readAll().filter((r) => r.id !== id));
}

export function downloadJson(record) {
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `parcel-assessment-${(record.parcel.parcelNumber || record.parcel.id).replace(/[^\w-]+/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
