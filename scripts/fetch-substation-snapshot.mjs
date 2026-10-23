// Refresh the cached OSM substation snapshot used when live Overpass fails.
//   node scripts/fetch-substation-snapshot.mjs            # query Overpass
//   node scripts/fetch-substation-snapshot.mjs raw.json   # convert a saved Overpass response
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { overpassToFeatures } from '../src/services/geoServices.js';

// [minLon, minLat, maxLon, maxLat]: Wake + Johnston, and Mecklenburg, each padded
// ~15 mi so large parcels' substation search areas stay inside the snapshot.
const EXTENTS = [
  [-79.3, 34.95, -77.7, 36.35],
  [-81.35, 34.8, -80.35, 35.75],
];
const OUT = new URL('../src/data/substations-snapshot.json', import.meta.url);

async function fetchRaw() {
  const clauses = EXTENTS.map(([w, s, e, n]) => `nwr["power"="substation"](${s},${w},${n},${e});`).join('');
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': 'SunGridSiteProspector/0.1 (Method hackathon prototype)' },
    body: new URLSearchParams({ data: `[out:json][timeout:170];(${clauses});out center tags;` }),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
}

const raw = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : await fetchRaw();
if (!Array.isArray(raw.elements) || raw.elements.length === 0 || raw.remark) {
  throw new Error(`Unusable Overpass response: ${raw.remark || 'no elements'}`);
}
const features = overpassToFeatures(raw.elements);
await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({
    source: 'OpenStreetMap contributors via Overpass API (ODbL)',
    osmTimestamp: raw.osm3s?.timestamp_osm_base ?? null,
    extents: EXTENTS,
    features,
  })
);
console.log(`Wrote ${features.length} substations (OSM data as of ${raw.osm3s?.timestamp_osm_base}) to ${OUT.pathname}`);
