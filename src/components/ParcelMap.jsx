import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SLOPE_LIMIT_PERCENT } from '../services/turfSpatialAnalysis';

const NC_CENTER = [35.6, -79.4];

export const LAYER_STYLES = {
  candidate: { color: '#f5b335', weight: 1.5, fillOpacity: 0.06, dashArray: '4 3' },
  selected: { color: '#f5b335', weight: 3.5, fillOpacity: 0.1 },
  wetlands: { color: '#2dd4bf', weight: 1, fillColor: '#14b8a6', fillOpacity: 0.45 },
  flood: { color: '#60a5fa', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.35 },
  protectedLand: { color: '#c084fc', weight: 1, fillColor: '#a855f7', fillOpacity: 0.3 },
};

const slopeColor = (pct) => (pct == null ? '#94a3b8' : pct > SLOPE_LIMIT_PERCENT ? '#f97316' : '#4ade80');

function addLegend(map) {
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div><span class="swatch" style="border:2px solid #f5b335"></span>Selected parcel</div>
      <div><span class="swatch" style="background:#14b8a6"></span>NWI mapped wetlands</div>
      <div><span class="swatch" style="background:#3b82f6"></span>FEMA flood hazard</div>
      <div><span class="swatch" style="background:#a855f7"></span>PAD-US protected</div>
      <div><span class="dot" style="background:#4ade80"></span>Slope ≤ ${SLOPE_LIMIT_PERCENT}% <span class="dot" style="background:#f97316"></span>&gt; ${SLOPE_LIMIT_PERCENT}% <span class="dot" style="background:#94a3b8"></span>not estimated</div>
      <div><span class="line"></span>Straight line to substation (not a route)</div>`;
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  legend.addTo(map);
}

export default function ParcelMap({ candidates, selectedId, assessment, pickedPoint, onSelect, onMapClick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const handlersRef = useRef({ onSelect, onMapClick });
  handlersRef.current = { onSelect, onMapClick };
  const fittedRef = useRef(null);

  useEffect(() => {
    const map = L.map(containerRef.current, { center: NC_CENTER, zoom: 7, zoomControl: true, preferCanvas: false });
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    });
    imagery.addTo(map);
    const candidatesLayer = L.featureGroup().addTo(map);
    const constraints = {
      wetlands: L.featureGroup().addTo(map),
      flood: L.featureGroup().addTo(map),
      protectedLand: L.featureGroup().addTo(map),
    };
    const slopeLayer = L.featureGroup().addTo(map);
    const gridLayer = L.featureGroup().addTo(map);
    const pointLayer = L.featureGroup().addTo(map);
    L.control
      .layers(
        { Imagery: imagery, Streets: streets },
        {
          'NWI wetlands': constraints.wetlands,
          'FEMA flood hazard': constraints.flood,
          'PAD-US protected': constraints.protectedLand,
          'Slope samples': slopeLayer,
          Substations: gridLayer,
        },
        { collapsed: true }
      )
      .addTo(map);
    L.control.scale({ imperial: true, metric: false }).addTo(map);
    addLegend(map);
    map.on('click', (e) => handlersRef.current.onMapClick?.(e.latlng));
    layersRef.current = { candidatesLayer, constraints, slopeLayer, gridLayer, pointLayer };
    mapRef.current = map;
    // Leaflet measures its container once; re-measure when the layout changes.
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current);
    return () => {
      resize.disconnect();
      map.remove();
    };
  }, []);

  // Candidate and selected parcel outlines.
  useEffect(() => {
    const { candidatesLayer } = layersRef.current;
    candidatesLayer.clearLayers();
    let selectedLayer = null;
    for (const parcel of candidates) {
      const selected = parcel.id === selectedId;
      const layer = L.geoJSON(parcel.geometry, { style: selected ? LAYER_STYLES.selected : LAYER_STYLES.candidate });
      layer.bindTooltip(`${parcel.parcelNumber || 'Parcel'} · ${parcel.polygonAcres.toLocaleString(undefined, { maximumFractionDigits: 0 })} ac`, { sticky: true });
      layer.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        handlersRef.current.onSelect?.(parcel.id);
      });
      layer.addTo(candidatesLayer);
      if (selected) selectedLayer = layer;
    }
    if (selectedLayer) {
      selectedLayer.bringToFront();
      if (fittedRef.current !== selectedId) {
        mapRef.current.fitBounds(selectedLayer.getBounds(), { padding: [40, 40], maxZoom: 16 });
        fittedRef.current = selectedId;
      }
    } else if (candidates.length && fittedRef.current !== `all:${candidates.length}`) {
      mapRef.current.fitBounds(candidatesLayer.getBounds(), { padding: [30, 30], maxZoom: 15 });
      fittedRef.current = `all:${candidates.length}`;
    }
  }, [candidates, selectedId]);

  // Constraint overlays, slope samples and substations for the current assessment.
  useEffect(() => {
    const { constraints, slopeLayer, gridLayer } = layersRef.current;
    Object.values(constraints).forEach((g) => g.clearLayers());
    slopeLayer.clearLayers();
    gridLayer.clearLayers();
    if (!assessment || assessment.parcel.id !== selectedId) return;
    const { checks } = assessment;

    for (const key of ['wetlands', 'flood', 'protectedLand']) {
      for (const piece of checks[key]?.pieces || []) {
        L.geoJSON(piece, { style: LAYER_STYLES[key], interactive: true })
          .bindTooltip(piece.properties?.name || key, { sticky: true })
          .addTo(constraints[key]);
      }
    }
    for (const s of checks.slope?.samples || []) {
      L.circleMarker([s.lat, s.lon], { radius: 4, weight: 1, color: '#0b1220', fillColor: slopeColor(s.slopePct), fillOpacity: 0.95 })
        .bindTooltip(s.slopePct == null ? `Elevation ${s.elevationFt?.toFixed(0) ?? '—'} ft · slope not estimated` : `${s.slopePct.toFixed(1)}% slope · ${s.elevationFt.toFixed(0)} ft`)
        .addTo(slopeLayer);
    }
    const g = checks.grid?.metrics;
    const shown = new Set();
    for (const sub of [g?.nearestHv, g?.nearest].filter(Boolean)) {
      if (shown.has(sub.osmId)) continue;
      shown.add(sub.osmId);
      const [lon, lat] = sub.coordinates;
      L.marker([lat, lon], {
        icon: L.divIcon({ className: 'substation-icon', html: '⚡', iconSize: [22, 22], iconAnchor: [11, 11] }),
      })
        .bindTooltip(`${sub.name || 'Unnamed substation'} · ${sub.recordedKv != null ? `${sub.recordedKv} kV recorded` : 'voltage not recorded'} · ${sub.miles.toFixed(1)} mi straight-line`)
        .addTo(gridLayer);
    }
    const target = g?.nearestHv || g?.nearest;
    if (target && target.miles > 0) {
      const [lon, lat] = target.coordinates;
      const nearestOnParcel = nearestVertex(assessment.parcel.geometry, [lon, lat]);
      L.polyline([[nearestOnParcel[1], nearestOnParcel[0]], [lat, lon]], { color: '#f5b335', weight: 2, dashArray: '6 6' })
        .bindTooltip(`${target.miles.toFixed(1)} mi straight-line (not a route)`, { sticky: true })
        .addTo(gridLayer);
    }
  }, [assessment, selectedId]);

  // Coordinate the user entered or clicked.
  useEffect(() => {
    const { pointLayer } = layersRef.current;
    pointLayer.clearLayers();
    if (pickedPoint) {
      L.circleMarker([pickedPoint.lat, pickedPoint.lon], { radius: 6, color: '#0b1220', weight: 2, fillColor: '#f5b335', fillOpacity: 1 }).addTo(pointLayer);
      if (!selectedId) mapRef.current.setView([pickedPoint.lat, pickedPoint.lon], Math.max(mapRef.current.getZoom(), 14));
    }
  }, [pickedPoint, selectedId]);

  return <div ref={containerRef} className="parcel-map" role="region" aria-label="Parcel map" />;
}

// Closest boundary vertex to a point (for drawing the straight-line indicator).
function nearestVertex(geometry, [lon, lat]) {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  let best = rings[0][0];
  let bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const ring of rings) {
    for (const [x, y] of ring) {
      const d = ((x - lon) * k) ** 2 + (y - lat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  }
  return best;
}
