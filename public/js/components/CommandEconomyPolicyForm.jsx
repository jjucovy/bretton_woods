const { useState } = React;

        // Command Economy Policy Form (USSR, Communist China)
        function CommandEconomyPolicyForm({ currentYear, playerId, socket, roomId, country, myData, previousPolicy }) {
          const [fiveYearPlanTarget, setFiveYearPlanTarget] = useState(previousPolicy?.fiveYearPlanTarget ?? 8); // % growth target
          const [heavyIndustryAllocation, setHeavyIndustryAllocation] = useState(previousPolicy?.heavyIndustryAllocation ?? 60); // % of resources
          const [foreignTradeOrientation, setForeignTradeOrientation] = useState(previousPolicy?.foreignTradeOrientation ?? 50); // COMECON vs West trade
          const [planFulfillmentPriority, setPlanFulfillmentPriority] = useState(previousPolicy?.planFulfillmentPriority ?? 70); // Credit allocation rigor
          const [militarySpending, setMilitarySpending] = useState(previousPolicy?.militarySpending ?? 15);
          const [isSubmitting, setIsSubmitting] = useState(false); // Prevent double-submit

          // Initialize military branches from previous year's data
          const prevMilitary = myData?.military || { army: 2400000, navy: 300000, airForce: 200000 };
          const [armySize, setArmySize] = useState(prevMilitary.army);
          const [navySize, setNavySize] = useState(prevMilitary.navy);
          const [airForceSize, setAirForceSize] = useState(prevMilitary.airForce);

          const totalMilitary = armySize + navySize + airForceSize;

          const handleSubmit = () => {
            if (isSubmitting) return; // Prevent double-click
            setIsSubmitting(true);
            socket.emit('submitPolicy', {
              gameId: roomId,
              playerid: playerId,
              policy: {
                fiveYearPlanTarget,
                heavyIndustryAllocation,
                foreignTradeOrientation,
                planFulfillmentPriority,
                militarySpending,
                armySize,
                navySize,
                airForceSize,
                isCommandEconomy: true
              }
            });
          };

          return (
            <div style={{ background: 'white', borderRadius: '12px', padding: '24px', marginBottom: '20px', border: '3px solid #a855f7' }}>
              <h2 style={{ marginTop: 0, marginBottom: '10px', color: '#7c3aed' }}>
                🏭 Set Five-Year Plan Targets for {currentYear}
              </h2>
              <div style={{ padding: '12px', background: '#f3e8ff', borderRadius: '6px', marginBottom: '25px', borderLeft: '4px solid #a855f7' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#6b21a8' }}>
                  <strong>Command Economy:</strong> GOSPLAN determines production targets. Gosbank controls credit allocation.
                  Ministry of Foreign Trade manages all international transactions through state monopoly.
                </p>
              </div>

              <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#6b21a8', borderBottom: '2px solid #a855f7', paddingBottom: '8px' }}>
                📋 Central Planning (GOSPLAN)
              </h3>

              <div style={{ marginBottom: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold' }}>Five-Year Plan Growth Target</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#7c3aed' }}>{fiveYearPlanTarget}%</span>
                </div>
                <input
                  type="range"
                  min="3"
                  max="15"
                  step="1"
                  value={fiveYearPlanTarget}
                  onChange={(e) => setFiveYearPlanTarget(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '8px 0 0 0' }}>
                  💡 <strong>GOSPLAN directive:</strong> Higher targets = rapid industrialization but risks bottlenecks.
                  Stalin's 5-Year Plans targeted 10-12% growth
                </p>
              </div>

              <div style={{ marginBottom: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold' }}>Heavy Industry Allocation</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#7c3aed' }}>{heavyIndustryAllocation}%</span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="80"
                  step="5"
                  value={heavyIndustryAllocation}
                  onChange={(e) => setHeavyIndustryAllocation(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '8px 0 0 0' }}>
                  💡 <strong>Resource allocation:</strong> Heavy industry (steel, machinery) vs consumer goods.
                  Stalin's "Socialism in One Country" prioritized 65-70% heavy industry
                </p>
              </div>

              <h3 style={{ marginTop: '30px', marginBottom: '20px', color: '#0891b2', borderBottom: '2px solid #06b6d4', paddingBottom: '8px' }}>
                🌍 Foreign Trade (Ministry of Foreign Trade)
              </h3>

              <div style={{ marginBottom: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold' }}>Foreign Trade Orientation</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#0891b2' }}>
                    {foreignTradeOrientation < 30 ? 'COMECON' : foreignTradeOrientation < 70 ? 'Balanced' : 'Western'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="10"
                  value={foreignTradeOrientation}
                  onChange={(e) => setForeignTradeOrientation(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>
                  <span>Socialist Bloc</span>
                  <span>Western Markets</span>
                </div>
                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '8px 0 0 0' }}>
                  💡 <strong>FTO (Foreign Trade Organizations) directive:</strong> Low = bilateral barter with COMECON (oil/machinery for goods).
                  High = trade oil/gas for Western hard currency and technology. Self-sufficiency vs selective engagement.
                </p>
              </div>

              <h3 style={{ marginTop: '30px', marginBottom: '20px', color: '#059669', borderBottom: '2px solid #10b981', paddingBottom: '8px' }}>
                🏦 Credit Allocation (GOSBANK)
              </h3>

              <div style={{ marginBottom: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold' }}>Plan Fulfillment Priority</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#059669' }}>
                    {planFulfillmentPriority}%
                  </span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="100"
                  step="5"
                  value={planFulfillmentPriority}
                  onChange={(e) => setPlanFulfillmentPriority(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '8px 0 0 0' }}>
                  💡 <strong>Gosbank credit policy:</strong> High = strict allocation to meet plan targets (fixed low rates for priority industries).
                  Low = more flexibility for enterprises. Credit channels funds to fulfill physical production targets, not market demand.
                </p>
              </div>

              <h3 style={{ marginTop: '30px', marginBottom: '20px', color: '#7c2d12', borderBottom: '2px solid #dc2626', paddingBottom: '8px' }}>
                ⚔️ Military-Industrial Complex
              </h3>

              <div style={{ marginBottom: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold' }}>Military Spending (% of GDP)</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#dc2626' }}>{militarySpending}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="30"
                  step="1"
                  value={militarySpending}
                  onChange={(e) => setMilitarySpending(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '8px 0 0 0' }}>
                  💡 Command economies can allocate resources to military-industrial complex directly. USSR Cold War: 15-20%
                </p>
              </div>

              <div style={{ marginBottom: '20px', padding: '15px', background: '#fef3c7', borderRadius: '8px', border: '2px solid #f59e0b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>📊 Total Red Army Personnel:</span>
                  <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#dc2626' }}>
                    {(totalMilitary / 1000000).toFixed(2)}M
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#92400e' }}>
                  <strong>Defense Budget (% of GDP):</strong> {militarySpending}%
                </div>
              </div>

              <div style={{ marginBottom: '25px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold' }}>Defense Budget (% of GDP)</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#dc2626' }}>{militarySpending}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="30"
                  step="1"
                  value={militarySpending}
                  onChange={(e) => setMilitarySpending(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '8px 0 0 0' }}>
                  💡 State control allows higher military spending. USSR typically 15-20%
                </p>
              </div>

              {/* GROUND FORCES */}
              <div style={{ marginBottom: '25px', padding: '15px', background: '#f0fdf4', borderRadius: '8px', border: '2px solid #16a34a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold', color: '#166534' }}>🪖 Ground Forces (Red Army)</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#16a34a' }}>
                    {(armySize / 1000000).toFixed(2)}M
                  </span>
                </div>
                <input
                  type="range"
                  min="500000"
                  max="5000000"
                  step="100000"
                  value={armySize}
                  onChange={(e) => setArmySize(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.85rem', color: '#166534', margin: '8px 0 0 0' }}>
                  💰 <strong>Cost:</strong> Low (conscription) | <strong>Role:</strong> Occupation, Eastern Europe garrison
                </p>
              </div>

              {/* NAVY */}
              <div style={{ marginBottom: '25px', padding: '15px', background: '#eff6ff', borderRadius: '8px', border: '2px solid #2563eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold', color: '#1e40af' }}>⚓ Soviet Navy</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#2563eb' }}>
                    {(navySize / 1000).toFixed(0)}K
                  </span>
                </div>
                <input
                  type="range"
                  min="100000"
                  max="800000"
                  step="50000"
                  value={navySize}
                  onChange={(e) => setNavySize(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.85rem', color: '#1e40af', margin: '8px 0 0 0' }}>
                  💰 <strong>Cost:</strong> High (ships) | <strong>Role:</strong> Baltic, Black Sea, Pacific fleets
                </p>
              </div>

              {/* AIR FORCE */}
              <div style={{ marginBottom: '25px', padding: '15px', background: '#f5f3ff', borderRadius: '8px', border: '2px solid #7c3aed' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold', color: '#5b21b6' }}>✈️ Soviet Air Force</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#7c3aed' }}>
                    {(airForceSize / 1000).toFixed(0)}K
                  </span>
                </div>
                <input
                  type="range"
                  min="100000"
                  max="1000000"
                  step="50000"
                  value={airForceSize}
                  onChange={(e) => setAirForceSize(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.85rem', color: '#5b21b6', margin: '8px 0 0 0' }}>
                  💰 <strong>Cost:</strong> Very High (jet tech) | <strong>Role:</strong> Strategic defense, tactical support
                </p>
              </div>

              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  padding: '18px',
                  background: isSubmitting ? '#9ca3af' : '#7c3aed',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '1.1rem',
                  fontWeight: 'bold',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  opacity: isSubmitting ? 0.7 : 1
                }}
                onMouseOver={(e) => !isSubmitting && (e.currentTarget.style.background = '#6d28d9')}
                onMouseOut={(e) => !isSubmitting && (e.currentTarget.style.background = '#7c3aed')}
              >
                {isSubmitting ? '⏳ Submitting...' : '📋 Submit Five-Year Plan to Politburo'}
              </button>

              <div style={{
                marginTop: '16px',
                padding: '12px',
                background: '#fef3c7',
                borderRadius: '6px',
                fontSize: '0.85rem',
                color: '#78350f',
                borderLeft: '3px solid #f59e0b'
              }}>
                <strong>Note:</strong> Exchange rates (ruble non-convertible, set by Gosbank via artificial official rates + internal coefficients)
                and interest rates (fixed administrative rates by industry, not market-based) are automatically managed by the state.
                Foreign exchange strictly controlled via valuta rubles and FTOs.
              </div>
            </div>
          );
        }

window.CommandEconomyPolicyForm = CommandEconomyPolicyForm;
