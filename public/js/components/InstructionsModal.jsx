const { useState } = React;

function InstructionsModal({ onClose }) {
  const [tab, setTab] = useState('overview');

  const tabs = [
    { id: 'overview',  label: '📋 Overview' },
    { id: 'phase1',    label: '🏛️ Phase 1: Conference' },
    { id: 'phase2',    label: '📊 Phase 2: Economy' },
    { id: 'military',  label: '⚔️ Military & Crises' },
    { id: 'scoring',   label: '🏆 Scoring' },
  ];

  const styles = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: '16px',
    },
    modal: {
      background: 'white', borderRadius: '16px', width: '100%', maxWidth: '820px',
      maxHeight: '88vh', display: 'flex', flexDirection: 'column',
      boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
    },
    header: {
      background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a8e 100%)',
      color: 'white', padding: '20px 24px', borderRadius: '16px 16px 0 0',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    },
    tabBar: {
      display: 'flex', gap: '4px', padding: '12px 16px', borderBottom: '2px solid #e2e8f0',
      background: '#f8fafc', overflowX: 'auto',
    },
    tab: (active) => ({
      padding: '8px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
      fontWeight: active ? 'bold' : 'normal', fontSize: '0.85rem', whiteSpace: 'nowrap',
      background: active ? '#1e3a5f' : 'transparent',
      color: active ? 'white' : '#475569',
    }),
    body: {
      padding: '24px', overflowY: 'auto', flex: 1,
    },
    section: {
      marginBottom: '24px',
    },
    h2: {
      fontSize: '1.15rem', fontWeight: 'bold', color: '#1e3a5f',
      marginTop: 0, marginBottom: '12px', paddingBottom: '8px',
      borderBottom: '2px solid #e2e8f0',
    },
    h3: {
      fontSize: '1rem', fontWeight: 'bold', color: '#334155',
      marginTop: '16px', marginBottom: '8px',
    },
    p: { color: '#475569', lineHeight: '1.6', marginBottom: '10px', marginTop: 0 },
    ul: { paddingLeft: '20px', color: '#475569', lineHeight: '1.7', marginTop: '6px' },
    grid2: {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
      gap: '12px', marginBottom: '12px',
    },
    card: {
      background: '#f1f5f9', borderRadius: '10px', padding: '14px',
      borderLeft: '4px solid #3b82f6',
    },
    cardTitle: { fontWeight: 'bold', color: '#1e3a5f', marginBottom: '4px', fontSize: '0.95rem' },
    cardText: { color: '#475569', fontSize: '0.87rem', lineHeight: '1.5' },
    badge: (color) => ({
      display: 'inline-block', padding: '2px 8px', borderRadius: '12px',
      fontSize: '0.8rem', fontWeight: 'bold', marginRight: '6px',
      background: color === 'blue' ? '#dbeafe' : color === 'green' ? '#dcfce7' : color === 'red' ? '#fee2e2' : '#fef9c3',
      color: color === 'blue' ? '#1d4ed8' : color === 'green' ? '#166534' : color === 'red' ? '#991b1b' : '#854d0e',
    }),
    issueRow: {
      display: 'flex', gap: '10px', alignItems: 'flex-start',
      padding: '10px', borderRadius: '8px', background: '#f8fafc',
      marginBottom: '8px', borderLeft: '3px solid #94a3b8',
    },
    roundNum: {
      minWidth: '28px', height: '28px', background: '#1e3a5f', color: 'white',
      borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 'bold', fontSize: '0.8rem', flexShrink: 0, marginTop: '2px',
    },
    closeBtn: {
      background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white',
      width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer',
      fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
  };

  const countries = [
    { flag: '🇺🇸', name: 'USA',       role: 'Anchor economy. Highest GDP ($228B). Proposes dollar-gold standard.',       strength: 'GDP & Trade' },
    { flag: '🇬🇧', name: 'UK',        role: 'War-exhausted but experienced. Keynes advocates Bancor plan.',               strength: 'Diplomacy' },
    { flag: '🇷🇺', name: 'USSR',      role: 'Command economy. Five-Year Plans. Non-convertible ruble.',                    strength: 'Industry & Military' },
    { flag: '🇫🇷', name: 'France',    role: 'Recovering from occupation. Near-hyperinflation (52%).',                      strength: 'Trade Deals' },
    { flag: '🇨🇳', name: 'China',     role: 'Civil war & hyperinflation (230%). Transitions to command economy in 1949.', strength: 'Population' },
    { flag: '🇮🇳', name: 'India',     role: 'Colonial economy pre-independence. Large rural sector.',                      strength: 'Agriculture' },
    { flag: '🇦🇷', name: 'Argentina', role: 'Wartime prosperity & commodity surplus. Near full employment.',               strength: 'Commodities' },
  ];

  const issues = [
    { round: 1,  title: 'Reserve Currency System',    desc: 'Dollar (White Plan) vs. Bancor (Keynes Plan) vs. Multiple Currencies' },
    { round: 2,  title: 'Exchange Rate System',       desc: 'Fixed Pegs vs. Adjustable Pegs vs. National Sovereignty' },
    { round: 3,  title: 'Capital Controls',           desc: 'Free Movement vs. Transitional Controls vs. Permanent Controls' },
    { round: 4,  title: 'IMF Voting Power',           desc: 'Weighted by GDP vs. Major-power quotas vs. Equal distribution' },
    { round: 5,  title: 'Reconstruction Financing',   desc: 'World Bank conditions vs. Unconditional grants vs. Priority for devastated nations vs. Include commodity exporters' },
    { round: 6,  title: 'Currency Stabilization',     desc: 'Market reforms vs. IMF loans vs. State currency controls' },
    { round: 7,  title: 'Trade Liberalization',       desc: 'Free trade vs. Imperial preferences vs. Gradual tariff reduction' },
    { round: 8,  title: 'Gold Standard',              desc: 'Fixed $35/oz peg vs. Flexible gold standard vs. Abandon gold' },
    { round: 9,  title: 'Soviet Participation',       desc: 'IMF/World Bank with conditions vs. Without conditions vs. Separate Eastern system' },
    { round: 10, title: 'Post-War Economic Order',    desc: 'US-led liberal order vs. Multilateral cooperation vs. National sovereignty' },
  ];

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 'bold', marginBottom: '2px' }}>
              🌍 Bretton Woods — How to Play
            </div>
            <div style={{ opacity: 0.8, fontSize: '0.9rem' }}>
              Post-WWII economic negotiation simulation (1944–1952)
            </div>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Tab bar */}
        <div style={styles.tabBar}>
          {tabs.map(t => (
            <button key={t.id} style={styles.tab(tab === t.id)} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={styles.body}>

          {/* ===== OVERVIEW ===== */}
          {tab === 'overview' && (
            <>
              <div style={styles.section}>
                <h2 style={styles.h2}>What is this game?</h2>
                <p style={styles.p}>
                  It is July 1944. Representatives of 44 Allied nations gather at Bretton Woods, New Hampshire
                  to design the post-war international monetary system. You represent one of 7 major powers.
                  Your goal: shape the conference outcomes to benefit your nation, then manage your economy
                  through the turbulent years of 1946–1952.
                </p>
                <div style={styles.grid2}>
                  <div style={styles.card}>
                    <div style={styles.cardTitle}>🏛️ Phase 1: The Conference</div>
                    <div style={styles.cardText}>17 rounds of voting on the rules of the post-war economic order. Each vote shapes the world you'll manage in Phase 2.</div>
                  </div>
                  <div style={styles.card}>
                    <div style={styles.cardTitle}>📊 Phase 2: Economic Management</div>
                    <div style={styles.cardText}>7 years (1946–1952) of annual economic policy decisions: interest rates, exchange rates, tariffs, and military spending.</div>
                  </div>
                  <div style={styles.card}>
                    <div style={styles.cardTitle}>⚔️ Crises & Conflicts</div>
                    <div style={styles.cardText}>Historical crises erupt each year. Military conflicts may break out in contested regions. Diplomacy and battle strategy matter.</div>
                  </div>
                  <div style={styles.card}>
                    <div style={styles.cardTitle}>🏆 Victory Condition</div>
                    <div style={styles.cardText}>Highest cumulative score after 1952 wins. Points come from GDP growth, inflation control, employment, trade balance, and crisis diplomacy.</div>
                  </div>
                </div>
              </div>

              <div style={styles.section}>
                <h2 style={styles.h2}>Playable Countries</h2>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {countries.map(c => (
                    <div key={c.name} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '10px 14px', background: '#f8fafc', borderRadius: '8px' }}>
                      <span style={{ fontSize: '1.6rem', flexShrink: 0 }}>{c.flag}</span>
                      <div>
                        <div style={{ fontWeight: 'bold', color: '#1e3a5f', marginBottom: '2px' }}>
                          {c.name} <span style={styles.badge('blue')}>Best at: {c.strength}</span>
                        </div>
                        <div style={{ color: '#475569', fontSize: '0.88rem' }}>{c.role}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ===== PHASE 1 ===== */}
          {tab === 'phase1' && (
            <>
              <div style={styles.section}>
                <h2 style={styles.h2}>Phase 1: The Bretton Woods Conference</h2>
                <p style={styles.p}>
                  17 rounds of secret-ballot voting. Each round, all players simultaneously vote on one policy question.
                  The majority wins. <strong>Votes that align with your national interest score points.</strong>
                </p>

                <h3 style={styles.h3}>How voting works</h3>
                <ul style={styles.ul}>
                  <li>Every player votes simultaneously — no coordination visible until results appear.</li>
                  <li>Simple majority wins. If tied, up to 2 revotes are held. If still tied, no policy is adopted for that round.</li>
                  <li>Each country has unique national interests. Read your country's position before voting.</li>
                  <li>The outcomes of Phase 1 votes directly change the rules of Phase 2 (exchange rate bands, capital flow restrictions, trade penalties, etc.).</li>
                </ul>

                <h3 style={styles.h3}>The 10 Conference Issues</h3>
                {issues.map(iss => (
                  <div key={iss.round} style={styles.issueRow}>
                    <div style={styles.roundNum}>{iss.round}</div>
                    <div>
                      <div style={{ fontWeight: 'bold', color: '#1e3a5f', fontSize: '0.95rem' }}>{iss.title}</div>
                      <div style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '2px' }}>{iss.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={styles.section}>
                <h2 style={styles.h2}>Phase 1 → Phase 2 Consequences</h2>
                <div style={styles.grid2}>
                  <div style={{ ...styles.card, borderLeftColor: '#f59e0b' }}>
                    <div style={styles.cardTitle}>Reserve Currency vote</div>
                    <div style={styles.cardText}>Dollar-gold peg = strict ±1% exchange rate band. Bancor = more flexibility. Multiple = near-floating rates.</div>
                  </div>
                  <div style={{ ...styles.card, borderLeftColor: '#f59e0b' }}>
                    <div style={styles.cardTitle}>Trade Liberalization vote</div>
                    <div style={styles.cardText}>Free trade world = low tariffs rewarded more, high tariffs penalized more. Imperial preferences = protectionism tolerated.</div>
                  </div>
                  <div style={{ ...styles.card, borderLeftColor: '#f59e0b' }}>
                    <div style={styles.cardTitle}>Gold Standard vote</div>
                    <div style={styles.cardText}>Fixed peg = gold reserve shortfalls cause exchange rate crises. Abandon gold = reserve pressure reduced.</div>
                  </div>
                  <div style={{ ...styles.card, borderLeftColor: '#f59e0b' }}>
                    <div style={styles.cardTitle}>Soviet Participation vote</div>
                    <div style={styles.cardText}>Eastern bloc outcome affects Cold War tension levels and which crises trigger in Phase 2.</div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ===== PHASE 2 ===== */}
          {tab === 'phase2' && (
            <>
              <div style={styles.section}>
                <h2 style={styles.h2}>Phase 2: Post-War Economic Management (1946–1952)</h2>
                <p style={styles.p}>
                  Each of 7 years, you set your nation's economic and military policy.
                  When all players have submitted, the year advances automatically and results are calculated.
                </p>

                <h3 style={styles.h3}>For Market Economies (USA, UK, France, India, Argentina, China)</h3>
                <div style={styles.grid2}>
                  <div style={styles.card}>
                    <div style={styles.cardTitle}>💰 Central Bank Rate (0–10%)</div>
                    <div style={styles.cardText}>Lower = more growth but more inflation. Optimal ~3%. High rates cool inflation but slow GDP.</div>
                  </div>
                  <div style={styles.card}>
                    <div style={styles.cardTitle}>💱 Exchange Rate (0.5–1.5)</div>
                    <div style={styles.cardText}>Below 1.0 = competitive devaluation (boosts exports). Above 1.0 = strong currency (cheaper imports, hurts exports).</div>
                  </div>
                  <div style={styles.card}>
                    <div style={styles.cardTitle}>🚢 Tariff Rate (0–50%)</div>
                    <div style={styles.cardText}>Protects domestic industry but reduces trade volume and invites retaliation. 10–15% is generally optimal.</div>
                  </div>
                  <div style={styles.card}>
                    <div style={styles.cardTitle}>⚔️ Military Budget (1–20% GDP)</div>
                    <div style={styles.cardText}>Higher spending = stronger forces but drains economy. Post-war average 5–8%. Allocate across Army, Navy, Air Force.</div>
                  </div>
                </div>

                <h3 style={styles.h3}>For Command Economies (USSR, Communist China from 1949)</h3>
                <div style={styles.grid2}>
                  <div style={{ ...styles.card, borderLeftColor: '#dc2626' }}>
                    <div style={styles.cardTitle}>📋 Five-Year Plan Target (3–15%)</div>
                    <div style={styles.cardText}>Sets GDP growth ambition. Higher targets risk bottlenecks and shortages. Historical Soviet target: 10–12%.</div>
                  </div>
                  <div style={{ ...styles.card, borderLeftColor: '#dc2626' }}>
                    <div style={styles.cardTitle}>🏭 Heavy Industry Allocation (30–80%)</div>
                    <div style={styles.cardText}>% of resources to heavy industry vs. consumer goods. Higher = faster industrial growth, lower living standards.</div>
                  </div>
                  <div style={{ ...styles.card, borderLeftColor: '#dc2626' }}>
                    <div style={styles.cardTitle}>🌍 Trade Orientation (COMECON ↔ West)</div>
                    <div style={styles.cardText}>0 = trade only with socialist bloc. 100 = trade with Western markets. Balance affects hard-currency earnings.</div>
                  </div>
                  <div style={{ ...styles.card, borderLeftColor: '#dc2626' }}>
                    <div style={styles.cardTitle}>🏦 Gosbank Credit Rigor (40–100%)</div>
                    <div style={styles.cardText}>High = strict credit allocation, targets met but less flexibility. Low = more enterprise latitude but plan slippage.</div>
                  </div>
                </div>

                <h3 style={styles.h3}>Economic Indicators to Watch</h3>
                <ul style={styles.ul}>
                  <li><strong>GDP Growth (%)</strong> — Primary score driver. Aim for positive, sustained growth.</li>
                  <li><strong>Inflation (%)</strong> — Below 3% is ideal. Above 20% is penalized heavily. France and China start dangerously high.</li>
                  <li><strong>Unemployment (%)</strong> — Lower is better. High unemployment costs points each year.</li>
                  <li><strong>Trade Balance ($M)</strong> — Surplus scores points. Deficits hurt.</li>
                  <li><strong>Exchange Rate stability</strong> — Green = within Bretton Woods band (±1%). Yellow = pressure. Red = crisis requiring forced devaluation.</li>
                  <li><strong>Gold Reserves ($M)</strong> — Falling reserves trigger exchange rate crises (especially under gold-peg system).</li>
                </ul>
              </div>
            </>
          )}

          {/* ===== MILITARY & CRISES ===== */}
          {tab === 'military' && (
            <>
              <div style={styles.section}>
                <h2 style={styles.h2}>Crisis Events</h2>
                <p style={styles.p}>
                  Historical crises erupt during Phase 2. When a crisis appears, affected nations must choose a response.
                  Your choice has immediate economic consequences and earns diplomatic points (×2 in final scoring).
                </p>
                <ul style={styles.ul}>
                  <li>Crises show which countries are affected. If you're not listed, you don't respond.</li>
                  <li>Each option has different trade-offs: GDP impact, inflation, trade balance, unemployment.</li>
                  <li>Some options require a minimum military force to choose (e.g., "Intervene militarily" needs 500K army).</li>
                  <li>All affected players must respond before the year can advance.</li>
                  <li>A superadmin "Force Resolve" button is available if a player is stuck.</li>
                </ul>
              </div>

              <div style={styles.section}>
                <h2 style={styles.h2}>Military Conflicts</h2>
                <p style={styles.p}>
                  When rival nations deploy forces to the same region, a military conflict triggers.
                  Conflicts resolve in three stages:
                </p>

                <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
                  <div style={{ ...styles.card, borderLeftColor: '#7c3aed' }}>
                    <div style={styles.cardTitle}>Stage 1 — Diplomatic Stance</div>
                    <div style={styles.cardText}>
                      Declare your stance toward each other participating nation:
                      <br/>🤝 <strong>Ally</strong> — Coordinate military action together.
                      <br/>⚔️ <strong>Rival</strong> — Actively oppose them.
                      <br/>🤐 <strong>Neutral</strong> — Stay detached from the conflict.
                    </div>
                  </div>
                  <div style={{ ...styles.card, borderLeftColor: '#dc2626' }}>
                    <div style={styles.cardTitle}>Stage 2 — Battle Decision</div>
                    <div style={styles.cardText}>
                      Choose your military approach:
                      <br/>⚔️ <strong>Fight</strong> — Commit fully, maximize military advantage.
                      <br/>🤝 <strong>Negotiate</strong> — Seek diplomatic resolution, minimize casualties.
                      <br/>🏃 <strong>Retreat</strong> — Withdraw to preserve forces, avoid engagement.
                    </div>
                  </div>
                  <div style={{ ...styles.card, borderLeftColor: '#16a34a' }}>
                    <div style={styles.cardTitle}>Stage 3 — Battle Resolution</div>
                    <div style={styles.cardText}>
                      Outcomes are calculated from force sizes, alliances, and decisions.
                      Results show: winner, casualties per nation, and an outcome narrative (victory / stalemate / tactical win).
                      Casualties reduce your military for subsequent conflicts.
                    </div>
                  </div>
                </div>

                <h3 style={styles.h3}>Military Branch Guide</h3>
                <ul style={styles.ul}>
                  <li><strong>🪖 Army</strong> — Cheapest ($1/soldier). Ground occupation, regional control.</li>
                  <li><strong>⚓ Navy</strong> — Medium cost ($4/sailor). Trade route protection, power projection.</li>
                  <li><strong>✈️ Air Force</strong> — Most expensive ($6/airman). Strategic bombing, air superiority.</li>
                </ul>
                <p style={styles.p}>
                  Military spending drains your GDP. Keep spending proportional to your strategic goals —
                  a large army makes sense for USSR and USA; smaller nations should focus on economic growth.
                </p>
              </div>
            </>
          )}

          {/* ===== SCORING ===== */}
          {tab === 'scoring' && (
            <>
              <div style={styles.section}>
                <h2 style={styles.h2}>How Points Are Calculated</h2>
                <p style={styles.p}>Points accumulate across both phases. The highest total after 1952 wins.</p>

                <h3 style={styles.h3}>Phase 1 (Conference Voting)</h3>
                <p style={styles.p}>
                  Each round awards points based on how well the winning outcome aligns with your national interest.
                  Votes that pass your preferred policy option score more than losing votes.
                </p>

                <h3 style={styles.h3}>Phase 2 (Annual, 7 years)</h3>
                <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
                  {[
                    { label: 'GDP Growth', desc: '+15 pts per % of growth. Negative growth penalizes. This is the primary score driver.', color: 'green' },
                    { label: 'Inflation Control', desc: 'Under 3%: +30 pts. Under 5%: +20 pts. Under 10%: +10 pts. Over 20%: −15 pts (hyperinflation penalty).', color: 'green' },
                    { label: 'Employment', desc: 'Under 3%: +20 pts. Under 5%: +15 pts. Under 8%: +8 pts. Over 15%: −10 pts.', color: 'green' },
                    { label: 'Trade Balance', desc: 'Positive surplus: points proportional to size. Deficits subtract points.', color: 'blue' },
                    { label: 'Stability Bonus', desc: 'Awarded for maintaining stable macroeconomic conditions across multiple years.', color: 'blue' },
                    { label: 'Crisis Diplomacy', desc: 'Diplomatic points earned from crisis responses count ×2 in final scoring. High-risk options often earn more.', color: 'yellow' },
                    { label: 'Bretton Woods Cooperation', desc: 'Bonus for aligning your policies with the Conference decisions made in Phase 1.', color: 'yellow' },
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '10px 14px', background: '#f8fafc', borderRadius: '8px' }}>
                      <span style={styles.badge(item.color)}>{item.label}</span>
                      <span style={{ color: '#475569', fontSize: '0.88rem' }}>{item.desc}</span>
                    </div>
                  ))}
                </div>

                <h3 style={styles.h3}>Tips for Winning</h3>
                <ul style={styles.ul}>
                  <li><strong>Phase 1:</strong> Know your national position before voting. Coordinating with allies earns more points than voting alone.</li>
                  <li><strong>Phase 2 economy:</strong> A 3–5% interest rate, 10–15% tariff, and stable exchange rate is the baseline starting point for most nations.</li>
                  <li><strong>Inflation first:</strong> France and China start with very high inflation — prioritize stabilization before chasing growth.</li>
                  <li><strong>Military balance:</strong> Overspend on the military and your GDP suffers. Underspend and you're vulnerable in conflicts. 5–8% GDP is the post-war norm.</li>
                  <li><strong>Crisis responses:</strong> Higher-risk responses often carry more diplomatic points (×2 multiplier). Don't always play it safe.</li>
                  <li><strong>USSR strategy:</strong> Command economy targets of 10–12% growth with 65–70% heavy industry allocation mirror historical Soviet performance.</li>
                </ul>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
