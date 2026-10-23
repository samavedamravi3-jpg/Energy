import { describe, test, expect } from 'vitest';
import * as turf from '@turf/turf';
import {
  assessOverlay,
  assessGrid,
  computeBuildableArea,
  buildSlopeSampleGrid,
  estimateSlopes,
  assessSlope,
  normalizeParcels,
  FEET_PER_METER,
} from '../src/services/turfSpatialAnalysis';
import { makeParcel, zone, PARCEL_BOX } from './fixtures';

const parcel = makeParcel();
const overlayOpts = { key: 'flood', label: 'Flood', layerLabel: 'flood zone', describe: (p) => `Zone ${p.FLD_ZONE}`, thresholds: { unfavorablePct: 50 } };
const sub = (lon, lat, kv) => turf.point([lon, lat], { osmId: 'node/1', name: null, maxKv: kv, voltageTag: kv ? String(kv * 1000) : null });

describe('overlays and buildable area', () => {
  test('fully covered parcel leaves exactly zero buildable acres', () => {
    const flood = assessOverlay(parcel, { features: [zone([-78.71, 35.69, -78.65, 35.74], { FLD_ZONE: 'AE' })], truncated: false }, overlayOpts);
    const none = { ...flood, state: 'complete', pieces: [] };
    const b = computeBuildableArea(parcel, [flood, none, none]);
    expect(flood.state).toBe('complete');
    expect(flood.finding).toBe('unfavorable');
    expect(b.acres).toBe(0);
    expect(b.finding).toBe('unfavorable');
  });

  test('half covered parcel leaves half the area', () => {
    const flood = assessOverlay(parcel, { features: [zone([-78.68, 35.69, -78.65, 35.74], { FLD_ZONE: 'AE' })], truncated: false }, overlayOpts);
    const b = computeBuildableArea(parcel, [flood]);
    expect(b.acres / parcel.polygonAcres).toBeCloseTo(0.5, 1);
  });

  test('overlapping exclusion layers are not double-counted', () => {
    const a = assessOverlay(parcel, { features: [zone([-78.68, 35.69, -78.65, 35.74], { FLD_ZONE: 'AE' })], truncated: false }, overlayOpts);
    const b = assessOverlay(parcel, { features: [zone([-78.68, 35.69, -78.65, 35.74], { FLD_ZONE: 'X' })], truncated: false }, overlayOpts);
    expect(computeBuildableArea(parcel, [a, b]).acres / parcel.polygonAcres).toBeCloseTo(0.5, 1);
  });

  test('failed request -> failed check and unknown buildable area', () => {
    const failed = assessOverlay(parcel, { error: 'FEMA timed out after 30s' }, overlayOpts);
    expect(failed.state).toBe('failed');
    expect(failed.finding).toBeNull();
    const b = computeBuildableArea(parcel, [failed]);
    expect(b.acres).toBeNull();
    expect(b.state).toBe('incomplete');
    expect(b.detail).toMatch(/Flood \(failed\)/);
  });

  test('truncated results with no overlap are incomplete, not a pass', () => {
    const c = assessOverlay(parcel, { features: [], truncated: true }, overlayOpts);
    expect(c.state).toBe('incomplete');
    expect(c.finding).toBeNull();
    expect(computeBuildableArea(parcel, [c]).acres).toBeNull();
  });
});

describe('grid proximity', () => {
  test('failed substation request is failed, not "no substation"', () => {
    const g = assessGrid(parcel, { error: 'Overpass HTTP 502' });
    expect(g.state).toBe('failed');
    expect(g.finding).toBeNull();
  });

  test('a substation without a recorded voltage is never called high voltage', () => {
    const g = assessGrid(parcel, { features: [sub(-78.64, 35.71, null)] });
    expect(g.finding).toBe('caution');
    expect(g.summary).toMatch(/voltage not recorded/);
    expect(g.metrics.nearestHv).toBeNull();
  });

  test('recorded >= 115 kV within 3 mi is favorable and reports the recorded voltage', () => {
    const g = assessGrid(parcel, { features: [sub(-78.64, 35.71, 230)] });
    expect(g.finding).toBe('favorable');
    expect(g.summary).toMatch(/230 kV recorded/);
    expect(g.limitations.join(' ')).toMatch(/not a connection route/);
    expect(g.limitations.join(' ')).toMatch(/not hosting or interconnection capacity/);
  });

  test('beyond ~3 mi is a caution (preference), not a rejection', () => {
    const g = assessGrid(parcel, { features: [sub(-78.58, 35.71, 230)] });
    expect(g.metrics.nearestHv.miles).toBeGreaterThan(3);
    expect(g.finding).toBe('caution');
  });
});

