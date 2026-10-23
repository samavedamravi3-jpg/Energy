import React from 'react';
import { SCORE_DISCLAIMER, SITE_TARGET_ACRES } from '../services/scoring';
import { ACRES_PER_MW } from '../services/turfSpatialAnalysis';
import { STATE_LABEL, FINDING_LABEL, CACHE_LABEL, CHECK_ORDER, fmtAcres, fmtMoney, fmtDate, fmtSeconds } from './assessmentLabels';

export function StateChip({ state }) {
  return <span className={`chip state-${state}`}>{STATE_LABEL[state] ?? state}</span>;
}

export function FindingChip({ check }) {
  if (check.state === 'pending') return null;
  if (!check.finding) return <span className="chip finding-unknown">Unknown</span>;
  return <span className={`chip finding-${check.finding}`}>{FINDING_LABEL[check.finding]}</span>;
}

function SourceList({ sources }) {
  if (!sources?.length) return null;
  return (
    <ul className="source-list">
      {sources.map((s, i) => (
        <li key={i}>
          <span className="source-name">{s.service}</span>
          <span className={`cache-tag cache-${s.cache}`}>{CACHE_LABEL[s.cache] ?? s.cache}</span>
          <span className="muted">
            Retrieved {fmtDate(s.retrievedAt)}
            {s.durationMs ? ` · ${fmtSeconds(s.durationMs)}` : ''}
          </span>
          {s.liveError && <span className="muted">Live error: {s.liveError}</span>}
          <code className="source-url" title={s.url}>{s.url}</code>
        </li>
      ))}
    </ul>
  );
}

function SlopeMetrics({ m }) {
  if (!m?.coverage) return null;
  const c = m.coverage;
  return (
    <dl className="metric-grid">
      <dt>Sample points</dt>
      <dd>{c.elevationsReceived} of {c.plannedPoints} elevations received{c.failedPoints ? ` (${c.failedPoints} failed)` : ''}</dd>
      <dt>Slope estimates</dt>
      <dd>{c.slopeEstimates} · ~{Math.round(c.spacingFt).toLocaleString()} ft spacing · ~{c.acresPerEstimate?.toFixed(1) ?? '—'} ac each</dd>
      {m.medianPct != null && (
        <>
          <dt>Median / 90th pct / max</dt>
          <dd>{m.medianPct.toFixed(1)}% / {m.p90Pct.toFixed(1)}% / {m.maxPct.toFixed(1)}%</dd>
          <dt>Share above 5%</dt>
          <dd>{(m.steepShare * 100).toFixed(0)}% of estimates</dd>
        </>
      )}
    </dl>
  );
}

function GridMetrics({ m }) {
  if (!m) return null;
  const row = (label, s) => (
    <>
      <dt>{label}</dt>
      <dd>
        {s ? (
          <>
            {s.miles.toFixed(2)} mi straight-line · {s.recordedKv != null ? `${s.recordedKv} kV recorded` : 'voltage not recorded'}
            {s.voltageTag && s.recordedKv != null ? ` (tag "${s.voltageTag}")` : ''} · {s.name || 'unnamed'} · OSM {s.osmId}
          </>
        ) : (
          `None within ${m.searchMiles} mi`
        )}
      </dd>
    </>
  );
  return (
    <dl className="metric-grid">
      {row('Nearest substation', m.nearest)}
      {row('Nearest with ≥ 115 kV recorded', m.nearestHv)}
      <dt>Preference</dt>
      <dd>~{m.preferenceMiles} mi (client guidance, not a hard limit)</dd>
    </dl>
  );
}

function OverlayMetrics({ m }) {
  if (!m?.breakdown?.length) return null;
  return (
    <ul className="breakdown">
      {m.breakdown.slice(0, 6).map((b) => (
        <li key={b.name}>
          {b.name}: {b.acres.toFixed(1)} ac
        </li>
      ))}
      {m.breakdown.length > 6 && <li className="muted">+{m.breakdown.length - 6} more</li>}
    </ul>
  );
}

