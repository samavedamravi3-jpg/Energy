import React from 'react';
import { SOURCES } from '../services/geoServices';
import { SCORE_DISCLAIMER } from '../services/scoring';
import { COST_DISCLAIMER, computeCostScenario } from '../services/costScenario';
import { SLOPE_LIMIT_PERCENT } from '../services/turfSpatialAnalysis';
import { STATE_LABEL, FINDING_LABEL, CACHE_LABEL, CHECK_ORDER, fmtAcres, fmtDate, fmtMoney } from './assessmentLabels';

const FILL = { wetlands: '#14b8a6', flood: '#3b82f6', protectedLand: '#a855f7' };

// Static SVG map: prints reliably without tiles.
function ParcelSketch({ assessment }) {
  const { parcel, checks } = assessment;
  const rings = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
  const all = rings(parcel.geometry).flat(2);
  const sub = checks.grid?.metrics?.nearestHv || checks.grid?.metrics?.nearest;
  const pts = sub && sub.miles < 4 ? [...all, sub.coordinates] : all;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const W = 520;
  const H = 340;
  const pad = 16;
  const scale = Math.min((W - 2 * pad) / ((e - w) * k || 1e-9), (H - 2 * pad) / (n - s || 1e-9));
  const px = ([x, y]) => [pad + (x - w) * k * scale, H - pad - (y - s) * scale];
  const path = (g) =>
    rings(g)
      .map((poly) => poly.map((ring) => 'M' + ring.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join(''))
      .join('');

  return (
    <svg className="sketch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Parcel boundary with mapped constraints">
      <rect width={W} height={H} fill="#f8fafc" />
      {['flood', 'protectedLand', 'wetlands'].map((key) =>
        (checks[key]?.pieces || []).map((p, i) => <path key={`${key}${i}`} d={path(p.geometry)} fill={FILL[key]} fillOpacity="0.45" stroke="none" />)
      )}
      <path d={path(parcel.geometry)} fill="none" stroke="#b7791f" strokeWidth="2.5" />
      {(checks.slope?.samples || []).map((sm, i) => {
        const [x, y] = px([sm.lon, sm.lat]);
        return <circle key={i} cx={x} cy={y} r="3" fill={sm.slopePct == null ? '#94a3b8' : sm.slopePct > SLOPE_LIMIT_PERCENT ? '#ea580c' : '#16a34a'} />;
      })}
      {sub && sub.miles < 4 && (() => {
        const [x, y] = px(sub.coordinates);
        return (
          <g>
            <circle cx={x} cy={y} r="6" fill="#0f172a" />
            <text x={x + 9} y={y + 4} fontSize="11" fill="#0f172a">Substation · {sub.miles.toFixed(1)} mi straight-line</text>
          </g>
        );
      })()}
    </svg>
  );
}

export default function Briefing({ assessment, costInputs, savedAt }) {
  if (!assessment) return null;
  const { parcel, checks, score } = assessment;
  const cost = computeCostScenario(costInputs);
  const anyCostInput = Object.entries(costInputs).some(([k, v]) => k !== 'landMode' && v !== null && v !== '');
  const unresolved = CHECK_ORDER.filter((k) => checks[k] && checks[k].state !== 'complete');
  const sources = CHECK_ORDER.flatMap((k) => (checks[k]?.sources || []).map((s) => ({ ...s, check: checks[k].label })));

  return (
    <article className="briefing" aria-hidden="true">
      <header>
        <div className="eyebrow">SunGrid Renewables · Parcel Screening Brief</div>
        <h1>
          Parcel {parcel.parcelNumber || '—'} · {parcel.county} County, NC
        </h1>
        <p>
          Assessed {fmtDate(assessment.startedAt)}
          {savedAt ? ` · saved ${fmtDate(savedAt)}` : ''} · {parcel.owner || 'Owner not recorded'} · {fmtAcres(parcel.recordedAcres)} recorded (
          {fmtAcres(parcel.polygonAcres)} boundary)
        </p>
      </header>

      <section className="b-grid">
        <ParcelSketch assessment={assessment} />
        <div>
          <h2>Result</h2>
          <p className="b-score">
            {score.total != null ? `${score.total} / 100 — ${score.label}` : `${score.label} (${score.completeness.completeCount}/${score.completeness.totalCount} components complete)`}
          </p>
          {score.fatalFlaw && <p><strong>Fatal flaw:</strong> {score.fatalFlaw}</p>}
          <p>Data completeness: {Math.round(score.completeness.weightShare * 100)}% of score weight.</p>
          <p className="b-small">{SCORE_DISCLAIMER}</p>
          <p className="b-small">
            Map: gold = parcel; teal = NWI wetlands; blue = FEMA flood hazard; purple = PAD-US; dots = slope samples (green ≤ 5%, orange &gt; 5%).
          </p>
        </div>
      </section>

      <section>
        <h2>Score explanation</h2>
        <table>
          <thead>
            <tr><th>Component</th><th>Rule</th><th>Points</th></tr>
          </thead>
          <tbody>
            {score.components.map((c) => (
              <tr key={c.key}>
                <td>{c.label}{c.provisional ? ' (provisional)' : ''}</td>
                <td>{c.rule}</td>
                <td>{c.points != null ? `${c.points.toFixed(1)} / ${c.weight}` : `${STATE_LABEL[c.state]} / ${c.weight}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Findings</h2>
        <table>
          <tbody>
            {CHECK_ORDER.map((k) => checks[k] && (
              <tr key={k}>
                <td><strong>{checks[k].label}</strong></td>
                <td>{STATE_LABEL[checks[k].state]}{checks[k].finding ? ` · ${FINDING_LABEL[checks[k].finding]}` : ''}</td>
                <td>{checks[k].summary}{checks[k].detail ? ` — ${checks[k].detail}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Unresolved checks</h2>
        {unresolved.length ? (
          <ul>{unresolved.map((k) => <li key={k}>{checks[k].label}: {STATE_LABEL[checks[k].state]} — {checks[k].detail || checks[k].summary}</li>)}</ul>
        ) : (
          <p>None. All checks returned complete data.</p>
        )}
        <p className="b-small">Mapped NWI wetlands are a screening finding, not a jurisdictional delineation. Distances are straight-line, not routes. Recorded voltages are not capacity.</p>
      </section>

      {anyCostInput && (
        <section>
          <h2>Cost scenario (user assumptions)</h2>
          <table>
            <tbody>
              {cost.upfront.map((l) => (
                <tr key={l.key}><td>{l.label}</td><td>{l.formula}</td><td>{l.amount != null ? fmtMoney(l.amount) : 'missing inputs'}</td></tr>
              ))}
              <tr><td><strong>Upfront subtotal</strong></td><td /><td>{cost.upfrontSubtotal != null ? fmtMoney(cost.upfrontSubtotal) : `incomplete (missing: ${cost.upfrontMissing.join(', ')})`}</td></tr>
              {cost.annual && <tr><td>{cost.annual.label} (annual, separate)</td><td>{cost.annual.formula}</td><td>{cost.annual.amount != null ? `${fmtMoney(cost.annual.amount)}/yr` : 'missing inputs'}</td></tr>}
            </tbody>
          </table>
          <p className="b-small">{COST_DISCLAIMER}</p>
        </section>
      )}

      <section>
        <h2>Sources</h2>
        <table className="b-sources">
          <tbody>
            {sources.map((s, i) => (
              <tr key={i}>
                <td>{s.check}</td>
                <td>{s.service}<br /><span className="b-small">{s.url}</span></td>
                <td>{CACHE_LABEL[s.cache] ?? s.cache}<br />{fmtDate(s.retrievedAt)}</td>
              </tr>
            ))}
            <tr>
              <td>Parcel boundary</td>
              <td>{SOURCES.parcels.name}<br /><span className="b-small">{parcel.source?.url || SOURCES.parcels.docs}</span></td>
              <td>{parcel.source ? <>{CACHE_LABEL[parcel.source.cache] ?? parcel.source.cache}<br />{fmtDate(parcel.source.retrievedAt)}</> : null}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </article>
  );
}