describe('slope estimation', () => {
  const grid = buildSlopeSampleGrid(parcel.geometry);

  test('sample grid is spatially distributed with roughly the target count', () => {
    expect(grid.points.length).toBeGreaterThanOrEqual(30);
    expect(grid.points.length).toBeLessThanOrEqual(65);
    const rows = new Set(grid.points.map((p) => p.row)).size;
    const cols = new Set(grid.points.map((p) => p.col)).size;
    expect(rows).toBeGreaterThan(3);
    expect(cols).toBeGreaterThan(3);
  });

  test('small parcels still get samples at the 30 m minimum spacing', () => {
    const small = makeParcel([-78.7, 35.7, -78.698, 35.7015]); // ~ 180 m x 160 m
    const g = buildSlopeSampleGrid(small.geometry);
    expect(g.spacingM).toBeGreaterThanOrEqual(30);
    expect(g.points.length).toBeGreaterThan(8);
  });

  test('units: a plane rising 3 ft per 100 ft east reads 3% everywhere', () => {
    const spacingFt = grid.spacingM * FEET_PER_METER;
    const z = grid.points.map((p) => 300 + 0.03 * p.col * spacingFt);
    const samples = estimateSlopes(grid, z);
    const values = samples.filter((s) => s.slopePct != null).map((s) => s.slopePct);
    expect(values.length).toBeGreaterThan(20);
    for (const v of values) expect(v).toBeCloseTo(3, 6);
    const c = assessSlope(parcel, grid, samples);
    expect(c.state).toBe('complete');
    expect(c.finding).toBe('favorable');
  });

  test('a small steep strip is flagged (caution), not a whole-parcel rejection', () => {
    const spacingFt = grid.spacingM * FEET_PER_METER;
    const maxCol = Math.max(...grid.points.map((p) => p.col));
    // 12% grade only between the last two columns, flat elsewhere.
    const z = grid.points.map((p) => (p.col === maxCol ? 300 + 0.12 * spacingFt : 300));
    const c = assessSlope(parcel, grid, estimateSlopes(grid, z));
    expect(c.metrics.steepShare).toBeGreaterThan(0);
    expect(c.metrics.steepShare).toBeLessThan(0.4);
    expect(c.finding).toBe('caution');
  });

  test('missing elevations make the check incomplete or failed, never complete', () => {
    const half = grid.points.map((p, i) => (i % 2 ? null : 300));
    expect(assessSlope(parcel, grid, estimateSlopes(grid, half), { failures: grid.points.length / 2 }).state).not.toBe('complete');
    const none = grid.points.map(() => null);
    expect(assessSlope(parcel, grid, estimateSlopes(grid, none), { failures: grid.points.length }).state).toBe('failed');
  });
});

test('stacked records on one boundary merge; acreage mismatch is flagged', () => {
  const g = turf.bboxPolygon(PARCEL_BOX).geometry;
  const parcels = normalizeParcels([
    { type: 'Feature', properties: { objectid: 1, parno: 'A', gisacres: 8350 }, geometry: g },
    { type: 'Feature', properties: { objectid: 2, parno: 'B', gisacres: 8350 }, geometry: g },
  ]);
  expect(parcels).toHaveLength(1);
  expect(parcels[0].sharedBoundaryParcels).toEqual(['B']);
  expect(parcels[0].acreageMismatch).toBe(true);
});
