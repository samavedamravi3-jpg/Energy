# Energy

SunGrid Renewables single-parcel solar screening prototype (Method hackathon).
React + Vite + Leaflet + Turf.js, calling public GIS services from the browser.

## Run

```sh
npm install
npm run dev     # http://localhost:5173/
npm test        # vitest: scoring, geometry, slope units, cost math, fetch fallbacks, orchestration
npm run build
```

## Workflow

1. **Find a parcel**: coordinates, NC parcel number (PIN), browse the largest parcels in a county, or click the map.
2. The NC OneMap boundary is drawn and the assessment starts automatically (map and table selection stay in sync).
3. **Assess**: slope, mapped wetlands, grid proximity, FEMA flood hazard and PAD-US protected land run concurrently,
   capped at 55 s total; anything unfinished is marked *Failed*, never left pending.
4. **Understand**: per-check state (Pending / Complete / Incomplete / Failed), finding, limitations and sources;
   a 0–100 score with every component shown, and data completeness reported separately.
5. **Save / export**: saved assessments live in this browser's localStorage and reopen without re-querying.
   *Print briefing* produces a one-page-plus brief (map sketch, findings, score, unresolved checks, cost scenario, sources).
   *Export JSON* downloads the full record.

## Data sources

| Check | Service | Notes |
| --- | --- | --- |
| Parcel | NC OneMap `NC1Map_Parcels/FeatureServer/1` | Point, PIN or county query; capped at 25 |
| Slope | USGS EPQS `epqs.nationalmap.gov/v1/json` | ~48 points on a regular grid inside the parcel, 10 concurrent |
| Wetlands | USFWS NWI `Wetlands/MapServer/0` | Dev proxy `/api/nwi` (NWI returns HTTP 500 without CORS headers to some browser User-Agents) |
| Grid | OSM `power=substation` via Overpass | Dev proxy `/api/overpass` (HTTP 406 to browser User-Agents). Falls back to `src/data/substations-snapshot.json`; refresh with `node scripts/fetch-substation-snapshot.mjs` |
| Flood | FEMA NFHL `MapServer/28`, `SFHA_TF = 'T'` | |
| Protected land | USGS PAD-US Protection Status by GAP Status Code | All GAP codes 1–4 |

Every result records its source URL, retrieval time and cache status: *Live*, *Cached (this session)*,
*Stored copy — live request failed* (last good response in localStorage) or *Bundled snapshot — live request failed*.
A failed, partial or truncated response is **Unknown**, never a pass.

The two dev proxies exist only in `npm run dev`. A deployed build needs an equivalent server-side proxy for Overpass and NWI.

## Screening rules

Client-supplied (meeting notes / brief): slope over 5% is very challenging; ~3 mi to a high-voltage substation is a good
indicator (a preference, not a cut-off); 500–700 ac of buildable area is the target for a **combined site**, not a
per-parcel minimum; designated wetlands and protected land cannot be built on.

- **Slope**: finite differences between neighbouring EPQS elevations (feet over feet, so a true percent grade).
  Some steep ground is a *Flag*; ≥ 40% of samples above 5% is *Unfavorable* (provisional).
- **Wetlands**: NWI polygons clipped to the parcel. A mapped overlap is a screening finding, not a jurisdictional determination.
- **Grid**: straight-line distance from the parcel boundary to the nearest OSM substation, with the voltage as recorded in OSM.
  No capacity is inferred; "voltage not recorded" substations are never called high voltage.
- **Buildable area**: parcel minus wetlands ∪ flood hazard ∪ protected land. A fully excluded parcel has 0 ac.

## Score (0–100)

| Component | Weight | Points |
| --- | --- | --- |
| Terrain slope | 30 | weight × share of samples ≤ 5% |
| Mapped wetlands | 20 | weight × (1 − share of parcel mapped) |
| Grid proximity | 25 | full ≤ 3 mi to ≥ 115 kV recorded, linear to 0 at 8 mi; × 0.5 without a recorded ≥ 115 kV substation |
| Buildable area toward site target | 15 | weight × min(1, buildable ac ÷ 500) |
| FEMA flood hazard | 5 | weight × (1 − share in SFHA) |
| Protected land | 5 | weight × (1 − share in PAD-US) |

All weights, curves and bands (≥ 75 strong, 50–74 mixed, < 50 weak) are **provisional** and need calibration with SunGrid.
The total is shown only when all six components are complete; otherwise the panel shows "Incomplete assessment" with the
assessed components' points. Less than 5% of the parcel left after exclusions is reported as a fatal flaw.
The score is a screening aid, not a construction, permitting, wetland or interconnection approval.

## Cost scenario

User-entered assumptions only; no rates are built in and blank inputs are missing, not zero. Upfront lines
(land purchase, construction = MW × $/MW, connection line = miles × $/mile) sum to a subtotal only when all are complete.
Annual lease cost is shown separately. Suggested values (parcel acres, capacity from buildable acres ÷ 7.5 ac/MW,
straight-line distance) are offered as buttons and labeled; straight-line distance is not a line route.
