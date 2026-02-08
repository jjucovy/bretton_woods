const styles = window.SharedStyles;

function BattleResultsCard({ battle }) {
  const getResultIcon = () => {
    if (battle.winner === battle.country1) return '🥇';
    if (battle.winner === battle.country2) return '🥇';
    return '🤝';
  };

  const getResultText = () => {
    if (battle.outcome === 'NEGOTIATE') return 'NEGOTIATED SETTLEMENT';
    if (battle.outcome === 'DRAW') return 'STALEMATE';
    return `${battle.winner} VICTORY`;
  };

  return (
    <div style={styles.resultCard}>
      <div style={styles.resultHeader}>
        <h3>{battle.region} - {getResultIcon()} {getResultText()}</h3>
      </div>

      <div style={styles.resultGrid}>
        <div style={styles.resultColumn}>
          <h4>{battle.country1}</h4>
          <div style={styles.resultStat}>
            <label>Casualties:</label>
            <span style={styles.casualty}>{battle.country1_casualties.toLocaleString()}</span>
          </div>
          <div style={styles.resultStat}>
            <label>Economic Damage:</label>
            <span style={styles.damage}>${(battle.economic_damage_country1 / 1000000000).toFixed(1)}B</span>
          </div>
          {battle.winner === battle.country1 && (
            <div style={styles.resultStat}>
              <span style={styles.victory}>✓ Territory Secured</span>
            </div>
          )}
        </div>

        <div style={styles.divider}></div>

        <div style={styles.resultColumn}>
          <h4>{battle.country2}</h4>
          <div style={styles.resultStat}>
            <label>Casualties:</label>
            <span style={styles.casualty}>{battle.country2_casualties.toLocaleString()}</span>
          </div>
          <div style={styles.resultStat}>
            <label>Economic Damage:</label>
            <span style={styles.damage}>${(battle.economic_damage_country2 / 1000000000).toFixed(1)}B</span>
          </div>
          {battle.winner === battle.country2 && (
            <div style={styles.resultStat}>
              <span style={styles.victory}>✓ Territory Secured</span>
            </div>
          )}
        </div>
      </div>

      <div style={styles.resultPoints}>
        <strong>Points Awarded: +{battle.pointsAwarded}</strong>
      </div>
    </div>
  );
}

window.BattleResultsCard = BattleResultsCard;
