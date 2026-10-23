import * as turf from '@turf/turf';
import { normalizeParcels } from '../src/services/turfSpatialAnalysis';

// ~0.036° x 0.03° box near Raleigh (~2,900 ac). gisacres matches the polygon.
export const PARCEL_BOX = [-78.7, 35.7, -78.66, 35.73];

export function makeParcel(box = PARCEL_BOX) {
  const geometry = turf.bboxPolygon(box).geometry;
  const acres = turf.area(geometry) / 4046.8564224;
  return normalizeParcels([{ type: 'Feature', properties: { objectid: 1, parno: 'T1', cntyname: 'Wake', gisacres: acres }, geometry }])[0];
}

export const zone = (box, properties = {}) => turf.feature(turf.bboxPolygon(box).geometry, properties);

export const complete = (extra) => ({ state: 'complete', finding: 'favorable', ...extra });

// A fully favorable set of complete checks for scoring tests.
export function favorableChecks(parcel) {
  return {
    slope: complete({ metrics: { steepShare: 0 } }),
    wetlands: complete({ metrics: { overlapPct: 0 }, pieces: [] }),
    grid: complete({ metrics: { nearest: { miles: 1, recordedKv: 230 }, nearestHv: { miles: 1, recordedKv: 230 } } }),
    flood: complete({ metrics: { overlapPct: 0 }, pieces: [] }),
    protectedLand: complete({ metrics: { overlapPct: 0 }, pieces: [] }),
    buildable: complete({ acres: parcel.polygonAcres, share: 1 }),
  };
}
