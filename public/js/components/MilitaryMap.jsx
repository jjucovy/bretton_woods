const { useState, useEffect } = React;

// Region coordinates for deployment visualization
const REGION_COORDINATES = {
  'Western Europe': { lat: 48.8, lng: 2.3, name: 'Western Europe' },
  'Eastern Europe': { lat: 52.2, lng: 21.0, name: 'Eastern Europe' },
  'Middle East': { lat: 31.5, lng: 34.8, name: 'Middle East' },
  'North Africa': { lat: 28.0, lng: 3.0, name: 'North Africa' },
  'Sub-Saharan Africa': { lat: -2.0, lng: 23.0, name: 'Sub-Saharan Africa' },
  'South Asia': { lat: 20.5, lng: 78.9, name: 'South Asia' },
  'East Asia': { lat: 35.8, lng: 104.1, name: 'East Asia' },
  'Southeast Asia': { lat: 12.8, lng: 108.0, name: 'Southeast Asia' },
  'Pacific Islands': { lat: -5.0, lng: 152.0, name: 'Pacific Islands' },
  'North America': { lat: 40.0, lng: -100.0, name: 'North America' },
  'Central America': { lat: 15.0, lng: -90.0, name: 'Central America' },
  'South America': { lat: -15.0, lng: -60.0, name: 'South America' },
  'Caribbean': { lat: 18.0, lng: -75.0, name: 'Caribbean' },
  'Arctic': { lat: 75.0, lng: 0.0, name: 'Arctic' },
  'Antarctic': { lat: -75.0, lng: 0.0, name: 'Antarctic' },
  'Korea': { lat: 37.5, lng: 127.0, name: 'Korean Peninsula' },
  'Indochina': { lat: 16.0, lng: 108.0, name: 'Indochina' },
  'Germany': { lat: 51.0, lng: 10.0, name: 'Germany' },
  'Japan': { lat: 36.0, lng: 138.0, name: 'Japan' },
  'Suez Canal': { lat: 30.5, lng: 32.3, name: 'Suez Canal Zone' },
  'Berlin': { lat: 52.5, lng: 13.4, name: 'Berlin' }
};

        // Military Map Component using Leaflet.js
        function MilitaryMap({ currentYear, gameState, playerCountry, socket, roomId, playerId }) {
          const [militaryData, setMilitaryData] = useState(null);
          const [selectedBase, setSelectedBase] = useState(null);
          const [selectedRegion, setSelectedRegion] = useState(null);
          const mapRef = React.useRef(null);
          const leafletMapRef = React.useRef(null);
          const deploymentMarkersRef = React.useRef([]);

          useEffect(() => {
            fetch('/military-deployments.json')
              .then(r => r.json())
              .then(data => setMilitaryData(data.militaryDeployments));
          }, []);

          useEffect(() => {
            if (!militaryData || !mapRef.current || leafletMapRef.current) return;

            // Initialize Leaflet map
            const map = L.map(mapRef.current, {
              center: [20, 0],
              zoom: 2,
              minZoom: 2,
              maxZoom: 8,
              worldCopyJump: true,
              zoomControl: true
            });

            // Add tile layer - using OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '&copy; OpenStreetMap contributors',
              noWrap: false
            }).addTo(map);

            leafletMapRef.current = map;

            // Add markers for each military base
            Object.entries(militaryData).forEach(([country, data]) => {
              const countryColors = {
                USA: '#3b82f6',
                UK: '#ef4444',
                USSR: '#a855f7',
                France: '#f59e0b',
                China: '#22c55e',
                India: '#f97316',
                Argentina: '#06b6d4'
              };

              data.bases.forEach(base => {
                const color = countryColors[country] || '#64748b';
                const size = base.troops > 1000000 ? 20 :
                            base.troops > 500000 ? 16 :
                            base.troops > 100000 ? 12 :
                            base.troops > 50000 ? 9 : 6;

                // Create custom icon
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

                const marker = L.marker([base.lat, base.lng], { icon })
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

          // Update map with player deployments
          useEffect(() => {
            if (!leafletMapRef.current || !gameState?.phase2?.deployments) return;

            const map = leafletMapRef.current;
            const countryColors = {
              USA: '#3b82f6', UK: '#ef4444', USSR: '#a855f7',
              France: '#f59e0b', China: '#22c55e', India: '#f97316', Argentina: '#06b6d4'
            };

            // Clear old deployment markers
            deploymentMarkersRef.current.forEach(marker => map.removeLayer(marker));
            deploymentMarkersRef.current = [];

            // Add markers for player deployments
            gameState.phase2.deployments.forEach(deployment => {
              const regionCoords = REGION_COORDINATES[deployment.region];
              if (!regionCoords) return;

              const color = countryColors[deployment.country] || '#64748b';
              // Offset slightly so multiple deployments to same region don't stack
              const offset = (Math.random() - 0.5) * 3;

              const icon = L.divIcon({
                html: `
                  <div class="deployment-marker" style="
                    width: 24px;
                    height: 24px;
                    background: ${color};
                    border: 3px solid white;
                    border-radius: 50%;
                    box-shadow: 0 0 10px ${color}, 0 0 20px ${color}66;
                    animation: pulse 1.5s ease-in-out infinite;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                  ">
                    ${deployment.branch === 'Army' ? '🪖' : deployment.branch === 'Navy' ? '⚓' : '✈️'}
                  </div>
                  <div style="
                    position: absolute;
                    top: 28px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: ${color};
                    color: white;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: bold;
                    white-space: nowrap;
                  ">${deployment.country}: ${(deployment.troops/1000).toFixed(0)}K</div>
                `,
                className: '',
                iconSize: [24, 50],
                iconAnchor: [12, 12]
              });

              const marker = L.marker(
                [regionCoords.lat + offset, regionCoords.lng + offset],
                { icon }
              ).addTo(map).bindPopup(`
                <div style="min-width: 180px;">
                  <h3 style="margin: 0 0 8px 0; color: ${color};">
                    ${deployment.branch === 'Army' ? '🪖' : deployment.branch === 'Navy' ? '⚓' : '✈️'}
                    ${deployment.country} Deployment
                  </h3>
                  <p><strong>Region:</strong> ${deployment.region}</p>
                  <p><strong>Branch:</strong> ${deployment.branch}</p>
                  <p><strong>Troops:</strong> ${deployment.troops.toLocaleString()}</p>
                  <p><strong>Year:</strong> ${deployment.year || currentYear}</p>
                </div>
              `);

              deploymentMarkersRef.current.push(marker);
            });
          }, [gameState?.phase2?.deployments, currentYear]);

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

          // Get current military sizes from game state
          const currentMilitary = {};
          if (gameState?.phase2?.yearlyData?.[currentYear]) {
            Object.entries(gameState.phase2.yearlyData[currentYear]).forEach(([country, data]) => {
              currentMilitary[country] = data.military?.total || data.militarySize || 500000;
            });
          }

          return (
            <div style={{ background: 'white', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
              <h2 style={{ marginTop: 0, marginBottom: '20px' }}>🗺️ Global Military Deployments - {currentYear}</h2>

              {/* Map container */}
              <div
                ref={mapRef}
                style={{
                  height: '500px',
                  borderRadius: '8px',
                  border: '2px solid #e2e8f0',
                  marginBottom: '20px'
                }}
              />

              {/* Legend */}
              <div style={{ marginTop: '20px', display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'center' }}>
                {Object.entries(militaryData).map(([country, data]) => {
                  const countryColors = {
                    USA: '#3b82f6',
                    UK: '#ef4444',
                    USSR: '#a855f7',
                    France: '#f59e0b',
                    China: '#22c55e',
                    India: '#f97316',
                    Argentina: '#06b6d4'
                  };

                  return (
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
                        background: countryColors[country] || '#64748b',
                        border: '2px solid white',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                      }} />
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{country}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {currentMilitary[country] ?
                            `${(currentMilitary[country] / 1000).toFixed(0)}K troops` :
                            `${(data.totalTroops / 1000).toFixed(0)}K troops`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Base type legend */}
              <div style={{ marginTop: '16px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '0.9rem' }}>💡 Tip:</div>
                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  Click on any marker to see detailed information about that military base.
                  Larger circles = more troops deployed. Zoom in/out and pan around the map to explore.
                </div>
              </div>
            </div>
          );
        }

window.MilitaryMap = MilitaryMap;
