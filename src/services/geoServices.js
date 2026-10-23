/** SunGrid Renewables - GIS API integration service. */
async function fetchNCOneMapParcels(
  counties = ["Wake", "Johnston", "Mecklenburg"],
  minAcres = 500,
  maxAcres = 700
) {
  const formattedCounties = counties.map((county) => `'${county}'`).join(",");
  const whereClause =
    `county_name IN (${formattedCounties}) AND ` +
    `gis_acres >= ${minAcres} AND gis_acres <= ${maxAcres}`;
  const endpoint = "https://services.nconemap.gov/secure/rest/services/NC1Map parcels/MapServer/0/query";
  const params = new URLSearchParams({
    where: whereClause,
    outFields: "parno,ownname,county_name,gis_acres,landval,parval,mailadd,siteadd",
    f: "geojson",
    outSR: "4326",
  });

  try {
    const response = await fetch(`${endpoint}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`NC OneMap fetch error: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching NC OneMap parcels:", error);
    return null;
  }
}

async function fetchSubstations(bbox = [35.0, -81.0, 36.1, -78.0]) {
  const overpassUrl = "https://overpass-api.de/api/interpreter";
  const query = `[out:json];(node["power"="substation"](${bbox.join(",")});way["power"="substation"](${bbox.join(",")}););out center;`;

  try {
    const response = await fetch(overpassUrl, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) {
      throw new Error(`Overpass fetch error: ${response.statusText}`);
    }
    const data = await response.json();
    const features = data.elements
      .map((element) => {
        const lat = element.lat || element.center?.lat;
        const lon = element.lon || element.center?.lon;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: {
            id: element.id,
            name: element.tags?.name || "High Voltage Substation",
          },
        };
      })
      .filter((feature) => feature.geometry.coordinates.every(Boolean));
    return { type: "FeatureCollection", features };
  } catch (error) {
    console.error("Error fetching substations:", error);
    return { type: "FeatureCollection", features: [] };
  }
}

async function fetchFEMAFloodZones(bboxExtent) {
  const femaUrl =
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL queriable features/MapServer/28/query";
  const params = new URLSearchParams({
    where: "FLD_ZONE IN ('A', 'AE', 'AH', 'AO', 'VE', 'V')",
    geometry: bboxExtent.join(","),
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    f: "geojson",
    outSR: "4326",
  });

  try {
    const response = await fetch(`${femaUrl}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`FEMA fetch error: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching FEMA flood zones:", error);
    return { type: "FeatureCollection", features: [] };
  }
}
