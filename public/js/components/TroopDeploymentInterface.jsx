const { useState } = React;

        // Troop Deployment Interface Component
        function TroopDeploymentInterface({ playerCountry, gameState, socket, playerId, roomId }) {
          const [selectedRegion, setSelectedRegion] = useState('');
          const [selectedBranch, setSelectedBranch] = useState('Army');
          const [troopCount, setTroopCount] = useState(50000);
          const [deploymentLog, setDeploymentLog] = useState([]);

          // Strategic regions with hotspots and deployment costs
          const strategicRegions = {
            'Western Europe': { cost: 100, hotspot: false, description: 'NATO territory, Marshall Plan zone' },
            'Eastern Europe': { cost: 150, hotspot: true, description: '⚠️ Soviet sphere - risk of conflict' },
            'Germany': { cost: 80, hotspot: true, description: '⚠️ Divided occupation zones' },
            'Berlin': { cost: 200, hotspot: true, description: '🔥 FLASHPOINT - Deep in Soviet zone' },
            'Middle East': { cost: 180, hotspot: true, description: '⚠️ Oil resources, Suez Canal' },
            'Suez Canal': { cost: 150, hotspot: true, description: '⚠️ Strategic chokepoint' },
            'Korea': { cost: 250, hotspot: true, description: '🔥 FLASHPOINT - 38th parallel divide' },
            'Indochina': { cost: 220, hotspot: true, description: '⚠️ French colonial war zone' },
            'South Asia': { cost: 120, hotspot: false, description: 'India/Pakistan region' },
            'East Asia': { cost: 200, hotspot: true, description: '⚠️ China, Japan, Taiwan' },
            'Southeast Asia': { cost: 180, hotspot: false, description: 'Colonial transitions' },
            'Pacific Islands': { cost: 150, hotspot: false, description: 'US naval dominance' },
            'North America': { cost: 50, hotspot: false, description: 'US/Canada homeland' },
            'Central America': { cost: 100, hotspot: false, description: 'US sphere of influence' },
            'South America': { cost: 120, hotspot: false, description: 'Neutral, Argentine influence' },
            'Caribbean': { cost: 80, hotspot: false, description: 'US naval bases' },
            'North Africa': { cost: 140, hotspot: false, description: 'French colonies' },
            'Sub-Saharan Africa': { cost: 160, hotspot: false, description: 'European colonies' }
          };

          // Calculate deployment cost
          const getDeploymentCost = () => {
            if (!selectedRegion) return 0;
            const regionData = strategicRegions[selectedRegion];
            const baseCost = regionData?.cost || 100;
            const branchMultiplier = selectedBranch === 'Army' ? 1 : selectedBranch === 'Navy' ? 1.5 : 2;
            return Math.round(baseCost * (troopCount / 50000) * branchMultiplier);
          };

          // Get current deployments for this country
          const myDeployments = gameState?.phase2?.deployments?.filter(d => d.country === playerCountry) || [];

          const handleDeploy = () => {
            if (!selectedRegion) return;

            const deployment = {
              country: playerCountry,
              region: selectedRegion,
              branch: selectedBranch,
              troops: troopCount,
              cost: getDeploymentCost(),
              year: gameState?.phase2?.currentYear,
              timestamp: Date.now()
            };

            socket.emit('deployTroops', {
              roomId,
              playerid: playerId,
              deployment
            });

            setDeploymentLog([...deploymentLog, {
              ...deployment,
              time: new Date().toLocaleTimeString()
            }]);

            setSelectedRegion('');
            setSelectedBranch('Army');
            setTroopCount(50000);
          };

          const regions = Object.keys(strategicRegions);

          return (
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              marginBottom: '20px',
              border: '2px solid #dc2626'
            }}>
              <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#dc2626' }}>
                ⚔️ Deploy Your Troops - {playerCountry}
              </h2>

              {/* Current Deployments Summary */}
              {myDeployments.length > 0 && (
                <div style={{
                  marginBottom: '20px',
                  padding: '12px',
                  background: '#f0fdf4',
                  borderRadius: '8px',
                  border: '1px solid #86efac'
                }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#166534' }}>
                    📍 Your Active Deployments ({myDeployments.length})
                  </div>
                  <div style={{ fontSize: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {myDeployments.map((d, idx) => (
                      <span key={idx} style={{
                        background: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid #86efac'
                      }}>
                        {d.branch === 'Army' ? '🪖' : d.branch === 'Navy' ? '⚓' : '✈️'}
                        {d.region}: {(d.troops/1000).toFixed(0)}K
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px' }}>
                  Deploy To Region
                </label>
                <select
                  value={selectedRegion}
                  onChange={(e) => setSelectedRegion(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '6px',
                    border: selectedRegion && strategicRegions[selectedRegion]?.hotspot
                      ? '2px solid #ef4444'
                      : '2px solid #e2e8f0',
                    fontSize: '1rem',
                    background: selectedRegion && strategicRegions[selectedRegion]?.hotspot
                      ? '#fef2f2'
                      : 'white'
                  }}
                >
                  <option value="">Choose a strategic region...</option>
                  {regions.map(region => {
                    const data = strategicRegions[region];
                    return (
                      <option key={region} value={region}>
                        {data.hotspot ? '⚠️ ' : ''}{region} (Cost: ${data.cost})
                      </option>
                    );
                  })}
                </select>

                {/* Region Info */}
                {selectedRegion && (
                  <div style={{
                    marginTop: '8px',
                    padding: '10px',
                    background: strategicRegions[selectedRegion]?.hotspot ? '#fef2f2' : '#f8fafc',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    border: strategicRegions[selectedRegion]?.hotspot ? '1px solid #fecaca' : '1px solid #e2e8f0'
                  }}>
                    <div style={{ color: strategicRegions[selectedRegion]?.hotspot ? '#dc2626' : '#64748b' }}>
                      {strategicRegions[selectedRegion]?.description}
                    </div>
                    {strategicRegions[selectedRegion]?.hotspot && (
                      <div style={{ marginTop: '6px', color: '#dc2626', fontWeight: 'bold', fontSize: '0.85rem' }}>
                        ⚠️ Deploying here may trigger military confrontation!
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Military Branch Selection */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '12px' }}>
                  Military Branch
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                  {['Army', 'Navy', 'Air Force'].map(branch => (
                    <button
                      key={branch}
                      onClick={() => setSelectedBranch(branch)}
                      style={{
                        padding: '12px',
                        borderRadius: '6px',
                        border: selectedBranch === branch ? '2px solid #0ea5e9' : '2px solid #e2e8f0',
                        background: selectedBranch === branch ? '#e0f2fe' : 'white',
                        fontSize: '0.9rem',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {branch === 'Army' && '🪖'} {branch === 'Navy' && '⚓'} {branch === 'Air Force' && '✈️'} {branch}
                    </button>
                  ))}
                </div>
              </div>

              {/* Troop Count Slider */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <label style={{ fontWeight: 'bold' }}>Number of Troops</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#dc2626' }}>
                    {(troopCount / 1000).toFixed(0)}K troops
                  </span>
                </div>
                <input
                  type="range"
                  min="10000"
                  max="500000"
                  step="10000"
                  value={troopCount}
                  onChange={(e) => setTroopCount(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
              </div>

              {/* Deploy Button */}
              {/* Deployment Cost Summary */}
              {selectedRegion && (
                <div style={{
                  marginBottom: '16px',
                  padding: '12px',
                  background: '#fef3c7',
                  borderRadius: '8px',
                  border: '1px solid #fbbf24',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{ fontWeight: 'bold', color: '#92400e' }}>
                    💰 Deployment Cost:
                  </span>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#dc2626' }}>
                    ${getDeploymentCost().toLocaleString()}M
                  </span>
                </div>
              )}

              <button
                onClick={handleDeploy}
                disabled={!selectedRegion}
                style={{
                  width: '100%',
                  padding: '16px',
                  background: selectedRegion ? (strategicRegions[selectedRegion]?.hotspot ? '#dc2626' : '#16a34a') : '#94a3b8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '1.1rem',
                  fontWeight: 'bold',
                  cursor: selectedRegion ? 'pointer' : 'not-allowed',
                  marginBottom: '20px',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => selectedRegion && (e.currentTarget.style.opacity = '0.9')}
                onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
              >
                {selectedRegion
                  ? (strategicRegions[selectedRegion]?.hotspot
                    ? `⚠️ Deploy to ${selectedRegion} (HOTSPOT)`
                    : `⚔️ Deploy to ${selectedRegion}`)
                  : '⚔️ Select a Region to Deploy'}
              </button>

              {/* Deployment Log */}
              {deploymentLog.length > 0 && (
                <div>
                  <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '1rem', color: '#64748b' }}>
                    Your Recent Deployments:
                  </h3>
                  <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                    {deploymentLog.slice().reverse().map((log, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: '12px',
                          background: '#dbeafe',
                          borderLeft: '4px solid #3b82f6',
                          marginBottom: '8px',
                          borderRadius: '4px',
                          fontSize: '0.9rem'
                        }}
                      >
                        Deployed <strong>{(log.troops / 1000).toFixed(0)}K</strong> {log.branch} troops
                        to <strong>{log.region}</strong>
                        <div style={{ fontSize: '0.8rem', color: '#1e40af', marginTop: '4px' }}>
                          {log.time}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warning */}
              <div style={{
                marginTop: '20px',
                padding: '16px',
                background: '#fef3c7',
                borderRadius: '8px',
                border: '2px solid #f59e0b'
              }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#92400e', fontSize: '0.95rem' }}>
                  💡 Strategic Tip
                </h4>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#78350f' }}>
                  Deploying troops to contested regions (Eastern Europe, East Asia, Middle East) may create
                  tensions with other powers. Watch for conflict alerts and plan accordingly!
                </p>
              </div>
            </div>
          );
        }

window.TroopDeploymentInterface = TroopDeploymentInterface;
