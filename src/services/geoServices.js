/**
 * SunGrid Renewables - GIS API Integration Service
 *
 * Every function resolves with data plus `meta` provenance (see httpClient.js)
 * or throws an Error naming the service and the failure. Callers must treat a
 * thrown error as "unknown", never as a passed check.
 */
import { fetchJson } from './httpClient';

const DEV = Boolean(import.meta.env?.DEV);

// Upstream URLs of services the dev server proxies (see vite.config.js).
// Results always record the upstream URL, not the local proxy path.
const UPSTREAM = {
  overpass: 'https://overpass-api.de/api/interpreter',
  nwi: 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query',
};

// Endpoints verified against each service's live REST metadata (?f=json).
export const ENDPOINTS = {
  // NC1Map_Parcels layer 1 = "Parcels (polys)". Layer 0 is centroid points.
  ncParcels: 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1/query',
  // overpass-api.de rejects many browser and generic User-Agents with HTTP 406,
  // and page code cannot set User-Agent. In dev, vite.config.js proxies this
  // path to overpass-api.de with an identifying User-Agent.
  overpass: DEV ? '/api/overpass' : UPSTREAM.overpass,
  // NFHL layer 28 = "Flood Hazard Zones".
  femaFlood: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query',
  // USGS-published "PAD-US Protection Status by GAP Status Code" feature service.
  padus: 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/PADUS_Protection_Status_by_GAP_Status_Code/FeatureServer/0/query',
  // USFWS National Wetlands Inventory (www.fws.gov/wetlandsmapservice redirects
  // to UPSTREAM.nwi). It returns HTTP 500 without CORS headers to some browser
  // User-Agents (headless Chrome), so dev requests go through the Vite proxy.
  nwi: DEV ? '/api/nwi' : UPSTREAM.nwi,
  epqs: 'https://epqs.nationalmap.gov/v1/json',
};

// Human-facing source descriptions for the briefing and sources panel.
export const SOURCES = {
  parcels: { name: 'NC OneMap Parcels (NC1Map_Parcels)', docs: 'https://www.nconemap.gov/datasets/nconemap::north-carolina-parcels-polygons/about' },
  substations: { name: 'OpenStreetMap power=substation via Overpass API (ODbL)', docs: 'https://wiki.openstreetmap.org/wiki/Overpass_API' },
  flood: { name: 'FEMA National Flood Hazard Layer, Flood Hazard Zones (layer 28)', docs: 'https://www.fema.gov/flood-maps/national-flood-hazard-layer' },
  protectedLand: { name: 'USGS PAD-US Protection Status by GAP Status Code', docs: 'https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-web-services' },
  wetlands: { name: 'USFWS National Wetlands Inventory (Wetlands layer)', docs: 'https://www.fws.gov/program/national-wetlands-inventory/wetlands-mapper' },
  elevation: { name: 'USGS 3DEP Elevation Point Query Service (EPQS)', docs: 'https://apps.nationalmap.gov/epqs/' },
};

export const LIMITS = {
  maxParcels: 25,
  maxZoneFeatures: 500,
  // ~10 m generalization of constraint polygons; fine for screening, and keeps
  // responses small enough to avoid ArcGIS Online "large geometry" throttling.
  zoneSimplifyDegrees: 0.0001,
  parcelTimeoutMs: 20000,
  // Short on purpose: the cached snapshot takes over when Overpass is busy.
  overpassTimeoutMs: 25000,
  overlayTimeoutMs: 30000,
  elevationTimeoutMs: 10000,
  // EPQS serves HTTP/2, so the browser multiplexes these on one connection.
  elevationConcurrency: 10,
};

