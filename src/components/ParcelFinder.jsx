import React, { useState } from 'react';
import { LIMITS } from '../services/geoServices';

const COUNTIES = ['Wake', 'Johnston', 'Mecklenburg'];
// Rough North Carolina extent, to catch swapped or mistyped coordinates.
const NC_BOUNDS = { minLat: 33.75, maxLat: 36.65, minLon: -84.4, maxLon: -75.3 };

export function parseCoordinates(latText, lonText) {
  // Accept "35.78, -78.64" pasted into the latitude box.
  let lat = latText;
  let lon = lonText;
  if (!lonText && /[,\s]/.test(String(latText).trim())) [lat, lon] = String(latText).trim().split(/[\s,]+/);
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return { error: 'Enter latitude and longitude as decimal degrees, e.g. 35.7796, -78.6382.' };
  if (la < NC_BOUNDS.minLat || la > NC_BOUNDS.maxLat || lo < NC_BOUNDS.minLon || lo > NC_BOUNDS.maxLon) {
    return { error: 'That point is outside North Carolina. Check the order (latitude first) and the minus sign on longitude.' };
  }
  return { lat: la, lon: lo };
}

export default function ParcelFinder({ busy, onFindAtPoint, onFindById, onBrowse }) {
  const [tab, setTab] = useState('coords');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [parno, setParno] = useState('');
  const [idCounty, setIdCounty] = useState('');
  const [counties, setCounties] = useState(['Wake', 'Johnston']);
  const [minAcres, setMinAcres] = useState(100);
  const [limit, setLimit] = useState(10);
  const [formError, setFormError] = useState(null);

  const submitCoords = (e) => {
    e.preventDefault();
    const parsed = parseCoordinates(lat, lon);
    if (parsed.error) return setFormError(parsed.error);
    setFormError(null);
    onFindAtPoint(parsed);
  };
  const submitId = (e) => {
    e.preventDefault();
    if (!parno.trim()) return setFormError('Enter a parcel number (PIN) as recorded by the county.');
    setFormError(null);
    onFindById(parno, idCounty || null);
  };
  const submitBrowse = (e) => {
    e.preventDefault();
    if (!counties.length) return setFormError('Select at least one county.');
    setFormError(null);
    onBrowse({ counties, minAcres: Number(minAcres) || 0, limit: Math.min(LIMITS.maxParcels, Math.max(1, Number(limit) || 10)) });
  };

  return (
    <section className="panel-section" aria-labelledby="finder-title">
      <h2 id="finder-title" className="section-title">Find a parcel</h2>
      <div className="tabs" role="tablist">
        {[
          ['coords', 'Coordinates'],
          ['id', 'Parcel ID'],
          ['browse', 'Browse'],
        ].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => { setTab(key); setFormError(null); }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'coords' && (
        <form className="form-stack" onSubmit={submitCoords}>
          <div className="field-row">
            <label className="field">
              <span>Latitude</span>
              <input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="35.6550" />
            </label>
            <label className="field">
              <span>Longitude</span>
              <input inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="-78.4860" />
            </label>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>Find parcel at point</button>
          <p className="hint">Or click anywhere on the map.</p>
        </form>
      )}

      {tab === 'id' && (
        <form className="form-stack" onSubmit={submitId}>
          <label className="field">
            <span>Parcel number (PIN)</span>
            <input value={parno} onChange={(e) => setParno(e.target.value)} placeholder="0618420089" />
          </label>
          <label className="field">
            <span>County (optional)</span>
            <select value={idCounty} onChange={(e) => setIdCounty(e.target.value)}>
              <option value="">Any county</option>
              {COUNTIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>Look up parcel</button>
        </form>
      )}

      {tab === 'browse' && (
        <form className="form-stack" onSubmit={submitBrowse}>
          <fieldset className="field">
            <legend>Counties</legend>
            <div className="chip-row">
              {COUNTIES.map((c) => (
                <label key={c} className="check-chip">
                  <input type="checkbox" checked={counties.includes(c)} onChange={() => setCounties((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))} />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field-row">
            <label className="field">
              <span>Min parcel acres</span>
              <input type="number" min="0" value={minAcres} onChange={(e) => setMinAcres(e.target.value)} />
            </label>
            <label className="field">
              <span>Max results</span>
              <input type="number" min="1" max={LIMITS.maxParcels} value={limit} onChange={(e) => setLimit(e.target.value)} />
            </label>
          </div>
          <p className="hint">Largest parcels first. This filters individual parcels; the 500–700 ac target applies to a combined site.</p>
          <button className="btn btn-primary" type="submit" disabled={busy}>List parcels</button>
        </form>
      )}
      {formError && <p className="form-error" role="alert">{formError}</p>}
    </section>
  );
}
