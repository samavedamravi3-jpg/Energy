import * as turf from '@turf/turf';

/**
 * Cached OpenStreetMap power=substation snapshot, used only when the live
 * Overpass request fails (overpass-api.de is frequently at capacity).
 * Regenerate with: node scripts/fetch-substation-snapshot.mjs
 */

// Lazy-loaded so the JSON is only downloaded when the fallback is needed.
const loadSnapshot = () => import('../data/substations-snapshot.json').then((m) => m.default);

const contains = ([w, s, e, n], [bw, bs, be, bn]) => bw >= w && bs >= s && be <= e && bn <= n;

// Substations inside the requested bboxes. `covers(bbox)` tells the caller
// whether a search box lies fully inside the snapshot; outside it, "no
// substation found" would be false, so that check must be treated as unknown.
export async function substationsFromSnapshot(bboxes) {
  const snapshot = await loadSnapshot();
  const covers = (b) => snapshot.extents.some((ext) => contains(ext, b));
  const boxes = bboxes.filter(covers).map((b) => turf.bboxPolygon(b));
  const features = snapshot.features.filter((f) => boxes.some((box) => turf.booleanPointInPolygon(f, box)));
  return {
    features,
    covers,
    meta: {
      service: 'OSM substation snapshot (bundled)',
      url: 'src/data/substations-snapshot.json',
      retrievedAt: snapshot.osmTimestamp,
      osmTimestamp: snapshot.osmTimestamp,
      durationMs: 0,
      cache: 'snapshot',
    },
  };
}
