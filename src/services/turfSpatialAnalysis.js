/** SunGrid Renewables - Turf.js client-side spatial engine. */
function runSiteFilterPipeline(
  parcelsGeoJSON,
  substationsGeoJSON,
  floodZonesGeoJSON,
  options = {}
) {
  const {
    maxSubstationMiles = 3.0,
    minBuildableAcres = 500.0,
  } = options;
  if (!parcelsGeoJSON?.features || !window.turf) {
    return [];
  }

  let substationBufferPolygon = null;
  if (substationsGeoJSON?.features?.length > 0) {
    const bufferedSubstations = turf.buffer(
      substationsGeoJSON,
      maxSubstationMiles,
      { units: "miles" }
    );
    substationBufferPolygon = turf.combine(bufferedSubstations);
  }

  const qualifiedSites = [];
  parcelsGeoJSON.features.forEach((parcel) => {
    if (
      substationBufferPolygon &&
      !turf.booleanIntersects(parcel, substationBufferPolygon)
    ) {
      return;
    }

    let cleanParcelGeometry = parcel.geometry;
    floodZonesGeoJSON?.features?.forEach((floodArea) => {
      if (turf.booleanIntersects(cleanParcelGeometry, floodArea)) {
        try {
          const difference = turf.difference(
            turf.feature(cleanParcelGeometry),
            floodArea
          );
          if (difference) {
            cleanParcelGeometry = difference.geometry;
          }
        } catch (error) {
          console.warn("Unable to subtract a flood zone from a parcel.", error);
        }
      }
    });

    const buildableAcres = turf.area(cleanParcelGeometry) / 4046.86;
    if (buildableAcres >= minBuildableAcres) {
      const properties = parcel.properties || {};
      qualifiedSites.push({
        id: properties.parno || crypto.randomUUID(),
        parcelNumber: properties.parno,
        owner: properties.ownname || "N/A",
        county: properties.county_name,
        grossAcres: Number(properties.gis_acres || 0),
        netBuildableAcres: Number(buildableAcres.toFixed(2)),
        landValuation: properties.landval
          ? `$${Number(properties.landval).toLocaleString()}`
          : "N/A",
        geometry: cleanParcelGeometry,
      });
    }
  });

  return qualifiedSites;
}
