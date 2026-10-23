/**
 * Limited cost scenario from user-entered assumptions.
 *
 * Missing inputs are null, never zero: a line with any missing input is
 * "incomplete" and is excluded from the subtotal, and the subtotal itself is
 * then reported as partial. Annual lease cost is kept separate from upfront
 * (one-time) costs. No rates are built in.
 */

export const COST_INPUTS = [
  { key: 'landMode', label: 'Land control', kind: 'choice', options: [['purchase', 'Purchase'], ['lease', 'Lease']] },
  { key: 'landAcres', label: 'Land area', unit: 'acres' },
  { key: 'landPricePerAcre', label: 'Land purchase price', unit: '$/acre', mode: 'purchase' },
  { key: 'leasePerAcreYear', label: 'Lease rate', unit: '$/acre/year', mode: 'lease' },
  { key: 'capacityMw', label: 'Project capacity', unit: 'MW (AC)' },
  { key: 'constructionPerMw', label: 'Construction cost', unit: '$/MW' },
  { key: 'lineMiles', label: 'Connection line length', unit: 'miles' },
  { key: 'linePerMile', label: 'Connection line cost', unit: '$/mile' },
];

export const emptyCostInputs = () => ({
  landMode: 'purchase',
  landAcres: null,
  landPricePerAcre: null,
  leasePerAcreYear: null,
  capacityMw: null,
  constructionPerMw: null,
  lineMiles: null,
  linePerMile: null,
});

// "" / undefined / NaN / negative -> null (missing). 0 is a real, entered value.
export function parseAmount(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[$,\s]/g, '');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function line(key, label, factors) {
  const missing = factors.filter((f) => f.value == null).map((f) => f.label);
  const formula = factors.map((f) => (f.value == null ? `[${f.label}]` : `${f.value.toLocaleString()} ${f.unit}`)).join(' × ');
  return {
    key,
    label,
    formula,
    missing,
    amount: missing.length ? null : factors.reduce((product, f) => product * f.value, 1),
  };
}

export function computeCostScenario(rawInputs) {
  const v = Object.fromEntries(Object.entries(rawInputs).map(([k, x]) => [k, k === 'landMode' ? x : parseAmount(x)]));
  const acres = { label: 'land area', unit: 'ac', value: v.landAcres };

  const upfront = [];
  if (v.landMode === 'purchase') {
    upfront.push(line('land', 'Land purchase', [acres, { label: 'price per acre', unit: '$/ac', value: v.landPricePerAcre }]));
  }
  upfront.push(
    line('construction', 'Construction', [
      { label: 'capacity', unit: 'MW', value: v.capacityMw },
      { label: 'cost per MW', unit: '$/MW', value: v.constructionPerMw },
    ])
  );
  upfront.push(
    line('connection', 'Connection line', [
      { label: 'line length', unit: 'mi', value: v.lineMiles },
      { label: 'cost per mile', unit: '$/mi', value: v.linePerMile },
    ])
  );

  const computed = upfront.filter((l) => l.amount != null);
  const incomplete = upfront.filter((l) => l.amount == null);
  const annual =
    v.landMode === 'lease'
      ? line('lease', 'Annual land lease', [acres, { label: 'lease rate', unit: '$/ac/yr', value: v.leasePerAcreYear }])
      : null;

  return {
    upfront,
    upfrontSubtotal: incomplete.length ? null : computed.reduce((s, l) => s + l.amount, 0),
    upfrontPartial: computed.reduce((s, l) => s + l.amount, 0),
    upfrontMissing: incomplete.map((l) => l.label),
    annual,
  };
}

export const COST_DISCLAIMER =
  'Limited scenario from your own assumptions, not a project quote. It omits interconnection upgrades, permitting, ' +
  'financing, equipment pricing changes and many other costs. Connection length is whatever you enter; a straight-line ' +
  'distance is not an actual line route.';
