import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // overpass-api.de answers HTTP 406 to many browser User-Agents, and page
      // code cannot override User-Agent, so dev requests go through here.
      '/api/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: () => '/api/interpreter',
        headers: { 'User-Agent': 'SunGridSiteProspector/0.1 (Method hackathon prototype)' },
      },
      // USFWS NWI answers HTTP 500 (with no CORS headers) to some browser
      // User-Agents, e.g. headless Chrome; an identifying User-Agent works.
      '/api/nwi': {
        target: 'https://fwspublicservices.wim.usgs.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nwi/, '/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query'),
        headers: { 'User-Agent': 'SunGridSiteProspector/0.1 (Method hackathon prototype)' },
      },
    },
  },
});
