const { useCallback, useState } = React;

function SolarSiteProspector() {
  const [selectedCounties, setSelectedCounties] = useState([
    "Wake",
    "Johnston",
    "Mecklenburg",
  ]);
  const [minAcres, setMinAcres] = useState(100);
  const [maxAcres, setMaxAcres] = useState(5000);
  const [substationDistance, setSubstationDistance] = useState(3);
  const [enableFloodScrub, setEnableFloodScrub] = useState(true);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Ready for Prospecting");
  const [candidateSites, setCandidateSites] = useState([]);

  const handleCountyToggle = (county) => {
    setSelectedCounties((previous) =>
      previous.includes(county)
        ? previous.filter((item) => item !== county)
        : [...previous, county]
    );
  };

  const executeProspectingPipeline = useCallback(async () => {
    if (selectedCounties.length === 0) {
      window.alert("Please select at least one NC county.");
      return;
    }

    setLoading(true);
    setStatusMsg("1/3 Querying NC OneMap Parcel REST Service...");
    if (minAcres > maxAcres) {
      setStatusMsg("Minimum acreage cannot be greater than maximum acreage.");
      setLoading(false);
      return;
    }
    let parcelGeoJSON;
    try {
      parcelGeoJSON = await fetchNCOneMapParcels(
        selectedCounties,
        minAcres,
        maxAcres
      );
    } catch (error) {
      setStatusMsg(`Parcel search failed: ${error.message}`);
      setLoading(false);
      return;
    }
    if (!parcelGeoJSON?.features) {
      setStatusMsg("NC OneMap returned an invalid parcel response.");
      setLoading(false);
      return;
    }

    setStatusMsg(
      `2/3 Ingested ${parcelGeoJSON.features.length} candidate parcels. Fetching layers...`
    );
    const [substationsGeoJSON, floodGeoJSON] = await Promise.all([
      fetchSubstations(),
      enableFloodScrub
        ? fetchFEMAFloodZones([-81.1, 35.0, -78.2, 36.2])
        : Promise.resolve(null),
    ]);
    setStatusMsg("3/3 Executing spatial filtering in Turf.js...");
    const filteredResults = runSiteFilterPipeline(
      parcelGeoJSON,
      substationsGeoJSON,
      floodGeoJSON,
      {
        maxSubstationMiles: Number(substationDistance),
        minBuildableAcres: Number(minAcres),
      }
    );
    setCandidateSites(filteredResults);
    setStatusMsg(
      `Prospecting Complete: ${filteredResults.length} Qualified Utility-Scale PV Sites Identified.`
    );
    setLoading(false);
  }, [
    selectedCounties,
    minAcres,
    maxAcres,
    substationDistance,
    enableFloodScrub,
  ]);

  const capacity = (
    candidateSites.reduce((total, site) => total + site.netBuildableAcres, 0) /
    7.5
  ).toFixed(1);

  return (
    <div className="prospector-container">
      <header className="brand-header">
        <h1>SunGrid Renewables - Site Prospecting Workbench</h1>
        <span className="engineer-badge">Lead Solar Development Engineer</span>
      </header>
      <div className="dashboard-layout">
        <aside className="filter-sidebar">
          <h2>Site Filtering Criteria</h2>
          <div className="filter-group">
            <span className="group-label">Counties</span>
            {["Johnston", "Wake", "Mecklenburg"].map((county) => (
              <label className="checkbox-label" key={county}>
                <input
                  type="checkbox"
                  checked={selectedCounties.includes(county)}
                  onChange={() => handleCountyToggle(county)}
                />{" "}
                {county}
              </label>
            ))}
          </div>
          <div className="filter-group">
            <span className="group-label">Acreage Range</span>
            <div className="range-inputs">
              <input
                type="number"
                value={minAcres}
                min="1"
                max="50000"
                onChange={(event) => setMinAcres(Number(event.target.value))}
              />
              <span>to</span>
              <input
                type="number"
                value={maxAcres}
                min="1"
                max="50000"
                onChange={(event) => setMaxAcres(Number(event.target.value))}
              />
            </div>
          </div>
          <div className="filter-group">
            <label className="group-label" htmlFor="substation-distance">
              Substation distance (miles)
            </label>
            <input
              id="substation-distance"
              type="number"
              value={substationDistance}
              min="0.5"
              step="0.5"
              onChange={(event) => setSubstationDistance(event.target.value)}
            />
          </div>
          <div className="filter-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={enableFloodScrub}
                onChange={(event) => setEnableFloodScrub(event.target.checked)}
              />{" "}
              Exclude FEMA flood zones
            </label>
          </div>
          <button
            className="execute-btn"
            type="button"
            disabled={loading}
            onClick={executeProspectingPipeline}
          >
            {loading ? "Running..." : "Run Prospecting Search"}
          </button>
        </aside>
        <main className="results-panel">
          <div className="status-bar">{statusMsg}</div>
          <div className="summary-cards">
            <div className="card">
              <h3>Qualified Sites</h3>
              <p className="metric">{candidateSites.length}</p>
            </div>
            <div className="card">
              <h3>Total Potential Capacity</h3>
              <p className="metric">{capacity} MW</p>
            </div>
          </div>
          <div className="table-wrapper">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Parcel ID</th>
                  <th>County</th>
                  <th>Owner Name</th>
                  <th>Gross Acres</th>
                  <th>Buildable Acres</th>
                  <th>Land Valuation</th>
                </tr>
              </thead>
              <tbody>
                {candidateSites.length === 0 ? (
                  <tr>
                    <td className="no-data" colSpan="6">
                      No active prospecting search run yet.
                    </td>
                  </tr>
                ) : (
                  candidateSites.map((site) => (
                    <tr key={site.id}>
                      <td><code>{site.parcelNumber}</code></td>
                      <td>{site.county}</td>
                      <td>{site.owner}</td>
                      <td>{site.grossAcres} ac</td>
                      <td>{site.netBuildableAcres} ac</td>
                      <td>{site.landValuation}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <SolarSiteProspector />
);
