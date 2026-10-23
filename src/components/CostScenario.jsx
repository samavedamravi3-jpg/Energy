import React from 'react';
import { COST_INPUTS, COST_DISCLAIMER, computeCostScenario } from '../services/costScenario';
import { ACRES_PER_MW } from '../services/turfSpatialAnalysis';
import { fmtMoney } from './assessmentLabels';

// Suggestions are offered as buttons, never pre-filled: they come from this
// parcel's data, not from cost rates.
function suggestionsFor(assessment) {
  const s = {};
  if (!assessment) return s;
  const { parcel, checks } = assessment;
  s.landAcres = { value: Number(parcel.polygonAcres.toFixed(1)), note: 'parcel polygon area' };
  if (checks.buildable?.acres != null) {
    s.capacityMw = { value: Math.round(checks.buildable.acres / ACRES_PER_MW), note: `buildable acres ÷ ${ACRES_PER_MW} ac/MW (provisional)` };
  }
  const sub = checks.grid?.metrics?.nearestHv || checks.grid?.metrics?.nearest;
  if (sub) s.lineMiles = { value: Number(sub.miles.toFixed(2)), note: 'straight-line distance only, not a route' };
  return s;
}

export default function CostScenario({ assessment, inputs, onChange, readOnly }) {
  const result = computeCostScenario(inputs);
  const suggestions = suggestionsFor(assessment);
  // Functional update: several quick edits must not overwrite each other.
  const set = (key, value) => onChange((prev) => ({ ...prev, [key]: value }));

  return (
    <section className="cost-panel" aria-labelledby="cost-title">
      <h3 id="cost-title" className="section-title">Cost scenario</h3>
      <p className="hint">{COST_DISCLAIMER}</p>

      <div className="form-stack">
        {COST_INPUTS.filter((f) => !f.mode || f.mode === inputs.landMode).map((f) =>
          f.kind === 'choice' ? (
            <div key={f.key} className="field">
              <span>{f.label}</span>
              <div className="segmented" role="radiogroup">
                {f.options.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={inputs[f.key] === value}
                    className={inputs[f.key] === value ? 'active' : ''}
                    onClick={() => set(f.key, value)}
                    disabled={readOnly}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <label key={f.key} className="field">
              <span>
                {f.label} <span className="unit">({f.unit})</span>
              </span>
              <input inputMode="decimal" value={inputs[f.key] ?? ''} placeholder="not entered" onChange={(e) => set(f.key, e.target.value)} readOnly={readOnly} />
              {suggestions[f.key] && !readOnly && (
                <button type="button" className="link-btn" onClick={() => set(f.key, String(suggestions[f.key].value))}>
                  Use {suggestions[f.key].value.toLocaleString()} ({suggestions[f.key].note})
                </button>
              )}
            </label>
          )
        )}
      </div>

      <table className="cost-table">
        <thead>
          <tr>
            <th>Upfront line</th>
            <th>Calculation</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {result.upfront.map((l) => (
            <tr key={l.key}>
              <td>{l.label}</td>
              <td className="formula">{l.formula}</td>
              <td className="num">{l.amount != null ? fmtMoney(l.amount) : <span className="muted">needs {l.missing.join(', ')}</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="2">Estimated upfront subtotal</td>
            <td className="num">
              {result.upfrontSubtotal != null ? (
                <strong>{fmtMoney(result.upfrontSubtotal)}</strong>
              ) : (
                <span className="muted">incomplete</span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
      {result.upfrontSubtotal == null && (
        <p className="hint">
          Subtotal withheld: {result.upfrontMissing.join(', ')} {result.upfrontMissing.length > 1 ? 'are' : 'is'} missing inputs.
          {result.upfrontPartial > 0 && ` Entered lines alone total ${fmtMoney(result.upfrontPartial)} (partial).`}
        </p>
      )}

      {result.annual && (
        <table className="cost-table">
          <thead>
            <tr>
              <th>Annual (recurring)</th>
              <th>Calculation</th>
              <th className="num">Per year</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{result.annual.label}</td>
              <td className="formula">{result.annual.formula}</td>
              <td className="num">{result.annual.amount != null ? fmtMoney(result.annual.amount) : <span className="muted">needs {result.annual.missing.join(', ')}</span>}</td>
            </tr>
          </tbody>
        </table>
      )}
      {result.annual && <p className="hint">Lease cost recurs every year and is not included in the upfront subtotal.</p>}
    </section>
  );
}
