import React, { useState, useRef, useCallback, useEffect } from 'react';
import { fetchParcelsAtPoint, fetchParcelById, fetchLargestParcels } from '../services/geoServices';
import { normalizeParcels } from '../services/turfSpatialAnalysis';
import { assessParcel } from '../services/assessParcel';
import { emptyCostInputs } from '../services/costScenario';
import {
  listSavedAssessments,
  loadSavedAssessment,
  saveAssessment,
  deleteSavedAssessment,
  compactAssessment,
  downloadJson,
} from '../services/savedAssessments';
import ParcelFinder from './ParcelFinder';
import ParcelMap from './ParcelMap';
import AssessmentPanel from './AssessmentPanel';
import CostScenario from './CostScenario';
import Briefing from './Briefing';
import { fmtAcres, fmtDate } from './assessmentLabels';
import '../styles/SolarProspector.css';

const withSource = (features, meta) => normalizeParcels(features).map((p) => ({ ...p, source: meta }));

function CandidateTable({ candidates, selectedId, results, onSelect, message }) {
  const rowRefs = useRef({});
  // Keep the selected row visible when selection comes from the map.
  useEffect(() => {
    rowRefs.current[selectedId]?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <section className="table-wrap" aria-label="Parcels">
      <div className="table-head">
        <h2 className="section-title">Parcels</h2>
        <span className="muted">{message}</span>
      </div>
      <div className="table-scroll">
        <table className="results-table">
          <thead>
            <tr>
              <th>Parcel ID</th>
              <th>County</th>
              <th>Owner</th>
              <th className="num">GIS acres</th>
              <th className="num">Boundary acres</th>
              <th>Assessment</th>
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 ? (
              <tr>
                <td colSpan="6" className="no-data">No parcels yet. Use “Find a parcel” or click the map.</td>
              </tr>
            ) : (
              candidates.map((p) => {
                const r = results[p.id];
                return (
                  <tr
                    key={p.id}
                    ref={(el) => (rowRefs.current[p.id] = el)}
                    className={`result-row ${p.id === selectedId ? 'selected' : ''}`}
                    onClick={() => onSelect(p.id)}
                    aria-selected={p.id === selectedId}
                  >
                    <td><code>{p.parcelNumber || '—'}</code></td>
                    <td>{p.county}</td>
                    <td className="owner">{p.owner || '—'}</td>
                    <td className="num nowrap">
                      {fmtAcres(p.recordedAcres)}
                      {p.acreageMismatch && <span className="data-warning" title="Recorded acreage disagrees with the boundary"> ⚠</span>}
                    </td>
                    <td className="num nowrap">{fmtAcres(p.polygonAcres)}</td>
                    <td className="nowrap">
                      {r ? (
                        <span className={`chip ${r.status === 'complete' ? `finding-${r.tone}` : r.status === 'pending' ? 'state-pending' : 'state-incomplete'}`}>
                          {r.status === 'complete' ? `${r.total} · ${r.label}` : r.label}
                        </span>
                      ) : (
                        <span className="muted">Not assessed</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SavedList({ items, activeId, onOpen, onDelete }) {
  return (
    <section className="panel-section" aria-labelledby="saved-title">
      <h2 id="saved-title" className="section-title">Saved assessments</h2>
      {items.length === 0 ? (
        <p className="hint">Saved assessments are stored in this browser only.</p>
      ) : (
        <ul className="saved-list">
          {items.map((s) => (
            <li key={s.id} className={s.id === activeId ? 'active' : ''}>
              <button className="saved-open" onClick={() => onOpen(s.id)}>
                <span className="saved-title">{s.title}</span>
                <span className="muted">
                  {s.scoreTotal != null ? `${s.scoreTotal}/100` : 'Incomplete'} · {fmtDate(s.savedAt)}
                </span>
              </button>
              <button className="icon-btn" aria-label={`Delete ${s.title}`} onClick={() => onDelete(s.id)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function SolarSiteProspector() {
  const [candidates, setCandidates] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState({});
  const [savedRecord, setSavedRecord] = useState(null);
  const [saved, setSaved] = useState(() => listSavedAssessments());
  const [costInputs, setCostInputs] = useState(emptyCostInputs);
  const [pickedPoint, setPickedPoint] = useState(null);
  const [lookup, setLookup] = useState({ busy: false, message: 'Find a parcel to begin.', error: null });
  const [saveMessage, setSaveMessage] = useState(null);
  const runRef = useRef(null);
  const lookupRef = useRef(null);
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  useEffect(() => () => runRef.current?.abort(), []);

  const startAssessment = useCallback(async (parcel) => {
    runRef.current?.abort();
    const controller = new AbortController();
    runRef.current = controller;
    const isCurrent = () => runRef.current === controller;
    setSavedRecord(null);
    setSaveMessage(null);
    setCostInputs(emptyCostInputs());
    setRunning(true);
    setResults((prev) => ({ ...prev, [parcel.id]: { status: 'pending', label: 'Assessing…' } }));
    const final = await assessParcel(parcel, {
      signal: controller.signal,
      onUpdate: (a) => isCurrent() && setAssessment(a),
    });
    if (!isCurrent()) return;
    setAssessment(final);
    setRunning(false);
    setResults((prev) => ({
      ...prev,
      [parcel.id]: { status: final.score.status, total: final.score.total, label: final.score.label, tone: final.score.band?.tone },
    }));
  }, []);

  const selectParcel = useCallback(
    (id, list = candidates) => {
      const parcel = list.find((p) => p.id === id);
      if (!parcel) return;
      setSelectedId(id);
      startAssessment(parcel);
    },
    [candidates, startAssessment]
  );

  // Run a parcel lookup; only the latest lookup may update state.
  const runLookup = useCallback(async (describe, fetcher, { autoSelect }) => {
    lookupRef.current?.abort();
    const controller = new AbortController();
    lookupRef.current = controller;
    setLookup({ busy: true, message: `${describe}…`, error: null });
    try {
      const { features, meta } = await fetcher(controller.signal);
      if (lookupRef.current !== controller) return;
      const found = withSource(features, meta);
      if (!found.length) {
        setLookup({ busy: false, message: null, error: 'No NC OneMap parcel found. A point on a road, river or unmapped land has no parcel.' });
        return;
      }
      const cacheNote = meta.cache !== 'live' ? ' (cached response)' : '';
      setLookup({ busy: false, message: `${found.length} parcel${found.length > 1 ? 's' : ''} from NC OneMap${cacheNote}.`, error: null });
      if (autoSelect) {
        // Found parcels go to the top; earlier results stay listed below.
        const merged = [...found, ...candidatesRef.current.filter((p) => !found.some((f) => f.id === p.id))];
        setCandidates(merged);
        selectParcel(found[0].id, merged);
      } else {
        setCandidates(found);
        setSelectedId(null);
      }
    } catch (err) {
      if (lookupRef.current === controller) setLookup({ busy: false, message: null, error: err.message });
    }
  }, [selectParcel]);

  const findAtPoint = useCallback(
    ({ lat, lon }) => {
      setPickedPoint({ lat, lon });
      runLookup(`Looking up the parcel at ${lat.toFixed(5)}, ${lon.toFixed(5)}`, (signal) => fetchParcelsAtPoint(lon, lat, { signal }), { autoSelect: true });
    },
    [runLookup]
  );
  const findById = (parno, county) =>
    runLookup(`Looking up parcel ${parno}`, (signal) => fetchParcelById(parno, county, { signal }), { autoSelect: true });
  const browse = ({ counties, minAcres, limit }) => {
    setPickedPoint(null);
    runLookup(`Listing the ${limit} largest parcels in ${counties.join(', ')}`, (signal) => fetchLargestParcels(counties, { minAcres, limit, signal }), { autoSelect: false });
  };

  const onMapClick = useCallback(({ lat, lng }) => findAtPoint({ lat, lon: lng }), [findAtPoint]);

  const onSave = () => {
    try {
      const record = saveAssessment(assessment, costInputs);
      setSaved(listSavedAssessments());
      setSavedRecord(record);
      setSaveMessage({ text: `Saved ${fmtDate(record.savedAt)} in this browser.` });
    } catch (err) {
      setSaveMessage({ text: err.message, error: true });
    }
  };

  const openSaved = (id) => {
    const record = loadSavedAssessment(id);
    if (!record) return setSaveMessage({ text: 'That saved assessment could not be read.', error: true });
    runRef.current?.abort();
    runRef.current = null;
    setRunning(false);
    setAssessment(record);
    setSavedRecord(record);
    setCostInputs({ ...emptyCostInputs(), ...record.costInputs });
    setSaveMessage(null);
    setCandidates((prev) => [record.parcel, ...prev.filter((p) => p.id !== record.parcel.id)]);
    setSelectedId(record.parcel.id);
    setResults((prev) => ({
      ...prev,
      [record.parcel.id]: { status: record.score.status, total: record.score.total, label: `Saved · ${record.score.label}`, tone: record.score.band?.tone },
    }));
  };

  const removeSaved = (id) => {
    deleteSavedAssessment(id);
    setSaved(listSavedAssessments());
    if (savedRecord?.id === id) setSavedRecord(null);
  };

  const onExport = () => downloadJson(savedRecord ? { ...savedRecord, costInputs } : { ...compactAssessment(assessment), costInputs, exportedAt: new Date().toISOString() });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">☀</span>
          <div>
            <h1>SunGrid Site Prospector</h1>
            <p>Single-parcel screening · North Carolina</p>
          </div>
        </div>
        <span className="engineer-badge">Screening aid · not an approval</span>
      </header>

      <div className="workspace">
        <aside className="left-panel">
          <ParcelFinder busy={lookup.busy} onFindAtPoint={findAtPoint} onFindById={findById} onBrowse={browse} />
          <div className={`lookup-status ${lookup.error ? 'error' : ''}`} role="status">
            {lookup.busy && <span className="spinner" aria-hidden="true" />}
            {lookup.error || lookup.message}
          </div>
          <SavedList items={saved} activeId={savedRecord?.id} onOpen={openSaved} onDelete={removeSaved} />
        </aside>

        <main className="center">
          <div className="map-wrap">
            <ParcelMap
              candidates={candidates}
              selectedId={selectedId}
              assessment={assessment}
              pickedPoint={pickedPoint}
              onSelect={(id) => selectParcel(id)}
              onMapClick={onMapClick}
            />
          </div>
          <CandidateTable candidates={candidates} selectedId={selectedId} results={results} onSelect={(id) => selectParcel(id)} message={lookup.busy ? 'Loading…' : `${candidates.length} shown`} />
        </main>

        <aside className="right-panel" aria-label="Assessment">
          <AssessmentPanel
            assessment={assessment}
            running={running}
            savedRecord={savedRecord}
            onSave={onSave}
            onExport={onExport}
            onPrint={() => window.print()}
            saveMessage={saveMessage}
          >
            {assessment && <CostScenario assessment={assessment} inputs={costInputs} onChange={setCostInputs} />}
          </AssessmentPanel>
        </aside>
      </div>

      <Briefing assessment={running ? null : assessment} costInputs={costInputs} savedAt={savedRecord?.savedAt} />
    </div>
  );
}
