const { useState, useEffect, useRef, useCallback } = React;

// Region coordinates for deployment visualization
// Covers both map-specific regions and deployment-system regions
const REGION_COORDINATES = {
  'Western Europe': { lat: 48.8, lng: 2.3, name: 'Western Europe' },
  'Eastern Europe': { lat: 52.2, lng: 21.0, name: 'Eastern Europe' },
  'Middle East': { lat: 31.5, lng: 34.8, name: 'Middle East' },
  'North Africa': { lat: 28.0, lng: 3.0, name: 'North Africa' },
  'Sub-Saharan Africa': { lat: -2.0, lng: 23.0, name: 'Sub-Saharan Africa' },
  'Africa': { lat: 5.0, lng: 20.0, name: 'Africa' },
  'South Asia': { lat: 20.5, lng: 78.9, name: 'South Asia' },
  'East Asia': { lat: 35.8, lng: 104.1, name: 'East Asia' },
  'Southeast Asia': { lat: 12.8, lng: 108.0, name: 'Southeast Asia' },
  'Central Asia': { lat: 42.0, lng: 65.0, name: 'Central Asia' },
  'Pacific Islands': { lat: -5.0, lng: 152.0, name: 'Pacific Islands' },
  'Pacific Ocean': { lat: 5.0, lng: -170.0, name: 'Pacific Ocean' },
  'Atlantic Ocean': { lat: 30.0, lng: -40.0, name: 'Atlantic Ocean' },
  'Indian Ocean': { lat: -15.0, lng: 75.0, name: 'Indian Ocean' },
  'Mediterranean': { lat: 36.0, lng: 18.0, name: 'Mediterranean' },
  'North America': { lat: 40.0, lng: -100.0, name: 'North America' },
  'Central America': { lat: 15.0, lng: -90.0, name: 'Central America' },
  'South America': { lat: -15.0, lng: -60.0, name: 'South America' },
  'Latin America': { lat: -10.0, lng: -65.0, name: 'Latin America' },
  'Caribbean': { lat: 18.0, lng: -75.0, name: 'Caribbean' },
  'Arctic': { lat: 75.0, lng: 0.0, name: 'Arctic' },
  'Antarctic': { lat: -75.0, lng: 0.0, name: 'Antarctic' },
  'Korea': { lat: 37.5, lng: 127.0, name: 'Korean Peninsula' },
  'Indochina': { lat: 16.0, lng: 108.0, name: 'Indochina' },
  'Germany': { lat: 51.0, lng: 10.0, name: 'Germany' },
  'Japan': { lat: 36.0, lng: 138.0, name: 'Japan' },
  'Suez Canal': { lat: 30.5, lng: 32.3, name: 'Suez Canal Zone' },
  'Berlin': { lat: 52.5, lng: 13.4, name: 'Berlin' },
  // Deployment regions that were missing:
  'Greece & Turkey': { lat: 39.0, lng: 27.0, name: 'Greece & Turkey' },
  'Iran': { lat: 32.4, lng: 53.7, name: 'Iran' },
  'Taiwan': { lat: 23.7, lng: 121.0, name: 'Taiwan' },
  'India': { lat: 22.0, lng: 78.9, name: 'India' },
  'Pakistan': { lat: 30.4, lng: 69.3, name: 'Pakistan' }
};

const COUNTRY_COLORS = {
  USA: '#3b82f6', UK: '#ef4444', USSR: '#a855f7',
  France: '#f59e0b', China: '#22c55e', India: '#f97316', Argentina: '#06b6d4'
};