function CheckCard({ id, check }) {
  return (
    <article className={`check-card state-border-${check.state}`} id={`check-${id}`}>
      <header className="check-head">
        <h4>{check.label}</h4>
        <div className="chip-row">
          <StateChip state={check.state} />
          <FindingChip check={check} />
        </div>
      </header>
      <p className="check-summary">{check.summary}</p>
      {check.detail && <p className="check-detail">{check.detail}</p>}
      {id === 'slope' && <SlopeMetrics m={check.metrics} />}
      {id === 'grid' && <GridMetrics m={check.metrics} />}
      {['wetlands', 'flood', 'protectedLand'].includes(id) && <OverlayMetrics m={check.metrics} />}
      {check.limitations?.length > 0 && (
        <details className="limitations">
          <summary>Limitations</summary>
          <ul>{check.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </details>
      )}
      {check.sources?.length > 0 && (
        <details className="sources">
          <summary>Source · {CACHE_LABEL[check.sources[0].cache] ?? check.sources[0].cache}</summary>
          <SourceList sources={check.sources} />
        </details>
      )}
    </article>
  );
}

export function ScoreCard({ score }) {
  const pct = Math.round(score.completeness.weightShare * 100);
  return (
    <section className={`score-card tone-${score.band?.tone ?? 'none'}`} aria-live="polite">
      <div className="score-main">
        {score.total != null ? (
          <div className="score-number">
            {score.total}
            <span>/100</span>
          </div>
        ) : (
          <div className="score-number score-missing">—</div>
        )}
        <div>
          <div className="score-label">{score.label}</div>
          {score.status !== 'complete' && (
            <div className="score-sub">
              {score.earnedOnAssessed.toFixed(0)} of {score.assessedWeight} points on assessed components; total withheld until all {score.completeness.totalCount} are complete.
            </div>
          )}
        </div>
      </div>
      {score.fatalFlaw && <p className="fatal-flaw">Fatal flaw: {score.fatalFlaw}</p>}
      <div className="completeness">
        <div className="completeness-head">
          <span>Data completeness</span>
          <span>
            {score.completeness.completeCount}/{score.completeness.totalCount} components · {pct}% of weight
          </span>
        </div>
        <div className="meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="disclaimer">{SCORE_DISCLAIMER}</p>
    </section>
  );
}

export function ScoreBreakdown({ score }) {
  return (
    <details className="score-breakdown" open>
      <summary>How the score is built</summary>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th className="num">Points</th>
          </tr>
        </thead>
        <tbody>
          {score.components.map((c) => (
            <tr key={c.key}>
              <td>
                <div className="component-name">
                  {c.label} {c.provisional && <span className="provisional">provisional</span>}
                </div>
                <div className="component-rule">{c.rule}</div>
              </td>
              <td className="num">
                {c.points != null ? (
                  <strong>
                    {c.points.toFixed(1)} <span className="muted">/ {c.weight}</span>
                  </strong>
                ) : (
                  <span className="muted">
                    {STATE_LABEL[c.state]} / {c.weight}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="num">{score.total != null ? <strong>{score.total} / 100</strong> : <span className="muted">withheld</span>}</td>
          </tr>
        </tfoot>
      </table>
      <p className="hint">
        Weights, curves and bands are provisional (not supplied by SunGrid). Client-supplied thresholds: slope 5%, ~3 mi to a
        high-voltage substation, {SITE_TARGET_ACRES.min}–{SITE_TARGET_ACRES.max} ac buildable area for a combined site.
      </p>
    </details>
  );
}

export default function AssessmentPanel({ assessment, running, savedRecord, onSave, onExport, onPrint, saveMessage, children }) {
  if (!assessment) {
    return (
      <div className="empty-state">
        <h2>No parcel selected</h2>
        <p>Enter coordinates, look up a parcel ID, browse a county, or click the map. The assessment runs automatically.</p>
      </div>
    );
  }
  const { parcel, checks, score } = assessment;
  const unresolved = CHECK_ORDER.filter((k) => checks[k] && checks[k].state !== 'complete');
  const statusText = savedRecord
    ? `Saved copy from ${fmtDate(savedRecord.savedAt)} — data as retrieved then`
    : running
      ? `Assessing… ${fmtSeconds(assessment.elapsedMs)}`
      : `Finished in ${fmtSeconds(assessment.totalMs)}`;

  return (
    <div className="assessment">
      <section className="parcel-head">
        <div className="eyebrow">{statusText}</div>
        <h2>
          Parcel <code>{parcel.parcelNumber || '—'}</code>
        </h2>
        <dl className="parcel-facts">
          <dt>County</dt>
          <dd>{parcel.county || '—'}</dd>
          <dt>Owner</dt>
          <dd>{parcel.owner || '—'}</dd>
          <dt>GIS acres</dt>
          <dd>
            {fmtAcres(parcel.recordedAcres)}
            {parcel.acreageMismatch && <span className="data-warning"> ⚠ boundary measures {fmtAcres(parcel.polygonAcres)}</span>}
          </dd>
          <dt>Address</dt>
          <dd>{parcel.siteAddress || '—'}</dd>
          <dt>Land use</dt>
          <dd>{parcel.landUse || '—'}</dd>
          <dt>Land value</dt>
          <dd>{fmtMoney(parcel.landValue)}</dd>
          {checks.buildable?.acres != null && (
            <>
              <dt>Rough capacity</dt>
              <dd>
                ≈ {(checks.buildable.acres / ACRES_PER_MW).toFixed(0)} MW <span className="muted">(buildable ÷ {ACRES_PER_MW} ac/MW, provisional)</span>
              </dd>
            </>
          )}
        </dl>
        {parcel.sharedBoundaryParcels?.length > 0 && <p className="hint">Same boundary also recorded as {parcel.sharedBoundaryParcels.join(', ')}.</p>}
        {parcel.source && (
          <details className="sources">
            <summary>Boundary source · {CACHE_LABEL[parcel.source.cache] ?? parcel.source.cache}</summary>
            <SourceList sources={[parcel.source]} />
          </details>
        )}
      </section>

      <ScoreCard score={score} />

      {unresolved.length > 0 && !running && (
        <section className="unresolved" role="status">
          <strong>Unresolved checks:</strong>{' '}
          {unresolved.map((k, i) => (
            <span key={k}>
              {i > 0 && ', '}
              <a href={`#check-${k}`}>{checks[k].label}</a> ({STATE_LABEL[checks[k].state].toLowerCase()})
            </span>
          ))}
        </section>
      )}

      <div className="actions">
        <button className="btn btn-primary" onClick={onSave} disabled={running}>
          {savedRecord ? 'Save again' : 'Save assessment'}
        </button>
        <button className="btn" onClick={onPrint} disabled={running}>Print briefing</button>
        <button className="btn" onClick={onExport} disabled={running}>Export JSON</button>
      </div>
      {saveMessage && <p className={`save-message ${saveMessage.error ? 'form-error' : ''}`} role="status">{saveMessage.text}</p>}

      <ScoreBreakdown score={score} />

      <section className="checks" aria-label="Findings">
        <h3 className="section-title">Findings</h3>
        {CHECK_ORDER.map((k) => checks[k] && <CheckCard key={k} id={k} check={checks[k]} />)}
      </section>

      {children}

      <section className="timing">
        <h3 className="section-title">Timing</h3>
        <dl className="metric-grid">
          <dt>Total</dt>
          <dd>{fmtSeconds(assessment.totalMs ?? assessment.elapsedMs)}</dd>
          {Object.entries(assessment.timings || {}).map(([k, ms]) => (
            <React.Fragment key={k}>
              <dt>{checks[k]?.label ?? k}</dt>
              <dd>
                {fmtSeconds(ms)} · {CACHE_LABEL[checks[k]?.sources?.[0]?.cache] ?? 'no data'}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      </section>
    </div>
  );
}
