import { describe, test, expect } from 'vitest';
import { scoreAssessment, COMPONENTS } from '../src/services/scoring';
import { makeParcel, favorableChecks } from './fixtures';

const parcel = makeParcel();

describe('scoreAssessment', () => {
  test('weights sum to 100', () => {
    expect(COMPONENTS.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });

  test('all complete and favorable -> complete 100 with a band, never approval wording', () => {
    const s = scoreAssessment(favorableChecks(parcel));
    expect(s.status).toBe('complete');
    expect(s.total).toBe(100);
    expect(s.completeness.weightShare).toBe(1);
    expect(s.label).not.toMatch(/approv|viable|build ready/i);
  });

  test.each(['slope', 'wetlands', 'grid', 'flood', 'protectedLand', 'buildable'])(
    'a failed %s check yields "Incomplete assessment" with no total',
    (key) => {
      const checks = favorableChecks(parcel);
      checks[key] = { state: 'failed', finding: null, summary: 'Unknown' };
      const s = scoreAssessment(checks);
      expect(s.status).toBe('incomplete');
      expect(s.label).toBe('Incomplete assessment');
      expect(s.total).toBeNull();
      expect(s.band).toBeNull();
      expect(s.completeness.weightShare).toBeLessThan(1);
      expect(s.completeness.unresolved.map((u) => u.key)).toContain(key);
    }
  );

  test('truncated (incomplete) data cannot be scored either', () => {
    const checks = favorableChecks(parcel);
    checks.wetlands = { state: 'incomplete', finding: null, metrics: { overlapPct: 0 } };
    const s = scoreAssessment(checks);
    expect(s.total).toBeNull();
    expect(s.components.find((c) => c.key === 'wetlands').points).toBeNull();
  });

  test('every check missing never produces a favorable total', () => {
    const s = scoreAssessment({});
    expect(s.total).toBeNull();
    expect(s.earnedOnAssessed).toBe(0);
    expect(s.status).toBe('pending');
  });

  test('pending checks report in progress, not incomplete', () => {
    const checks = favorableChecks(parcel);
    checks.slope = { state: 'pending' };
    expect(scoreAssessment(checks).status).toBe('pending');
  });

  test('component points are shown for assessed components even when incomplete', () => {
    const checks = favorableChecks(parcel);
    checks.grid = { state: 'failed' };
    const s = scoreAssessment(checks);
    expect(s.components.find((c) => c.key === 'slope').points).toBe(30);
    expect(s.assessedWeight).toBe(75);
    expect(s.earnedOnAssessed).toBe(75);
  });

  test('grid: within 3 mi full points, linear to zero at 8 mi, halved without recorded HV', () => {
    const at = (miles, hv = true) => {
      const checks = favorableChecks(parcel);
      checks.grid.metrics = { nearest: { miles, recordedKv: hv ? 230 : null }, nearestHv: hv ? { miles, recordedKv: 230 } : null };
      return scoreAssessment(checks).components.find((c) => c.key === 'grid').points;
    };
    expect(at(2.9)).toBe(25);
    expect(at(5.5)).toBeCloseTo(12.5);
    expect(at(9)).toBe(0);
    expect(at(1, false)).toBe(12.5);
  });

  test('a parcel below the 500 ac site target is scored proportionally, not rejected', () => {
    const checks = favorableChecks(parcel);
    checks.buildable = { state: 'complete', acres: 250, share: 1 };
    const s = scoreAssessment(checks);
    expect(s.components.find((c) => c.key === 'buildable').points).toBe(7.5);
    expect(s.fatalFlaw).toBeNull();
  });

  test('near-total exclusion is a fatal flaw regardless of total', () => {
    const checks = favorableChecks(parcel);
    checks.buildable = { state: 'complete', acres: 10, share: 0.01 };
    const s = scoreAssessment(checks);
    expect(s.fatalFlaw).toMatch(/Only 10.0 ac/);
    expect(s.label).toBe('Fatal flaw found');
    expect(s.band.tone).toBe('unfavorable');
  });
});
