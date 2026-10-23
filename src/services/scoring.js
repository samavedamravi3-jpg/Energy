import { HIGH_VOLTAGE_KV, NEAR_TOTAL_EXCLUSION, SLOPE_LIMIT_PERCENT, SUBSTATION_PREFERENCE_MILES } from './turfSpatialAnalysis';

/**
 * Parcel screening score, 0-100.
 *
 * Method: six components, each scored 0..weight from one check. The total is
 * the sum, reported ONLY when every component's check is complete. Otherwise
 * the result is "Incomplete assessment" and only per-component points are
 * shown. Completeness (share of weight with complete data) is reported
 * separately from the score.
 *
 * Client-supplied inputs (meeting notes, brief): slope > 5% is very
 * challenging; ~3 mi to a high-voltage substation is a good indicator; the
 * 500-700 ac target is buildable area for a combined site; designated
 * wetlands and protected land cannot be built on.
 * Everything else here (weights, curves, bands) is PROVISIONAL and should be
 * calibrated with SunGrid.
 *
 * A score is a screening aid for prioritising parcels. It is not a
 * construction, permitting or interconnection approval.
 */

export const SITE_TARGET_ACRES = { min: 500, max: 700 }; // client: combined site, not a parcel minimum
const GRID_ZERO_MILES = 8; // provisional: grid points fall to 0 at 8 mi
const UNVERIFIED_VOLTAGE_FACTOR = 0.5; // provisional: nearest substation has no >= 115 kV recorded

export const COMPONENTS = [
  {
    key: 'slope',
    label: 'Terrain slope',
    weight: 30,
    provisional: true,
    rule: `weight × share of sampled locations ≤ ${SLOPE_LIMIT_PERCENT}% slope (5% threshold from client)`,
    points: (c) => 30 * (1 - c.metrics.steepShare),
  },
  {
    key: 'wetlands',
    label: 'Mapped wetlands (NWI)',
    weight: 20,
    provisional: true,
    rule: 'weight × (1 − share of parcel in mapped NWI wetlands/waters)',
    points: (c) => 20 * (1 - c.metrics.overlapPct / 100),
  },
  {
    key: 'grid',
    label: 'Grid proximity',
    weight: 25,
    provisional: true,
    rule:
      `full points ≤ ${SUBSTATION_PREFERENCE_MILES} mi (client preference) to a substation with ≥ ${HIGH_VOLTAGE_KV} kV recorded, ` +
      `linear to 0 at ${GRID_ZERO_MILES} mi; ×${UNVERIFIED_VOLTAGE_FACTOR} if only substations without recorded ≥ ${HIGH_VOLTAGE_KV} kV are nearby`,
    points: (c) => {
      const { nearest, nearestHv } = c.metrics;
      const distanceScore = (mi) => 25 * Math.max(0, Math.min(1, (GRID_ZERO_MILES - mi) / (GRID_ZERO_MILES - SUBSTATION_PREFERENCE_MILES)));
      if (nearestHv) return distanceScore(nearestHv.miles);
      if (nearest) return distanceScore(nearest.miles) * UNVERIFIED_VOLTAGE_FACTOR;
      return 0;
    },
  },
  {
    key: 'buildable',
    label: 'Buildable area toward site target',
    weight: 15,
    provisional: true,
    rule: `weight × min(1, buildable acres ÷ ${SITE_TARGET_ACRES.min} ac). Parcels below the target still count toward a combined site.`,
    points: (c) => 15 * Math.min(1, c.acres / SITE_TARGET_ACRES.min),
  },
  {
    key: 'flood',
    label: 'FEMA flood hazard',
    weight: 5,
    provisional: true,
    rule: 'weight × (1 − share of parcel in FEMA Special Flood Hazard Area)',
    points: (c) => 5 * (1 - c.metrics.overlapPct / 100),
  },
  {
    key: 'protectedLand',
    label: 'Protected land (PAD-US)',
    weight: 5,
    provisional: true,
    rule: 'weight × (1 − share of parcel in PAD-US protected areas)',
    points: (c) => 5 * (1 - c.metrics.overlapPct / 100),
  },
];

// Provisional bands. Never phrased as approval.
const BANDS = [
  { min: 75, label: 'Strong screening candidate', tone: 'favorable' },
  { min: 50, label: 'Mixed: review flagged components', tone: 'caution' },
  { min: 0, label: 'Weak screening candidate', tone: 'unfavorable' },
];

export const SCORE_DISCLAIMER =
  'Screening score for prioritising parcels only. Not a construction, permitting, wetland-jurisdiction or interconnection approval.';

// checks: { slope, wetlands, grid, flood, protectedLand, buildable }
export function scoreAssessment(checks) {
  const components = COMPONENTS.map((def) => {
    const check = checks[def.key];
    const state = check?.state ?? 'pending';
    const complete = state === 'complete';
    let points = null;
    if (complete) {
      const raw = def.points(check);
      points = Number.isFinite(raw) ? Math.max(0, Math.min(def.weight, raw)) : null;
    }
    return {
      key: def.key,
      label: def.label,
      weight: def.weight,
      provisional: def.provisional,
      rule: def.rule,
      state: complete && points == null ? 'failed' : state,
      points,
    };
  });

  const totalWeight = COMPONENTS.reduce((sum, c) => sum + c.weight, 0);
  const scored = components.filter((c) => c.points != null);
  const completeness = {
    weightShare: scored.reduce((sum, c) => sum + c.weight, 0) / totalWeight,
    completeCount: scored.length,
    totalCount: components.length,
    unresolved: components.filter((c) => c.points == null).map((c) => ({ key: c.key, label: c.label, state: c.state })),
  };
  const earnedOnAssessed = scored.reduce((sum, c) => sum + c.points, 0);
  const assessedWeight = scored.reduce((sum, c) => sum + c.weight, 0);
  const pending = components.some((c) => c.state === 'pending');

  // Fatal flaw from complete data outranks missing data.
  const buildable = checks.buildable;
  const fatalFlaw =
    buildable?.state === 'complete' && buildable.share < NEAR_TOTAL_EXCLUSION
      ? `Only ${buildable.acres.toFixed(1)} ac (${(buildable.share * 100).toFixed(1)}%) remains after wetlands, flood and protected-land exclusions.`
      : null;

  if (scored.length < components.length) {
    return {
      status: pending ? 'pending' : 'incomplete',
      label: pending ? 'Assessment in progress' : 'Incomplete assessment',
      total: null,
      earnedOnAssessed,
      assessedWeight,
      totalWeight,
      components,
      completeness,
      fatalFlaw,
      band: null,
    };
  }

  const total = Math.round(earnedOnAssessed);
  const band = BANDS.find((b) => total >= b.min);
  return {
    status: 'complete',
    label: fatalFlaw ? 'Fatal flaw found' : band.label,
    total,
    earnedOnAssessed,
    assessedWeight,
    totalWeight,
    components,
    completeness,
    fatalFlaw,
    band: fatalFlaw ? { ...band, tone: 'unfavorable' } : band,
  };
}
