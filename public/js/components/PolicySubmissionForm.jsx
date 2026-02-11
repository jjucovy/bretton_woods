const { useState } = React;

        // Policy Submission Form Component for Phase 2
        function PolicySubmissionForm({ currentYear, playerId, socket, roomId, myData, previousPolicy }) {
          const [centralBankRate, setCentralBankRate] = useState(previousPolicy?.centralBankRate ?? 3.0);
          const [exchangeRate, setExchangeRate] = useState(previousPolicy?.exchangeRate ?? 1.0);
          const [tariffRate, setTariffRate] = useState(previousPolicy?.tariffRate ?? 10);
          const [militarySpending, setMilitarySpending] = useState(previousPolicy?.militarySpending ?? 5); // % of GDP
          const [isSubmitting, setIsSubmitting] = useState(false); // Prevent double-submit

          // Initialize military branches from previous year's data
          const prevMilitary = myData?.military || { army: 500000, navy: 100000, airForce: 100000 };
          const [armySize, setArmySize] = useState(prevMilitary.army);
          const [navySize, setNavySize] = useState(prevMilitary.navy);
          const [airForceSize, setAirForceSize] = useState(prevMilitary.airForce);

          const totalMilitary = armySize + navySize + airForceSize;

          const handleSubmit = () => {
            if (isSubmitting) return; // Prevent double-click
            setIsSubmitting(true);
            console.log('📤 Submitting policy for player:', playerId);
            socket.emit('submitPolicy', {
              roomId,
              playerid: playerId,
              policy: {
                centralBankRate,
                exchangeRate,
                tariffRate,
                militarySpending,
                armySize,
                navySize,
                airForceSize,
                isCommandEconomy: false
              }
            });
          };

          return (
            <div style={{ background: 'white', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
              <h2 style={{ marginTop: 0, marginBottom: '25px' }}>Set Economic & Military Policy for {currentYear}</h2>

              <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#1e40af', borderBottom: '2px solid #3b82f6', paddingBottom: '8px' }}>
                💰 Economic Policy
              </h3>

              <div style={{ marginBottom: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold' }}>Central Bank Interest Rate</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#3b82f6' }}>{centralBankRate}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={centralBankRate}
                  onChange={(e) => setCentralBankRate(parseFloat(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '8px 0 0 0' }}>
                  💡 Lower rates stimulate growth but increase inflation. Optimal: ~3%
                </p>
              </div>

              <div style={{ marginBottom: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold' }}>Exchange Rate</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#3b82f6' }}>{exchangeRate.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(parseFloat(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '8px 0 0 0' }}>
                  💡 &lt; 1.0 = Competitive (boosts exports), &gt; 1.0 = Strong (hurts exports)
                </p>
              </div>

              <div style={{ marginBottom: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold' }}>Tariff Rate</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#3b82f6' }}>{tariffRate}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="5"
                  value={tariffRate}
                  onChange={(e) => setTariffRate(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '8px 0 0 0' }}>
                  💡 Protects domestic industry but reduces trade. Optimal: 10-15%
                </p>
              </div>

              <h3 style={{ marginTop: '30px', marginBottom: '20px', color: '#7c2d12', borderBottom: '2px solid #dc2626', paddingBottom: '8px' }}>
                ⚔️ Military Policy
              </h3>

              <div style={{ marginBottom: '20px', padding: '15px', background: '#fef3c7', borderRadius: '8px', border: '2px solid #f59e0b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>📊 Total Military Personnel:</span>
                  <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#dc2626' }}>
                    {(totalMilitary / 1000000).toFixed(2)}M
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#92400e' }}>
                  <strong>Budget Spending (% of GDP):</strong> {militarySpending}%
                </div>
              </div>

              <div style={{ marginBottom: '25px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold' }}>Military Budget (% of GDP)</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#dc2626' }}>{militarySpending}%</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={militarySpending}
                  onChange={(e) => setMilitarySpending(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '8px 0 0 0' }}>
                  💡 Higher spending = stronger military but drains economy. Post-war avg: 5-8%
                </p>
              </div>

              {/* ARMY */}
              <div style={{ marginBottom: '25px', padding: '15px', background: '#f0fdf4', borderRadius: '8px', border: '2px solid #16a34a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold', color: '#166534' }}>🪖 Army Personnel</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#16a34a' }}>
                    {(armySize / 1000).toFixed(0)}K
                  </span>
                </div>
                <input
                  type="range"
                  min="50000"
                  max="3000000"
                  step="50000"
                  value={armySize}
                  onChange={(e) => setArmySize(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.85rem', color: '#166534', margin: '8px 0 0 0' }}>
                  💰 <strong>Cost:</strong> $1/soldier (cheap) | <strong>Role:</strong> Ground forces, occupation, labor drain
                </p>
              </div>

              {/* NAVY */}
              <div style={{ marginBottom: '25px', padding: '15px', background: '#eff6ff', borderRadius: '8px', border: '2px solid #2563eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold', color: '#1e40af' }}>⚓ Navy Personnel</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#2563eb' }}>
                    {(navySize / 1000).toFixed(0)}K
                  </span>
                </div>
                <input
                  type="range"
                  min="10000"
                  max="800000"
                  step="10000"
                  value={navySize}
                  onChange={(e) => setNavySize(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.85rem', color: '#1e40af', margin: '8px 0 0 0' }}>
                  💰 <strong>Cost:</strong> $4/sailor (expensive) | <strong>Role:</strong> Trade protection, power projection
                </p>
              </div>

              {/* AIR FORCE */}
              <div style={{ marginBottom: '25px', padding: '15px', background: '#f5f3ff', borderRadius: '8px', border: '2px solid #7c3aed' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontWeight: 'bold', color: '#5b21b6' }}>✈️ Air Force Personnel</label>
                  <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#7c3aed' }}>
                    {(airForceSize / 1000).toFixed(0)}K
                  </span>
                </div>
                <input
                  type="range"
                  min="10000"
                  max="800000"
                  step="10000"
                  value={airForceSize}
                  onChange={(e) => setAirForceSize(parseInt(e.target.value))}
                  style={{ width: '100%', height: '8px', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '0.85rem', color: '#5b21b6', margin: '8px 0 0 0' }}>
                  💰 <strong>Cost:</strong> $6/airman (very expensive) | <strong>Role:</strong> Strategic bombing, air superiority
                </p>
              </div>

             <button
  type="button"
  disabled={isSubmitting}
  onClick={(e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSubmitting) return;
    console.log('🔵 Button click fired!', e);
    handleSubmit();
  }}
  style={{
    width: '100%',
    padding: '18px',
    background: isSubmitting ? '#9ca3af' : '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1.1rem',
    fontWeight: 'bold',
    cursor: isSubmitting ? 'not-allowed' : 'pointer',
    transition: 'all 0.2s',
    zIndex: 1000,
    position: 'relative',
    pointerEvents: 'auto',
    opacity: isSubmitting ? 0.7 : 1
  }}
                onMouseOver={(e) => !isSubmitting && (e.currentTarget.style.background = '#2563eb')}
                onMouseOut={(e) => !isSubmitting && (e.currentTarget.style.background = '#3b82f6')}
              >
                {isSubmitting ? '⏳ Submitting...' : '📊 Submit Economic & Military Policy'}
              </button>
            </div>
          );
        }

window.PolicySubmissionForm = PolicySubmissionForm;