const PARCEL_FIELDS = 'objectid,parno,ownname,cntyname,gisacres,landval,parval,siteadd,parusedesc';
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function queryParcels(params, signal) {
  const query = new URLSearchParams({
    outFields: PARCEL_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    f: 'geojson',
    ...params,
  });
  const { data, meta } = await fetchJson('NC OneMap Parcels', `${ENDPOINTS.ncParcels}?${query}`, {
    timeoutMs: LIMITS.parcelTimeoutMs,
    // NC OneMap intermittently stalls (> 40 s) and then answers in ~3 s.
    retryOnTimeout: true,
    signal,
  });
  if (!Array.isArray(data?.features)) throw new Error('NC OneMap Parcels returned no feature list');
  return { features: data.features.filter((f) => f.geometry), meta };
}

// Parcel(s) containing a WGS84 point. Several records can share one boundary.
export function fetchParcelsAtPoint(lon, lat, { signal } = {}) {
  return queryParcels(
    {
      geometry: `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      resultRecordCount: '5',
    },
    signal
  );
}

export function fetchParcelById(parno, county, { signal } = {}) {
  let where = `parno = ${sqlString(parno.trim())}`;
  if (county) where += ` AND cntyname = ${sqlString(county)}`;
  return queryParcels({ where, resultRecordCount: '5' }, signal);
}

// Largest parcels in the counties (capped). minAcres / maxAcres filter
// *individual parcel* size, not the 500-700 ac combined-site target.
export function fetchLargestParcels(counties, { minAcres = 100, maxAcres = null, limit = 10, signal } = {}) {
  if (!counties?.length) throw new Error('Select at least one county');
  const count = Math.min(Math.max(1, Math.floor(limit)), LIMITS.maxParcels);
  let where = `cntyname IN (${counties.map(sqlString).join(',')}) AND gisacres >= ${Number(minAcres) || 0}`;
  if (Number(maxAcres) > 0) where += ` AND gisacres <= ${Number(maxAcres)}`;
  return queryParcels({ where, orderByFields: 'gisacres DESC', resultRecordCount: String(count) }, signal);
}

// Largest voltage in an OSM voltage tag such as "230000;115000", in kV.
function parseMaxKv(voltageTag) {
  if (!voltageTag) return null;
  const volts = String(voltageTag)
    .split(/[;,]/)
    .map((v) => parseFloat(v))
    .filter((v) => Number.isFinite(v));
  return volts.length ? Math.max(...volts) / 1000 : null;
}

// OSM power=substation features inside the given bboxes ([minLon, minLat, maxLon, maxLat]).
export async function fetchSubstations(bboxes, { signal } = {}) {
  const serverTimeout = Math.floor(LIMITS.overpassTimeoutMs / 1000) - 5;
  const clauses = bboxes
    .map(([w, s, e, n]) => `nwr["power"="substation"](${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)});`)
    .join('');
  const query = `[out:json][timeout:${serverTimeout}];(${clauses});out center tags;`;

  const { data, meta } = await fetchJson('Overpass (OSM substations)', ENDPOINTS.overpass, {
    method: 'POST',
    body: new URLSearchParams({ data: query }),
    timeoutMs: LIMITS.overpassTimeoutMs,
    sourceUrl: UPSTREAM.overpass,
    signal,
  });
  if (!Array.isArray(data?.elements)) throw new Error('Overpass returned no element list');
  // Overpass reports server-side timeouts as a "remark" on a 200 response.
  if (data.remark && /error|timed out|runtime/i.test(data.remark)) {
    throw new Error(`Overpass query incomplete: ${data.remark}`);
  }
  return { features: overpassToFeatures(data.elements), meta: { ...meta, osmTimestamp: data.osm3s?.timestamp_osm_base ?? null } };
}

// OSM elements from `out center tags` -> GeoJSON points. Shared with the cached snapshot.
export function overpassToFeatures(elements) {
  return elements
    .map((elem) => {
      const lat = elem.lat ?? elem.center?.lat;
      const lon = elem.lon ?? elem.center?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const tags = elem.tags || {};
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          osmId: `${elem.type}/${elem.id}`,
          // Missing tags stay null; no name or voltage is assumed.
          name: tags.name || null,
          maxKv: parseMaxKv(tags.voltage),
          voltageTag: tags.voltage || null,
          substationType: tags.substation || null,
          operator: tags.operator || null,
        },
      };
    })
    .filter(Boolean);
}

// Shared ArcGIS envelope query returning GeoJSON in WGS84.
async function queryEnvelope(service, url, bbox, { where = '1=1', outFields, signal, simplify = LIMITS.zoneSimplifyDegrees, retries = 1, upstream = url }) {
  const params = new URLSearchParams({
    where,
    geometry: bbox.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    maxAllowableOffset: String(simplify),
    resultRecordCount: String(LIMITS.maxZoneFeatures),
    f: 'geojson',
  });
  const { data, meta } = await fetchJson(service, `${url}?${params}`, {
    timeoutMs: LIMITS.overlayTimeoutMs,
    signal,
    retries,
    sourceUrl: `${upstream}?${params}`,
  });
  if (!Array.isArray(data?.features)) throw new Error(`${service} returned no feature list`);
  return {
    features: data.features.filter((f) => f.geometry),
    // More zones exist than were returned, so any overlap computed from them is a lower bound.
    truncated: Boolean(data.exceededTransferLimit || data.properties?.exceededTransferLimit),
    meta,
  };
}

// FEMA NFHL Special Flood Hazard Areas (SFHA_TF = 'T': zones A, AE, AH, AO, AR, A99, V, VE).
export function fetchFEMAFloodZones(bbox, { signal } = {}) {
  return queryEnvelope('FEMA NFHL Flood Hazard Zones', ENDPOINTS.femaFlood, bbox, {
    where: "SFHA_TF = 'T'",
    outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF',
    signal,
  });
}

// USGS PAD-US protected areas (all GAP status codes 1-4).
export function fetchProtectedAreas(bbox, { signal } = {}) {
  return queryEnvelope('USGS PAD-US', ENDPOINTS.padus, bbox, {
    outFields: 'Unit_Nm,GAP_Sts,Category,MngNm_Desc,DesTp_Desc',
    signal,
    // ~30 m generalization and extra retries: ArcGIS Online throttles large geometry responses.
    simplify: 0.0003,
    retries: 3,
  });
}

// USFWS NWI mapped wetlands and deepwater habitats (Cowardin ATTRIBUTE code + WETLAND_TYPE).
export function fetchWetlands(bbox, { signal } = {}) {
  return queryEnvelope('USFWS National Wetlands Inventory', ENDPOINTS.nwi, bbox, {
    outFields: 'ATTRIBUTE,WETLAND_TYPE',
    signal,
    simplify: 0.00005,
    upstream: UPSTREAM.nwi,
  });
}

// One point elevation in feet. EPQS returns -1000000 where it has no data.
async function fetchElevation([lon, lat], signal) {
  const params = new URLSearchParams({ x: lon.toFixed(6), y: lat.toFixed(6), wkid: '4326', units: 'Feet', includeDate: 'false' });
  const { data, meta } = await fetchJson('USGS EPQS', `${ENDPOINTS.epqs}?${params}`, {
    timeoutMs: LIMITS.elevationTimeoutMs,
    signal,
  });
  const value = parseFloat(data?.value);
  if (!Number.isFinite(value) || value <= -1000000) throw new Error('USGS EPQS has no elevation at this point');
  return { feet: value, meta };
}

// Elevations (feet) for many [lon, lat] points with bounded concurrency.
// Never throws: each point gets { feet } or { error }.
export async function fetchElevations(points, { signal, concurrency = LIMITS.elevationConcurrency } = {}) {
  const results = new Array(points.length);
  let next = 0;
  const worker = async () => {
    while (next < points.length && !signal?.aborted) {
      const i = next++;
      try {
        results[i] = await fetchElevation(points[i], signal);
      } catch (err) {
        results[i] = { error: err.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, points.length) }, worker));
  for (let i = 0; i < results.length; i++) results[i] ??= { error: 'USGS EPQS request cancelled' };
  return results;
}
