import React from 'react';
import { createRoot } from 'react-dom/client';
import SolarSiteProspector from './components/SolarSiteProspector';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SolarSiteProspector />
  </React.StrictMode>
);