// Military Map Component using Leaflet.js
function MilitaryMap({ currentYear, gameState, playerCountry, socket, roomId, playerId }) {
  const [militaryData, setMilitaryData] = useState(null);
  const [selectedBase, setSelectedBase] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const deploymentMarkersRef = useRef([]);
  const conflictLayersRef = useRef([]);
  const battleAnimLayersRef = useRef([]);

  useEffect(() => {
    fetch('/military-deployments.json')
      .then(r => r.json())
      .then(data => setMilitaryData(data.militaryDeployments));
  }, []);

  // Initialize Leaflet map
  useEffect(() => {
    if (!militaryData || !mapRef.current || leafletMapRef.current) return;

    const map = L.map(mapRef.current, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 8,
      worldCopyJump: true,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      noWrap: false
    }).addTo(map);

    leafletMapRef.current = map;

    // Add markers for each military base
    Object.entries(militaryData).forEach(([country, data]) => {
      data.bases.forEach(base => {
        const color = COUNTRY_COLORS[country] || '#64748b';
        const size = base.troops > 1000000 ? 20 :
                    base.troops > 500000 ? 16 :
                    base.troops > 100000 ? 12 :
                    base.troops > 50000 ? 9 : 6;

        const icon = L.divIcon({
          html: `
            <div style="
              width: ${size * 2}px;
              height: ${size * 2}px;
              background: ${color};
              border: 3px solid white;
              border-radius: 50%;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3), 0 0 0 ${size}px ${color}33;
              position: relative;
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              ${base.troops > 100000 ? `<div style="
                position: absolute;
                top: ${size * 2 + 4}px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 10px;
                font-weight: bold;
                white-space: nowrap;
              ">${(base.troops / 1000).toFixed(0)}K</div>` : ''}
            </div>
          `,
          className: '',
          iconSize: [size * 2, size * 2],
          iconAnchor: [size, size]
        });

        L.marker([base.lat, base.lng], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="min-width: 200px;">
              <h3 style="margin: 0 0 8px 0; color: ${color}; font-size: 1.1rem;">
                ${base.name}
              </h3>
              <div style="font-size: 0.9rem; line-height: 1.6;">
                <p style="margin: 4px 0;"><strong>Country:</strong> ${country}</p>
                <p style="margin: 4px 0;"><strong>Region:</strong> ${base.region}</p>
                <p style="margin: 4px 0;"><strong>Personnel:</strong> ${base.troops.toLocaleString()} troops</p>
                <p style="margin: 4px 0;"><strong>Type:</strong> ${base.type.replace(/_/g, ' ')}</p>
                <p style="margin: 8px 0 0 0; font-style: italic; color: #64748b; font-size: 0.85rem;">
                  ${base.description}
                </p>
              </div>
            </div>
          `);
      });
    });

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [militaryData]);

  // Format troop counts for display
  const formatTroops = (n) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
    return n.toString();
  };

  // Compute a stable key from deployment data so React detects deep changes
  const deploymentKey = JSON.stringify(gameState?.phase2?.cumulativeDeployments || {});
  const conflictKey = JSON.stringify(gameState?.phase2?.pendingConflictZones || {});

  // Update map with cumulative deployments, conflict zones, and battle results
  useEffect(() => {
    if (!leafletMapRef.current) return;
    const map = leafletMapRef.current;

    // Clear previous layers
    deploymentMarkersRef.current.forEach(layer => map.removeLayer(layer));
    deploymentMarkersRef.current = [];
    conflictLayersRef.current.forEach(layer => map.removeLayer(layer));
    conflictLayersRef.current = [];

    const cumulativeDeployments = gameState?.phase2?.cumulativeDeployments || {};
    const pendingConflicts = gameState?.phase2?.pendingConflictZones || {};
    const activeConflicts = gameState?.phase2?.activeConflicts || [];
    const battleResults = gameState?.phase2?.battleResults || [];

    console.log('🗺️ Map update: deployments=', Object.keys(cumulativeDeployments),
      'conflicts=', Object.keys(pendingConflicts),
      'active=', activeConflicts.length,
      'battles=', battleResults.length);

    // --- CUMULATIVE DEPLOYMENT MARKERS ---
    Object.entries(cumulativeDeployments).forEach(([region, countries]) => {
      const regionCoords = REGION_COORDINATES[region];
      if (!regionCoords) return;

      const countryNames = Object.keys(countries);
      const countryCount = countryNames.length;

      countryNames.forEach((country, idx) => {
        const data = countries[country];
        if (!data || data.total <= 0) return;

        const color = COUNTRY_COLORS[country] || '#64748b';
        // Fan out markers around the region center so they don't overlap
        const angle = (idx / countryCount) * Math.PI * 2 - Math.PI / 2;
        const spread = countryCount > 1 ? 2.5 : 0;
        const lat = regionCoords.lat + Math.sin(angle) * spread;
        const lng = regionCoords.lng + Math.cos(angle) * spread;

        const size = data.total > 500000 ? 28 : data.total > 200000 ? 22 : data.total > 50000 ? 18 : 14;

        // Build branch breakdown
        const branches = [];
        if (data.army > 0) branches.push(`🪖 ${formatTroops(data.army)}`);
        if (data.navy > 0) branches.push(`⚓ ${formatTroops(data.navy)}`);
        if (data.airForce > 0) branches.push(`✈️ ${formatTroops(data.airForce)}`);

        const icon = L.divIcon({
          html: `
            <div class="deployment-marker" style="
              width: ${size}px;
              height: ${size}px;
              background: ${color};
              border: 3px solid white;
              border-radius: 50%;
              box-shadow: 0 0 10px ${color}, 0 0 20px ${color}66;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: ${size > 20 ? 14 : 11}px;
              cursor: pointer;
            ">
              ${data.army > 0 ? '🪖' : data.navy > 0 ? '⚓' : '✈️'}
            </div>
            <div style="
              position: absolute;
              top: ${size + 4}px;
              left: 50%;
              transform: translateX(-50%);
              background: ${color};
              color: white;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: 10px;
              font-weight: bold;
              white-space: nowrap;
              pointer-events: none;
            ">${country}: ${formatTroops(data.total)}</div>
          `,
          className: '',
          iconSize: [size, size + 20],
          iconAnchor: [size / 2, size / 2]
        });

        const marker = L.marker([lat, lng], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="min-width: 200px;">
              <h3 style="margin: 0 0 8px 0; color: ${color};">
                ${country} Forces in ${region}
              </h3>
              <div style="font-size: 0.95rem; line-height: 1.8;">
                <p style="margin: 2px 0;"><strong>Total:</strong> ${data.total.toLocaleString()} troops</p>
                ${branches.map(b => `<p style="margin: 2px 0;">${b}</p>`).join('')}
              </div>
              ${countryCount > 1 ? `<p style="margin: 8px 0 0 0; color: #ef4444; font-weight: bold;">⚠️ ${countryCount} nations deployed here</p>` : ''}
            </div>
          `);

        deploymentMarkersRef.current.push(marker);
      });
    });

    // --- CONFLICT ZONE CIRCLES ---
    // Show red pulsing circles around regions with pending conflicts or active battles
    const conflictRegions = new Set([
      ...Object.keys(pendingConflicts),
      ...activeConflicts.map(c => c.region)
    ]);

    conflictRegions.forEach(region => {
      const regionCoords = REGION_COORDINATES[region];
      if (!regionCoords) return;

      const conflict = pendingConflicts[region] || activeConflicts.find(c => c.region === region);
      const countries = conflict?.countries || [];
      const isActiveBattle = activeConflicts.some(c => c.region === region);

      // Pulsing conflict zone circle
      const circle = L.circle([regionCoords.lat, regionCoords.lng], {
        radius: 500000, // 500km radius
        color: isActiveBattle ? '#dc2626' : '#f59e0b',
        fillColor: isActiveBattle ? '#dc262633' : '#f59e0b22',
        fillOpacity: 0.3,
        weight: 3,
        dashArray: isActiveBattle ? null : '10, 8',
        className: 'conflict-zone-circle'
      }).addTo(map);

      circle.bindPopup(`
        <div style="min-width: 200px;">
          <h3 style="margin: 0 0 8px 0; color: ${isActiveBattle ? '#dc2626' : '#f59e0b'};">
            ${isActiveBattle ? '⚔️ Active Battle' : '⚠️ Tension Zone'} — ${region}
          </h3>
          <p style="margin: 4px 0;"><strong>Nations involved:</strong> ${countries.join(', ')}</p>
          ${isActiveBattle ? '<p style="margin: 4px 0; color: #dc2626; font-weight: bold;">Combat in progress!</p>' : '<p style="margin: 4px 0; color: #f59e0b;">Military standoff — diplomatic resolution pending</p>'}
        </div>
      `);

      conflictLayersRef.current.push(circle);

      // Add a secondary outer ring that pulses
      const outerRing = L.circle([regionCoords.lat, regionCoords.lng], {
        radius: 700000,
        color: isActiveBattle ? '#dc2626' : '#f59e0b',
        fillColor: 'transparent',
        fillOpacity: 0,
        weight: 2,
        opacity: 0.4,
        dashArray: '5, 10',
        className: 'conflict-zone-outer'
      }).addTo(map);

      conflictLayersRef.current.push(outerRing);

      // Region label
      const label = L.divIcon({
        html: `<div class="${isActiveBattle ? 'battle-label' : 'tension-label'}" style="
          background: ${isActiveBattle ? '#dc2626' : '#f59e0b'};
          color: white;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: bold;
          white-space: nowrap;
          text-align: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          pointer-events: none;
        ">${isActiveBattle ? '⚔️ BATTLE' : '⚠️ TENSION'}: ${region}</div>`,
        className: '',
        iconSize: [150, 24],
        iconAnchor: [75, -20]
      });

      const labelMarker = L.marker([regionCoords.lat, regionCoords.lng], { icon: label, interactive: false }).addTo(map);
      conflictLayersRef.current.push(labelMarker);
    });

    // --- BATTLE RESULT MARKERS ---
    // Show recent battle results with explosion markers
    battleResults.forEach(battle => {
      const region = battle.region;
      const regionCoords = REGION_COORDINATES[region];
      if (!regionCoords) return;

      const winnerColor = battle.winner ? (COUNTRY_COLORS[battle.winner] || '#22c55e') : '#6b7280';
      const resultText = battle.winner ? `${battle.winner} Victory` : 'Stalemate';

      const icon = L.divIcon({
        html: `<div class="battle-result-marker" style="
          width: 36px;
          height: 36px;
          background: radial-gradient(circle, ${winnerColor} 0%, ${winnerColor}88 50%, transparent 70%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          cursor: pointer;
        ">⚔️</div>
        <div style="
          position: absolute;
          top: 38px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.85);
          color: ${winnerColor};
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: bold;
          white-space: nowrap;
          pointer-events: none;
        ">${resultText}</div>`,
        className: '',
        iconSize: [36, 60],
        iconAnchor: [18, 18]
      });

      const marker = L.marker([regionCoords.lat, regionCoords.lng], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="min-width: 220px;">
            <h3 style="margin: 0 0 8px 0; color: ${winnerColor};">
              ⚔️ Battle of ${region}
            </h3>
            <p style="margin: 4px 0;"><strong>Outcome:</strong> ${resultText}</p>
            ${battle.participants ? battle.participants.map(p => `
              <div style="margin: 6px 0; padding: 6px; background: ${p.country === battle.winner ? '#f0fdf4' : '#fef2f2'}; border-radius: 4px;">
                <strong>${p.country}</strong> ${p.country === battle.winner ? '🏆' : ''}
                ${p.casualties ? `<br/>Casualties: ${p.casualties.toLocaleString()}` : ''}
              </div>
            `).join('') : ''}
          </div>
        `);

      deploymentMarkersRef.current.push(marker);
    });

  }, [deploymentKey, conflictKey, gameState?.phase2?.activeConflicts?.length, gameState?.phase2?.battleResults?.length, currentYear]);

  // Auto-zoom to conflict zones when they appear
  useEffect(() => {
    if (!leafletMapRef.current) return;
    const map = leafletMapRef.current;

    const activeConflicts = gameState?.phase2?.activeConflicts || [];
    if (activeConflicts.length === 0) return;

    // Zoom to the first active conflict
    const firstConflict = activeConflicts[0];
    const coords = REGION_COORDINATES[firstConflict.region];
    if (coords) {
      map.flyTo([coords.lat, coords.lng], 4, {
        duration: 1.5,
        easeLinearity: 0.25
      });
    }
  }, [gameState?.phase2?.activeConflicts?.length]);

  // Auto-zoom to new battle results when they appear
  const prevBattleCountRef = useRef(0);
  useEffect(() => {
    if (!leafletMapRef.current) return;
    const map = leafletMapRef.current;

    const battleResults = gameState?.phase2?.battleResults || [];
    if (battleResults.length > prevBattleCountRef.current && battleResults.length > 0) {
      const latestBattle = battleResults[battleResults.length - 1];
      const coords = REGION_COORDINATES[latestBattle.region];
      if (coords) {
        map.flyTo([coords.lat, coords.lng], 5, {
          duration: 1.2,
          easeLinearity: 0.25
        });
      }
    }
    prevBattleCountRef.current = battleResults.length;
  }, [gameState?.phase2?.battleResults?.length]);

  if (!militaryData) {
    return (
      <div style={{ background: 'white', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
        <h2 style={{ marginTop: 0, marginBottom: '20px' }}>🗺️ Global Military Deployments - {currentYear}</h2>
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🌍</div>
          Loading military deployment map...
        </div>
      </div>
    );
  }

  // Gather stats for legend
  const currentMilitary = {};
  if (gameState?.phase2?.yearlyData?.[currentYear]) {
    Object.entries(gameState.phase2.yearlyData[currentYear]).forEach(([country, data]) => {
      currentMilitary[country] = data.military?.total || data.militarySize || 500000;
    });
  }

  const pendingConflicts = gameState?.phase2?.pendingConflictZones || {};
  const activeConflicts = gameState?.phase2?.activeConflicts || [];
  const battleResults = gameState?.phase2?.battleResults || [];
  const conflictCount = Object.keys(pendingConflicts).length + activeConflicts.length;

  return (
    <div style={{ background: 'white', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
      <h2 style={{ marginTop: 0, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        🗺️ Global Military Deployments - {currentYear}
        {conflictCount > 0 && (
          <span style={{
            background: '#dc2626',
            color: 'white',
            padding: '2px 10px',
            borderRadius: '12px',
            fontSize: '0.8rem',
            fontWeight: 'bold'
          }}>
            {conflictCount} conflict zone{conflictCount > 1 ? 's' : ''}
          </span>
        )}
        {battleResults.length > 0 && (
          <span style={{
            background: '#6b7280',
            color: 'white',
            padding: '2px 10px',
            borderRadius: '12px',
            fontSize: '0.8rem',
            fontWeight: 'bold'
          }}>
            {battleResults.length} battle{battleResults.length > 1 ? 's' : ''} fought
          </span>
        )}
      </h2>

      {/* Map container */}
      <div
        ref={mapRef}
        style={{
          height: '500px',
          borderRadius: '8px',
          border: conflictCount > 0 ? '2px solid #dc2626' : '2px solid #e2e8f0',
          marginBottom: '20px'
        }}
      />

      {/* Legend */}
      <div style={{ marginTop: '20px', display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'center' }}>
        {Object.entries(militaryData).map(([country, data]) => (
          <div
            key={country}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              background: '#f8fafc',
              borderRadius: '6px',
              border: '1px solid #e2e8f0'
            }}
          >
            <div style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: COUNTRY_COLORS[country] || '#64748b',
              border: '2px solid white',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }} />
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{country}</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {currentMilitary[country] ?
                  `${formatTroops(currentMilitary[country])} troops` :
                  `${formatTroops(data.totalTroops)} troops`}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Map key for symbols */}
      <div style={{ marginTop: '16px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '0.9rem' }}>Map Key:</div>
        <div style={{ fontSize: '0.85rem', color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          <span>🪖 Army</span>
          <span>⚓ Navy</span>
          <span>✈️ Air Force</span>
          <span style={{ color: '#f59e0b' }}>◯ Tension zone</span>
          <span style={{ color: '#dc2626' }}>◯ Active battle</span>
          <span>⚔️ Battle result</span>
        </div>
      </div>
    </div>
  );
}

window.MilitaryMap = MilitaryMap;
