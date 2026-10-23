import { test, expect } from 'vitest';
import { computeCostScenario, emptyCostInputs, parseAmount } from '../src/services/costScenario';

test('blank inputs are missing, not zero', () => {
  expect(parseAmount('')).toBeNull();
  expect(parseAmount(undefined)).toBeNull();
  expect(parseAmount('abc')).toBeNull();
  expect(parseAmount('0')).toBe(0);
  expect(parseAmount('$1,250')).toBe(1250);
  const r = computeCostScenario(emptyCostInputs());
  expect(r.upfrontSubtotal).toBeNull();
  expect(r.upfrontPartial).toBe(0);
  expect(r.upfrontMissing).toEqual(['Land purchase', 'Construction', 'Connection line']);
  expect(r.upfront.every((l) => l.amount === null)).toBe(true);
});

test('complete purchase scenario computes each line and the subtotal', () => {
  const r = computeCostScenario({
    landMode: 'purchase',
    landAcres: '600',
    landPricePerAcre: '10000',
    capacityMw: '80',
    constructionPerMw: '1000000',
    lineMiles: '2.5',
    linePerMile: '1500000',
  });
  expect(r.upfront.map((l) => l.amount)).toEqual([6_000_000, 80_000_000, 3_750_000]);
  expect(r.upfrontSubtotal).toBe(89_750_000);
  expect(r.annual).toBeNull();
});

test('one missing rate keeps the subtotal partial and names the line', () => {
  const r = computeCostScenario({ ...emptyCostInputs(), landAcres: 600, landPricePerAcre: 10000, capacityMw: 80, constructionPerMw: 1e6, lineMiles: 2 });
  expect(r.upfrontSubtotal).toBeNull();
  expect(r.upfrontPartial).toBe(86_000_000);
  expect(r.upfrontMissing).toEqual(['Connection line']);
  expect(r.upfront.find((l) => l.key === 'connection').formula).toMatch(/\[cost per mile\]/);
});

test('lease is annual and kept out of upfront costs', () => {
  const r = computeCostScenario({ ...emptyCostInputs(), landMode: 'lease', landAcres: 600, leasePerAcreYear: 900, capacityMw: 80, constructionPerMw: 1e6, lineMiles: 1, linePerMile: 1e6 });
  expect(r.upfront.map((l) => l.key)).toEqual(['construction', 'connection']);
  expect(r.upfrontSubtotal).toBe(81_000_000);
  expect(r.annual.amount).toBe(540_000);
});
