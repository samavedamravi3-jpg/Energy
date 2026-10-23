// Shared display vocabulary for check states, findings and cache provenance.

export const STATE_LABEL = {
  pending: 'Pending',
  complete: 'Complete',
  incomplete: 'Incomplete',
  failed: 'Failed',
  not_assessed: 'Not assessed',
};

export const FINDING_LABEL = {
  favorable: 'Favorable',
  caution: 'Flag',
  unfavorable: 'Unfavorable',
};

export const CACHE_LABEL = {
  live: 'Live request',
  session: 'Cached (this session)',
  stored: 'Stored copy — live request failed',
  snapshot: 'Bundled snapshot — live request failed',
  mixed: 'Mixed live / cached',
};

// Display order: client priorities first.
export const CHECK_ORDER = ['slope', 'wetlands', 'grid', 'buildable', 'flood', 'protectedLand'];

export const fmtAcres = (v) => (v == null ? '—' : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} ac`);
export const fmtMoney = (v) => (v == null ? '—' : `$${Math.round(v).toLocaleString()}`);
export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
export const fmtSeconds = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);
