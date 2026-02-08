const styles = window.SharedStyles;

function BattleHistoryPanel({ battles, gameYear }) {
  return (
    <div style={styles.historyPanel}>
      <h3>⚔️ Battle History - Year {gameYear}</h3>

      {battles.length === 0 ? (
        <p style={styles.noBattles}>No battles this year. Peaceful times...</p>
      ) : (
        <div style={styles.battlesList}>
          {battles.map((battle, idx) => (
            <div key={idx} style={styles.battleHistoryItem}>
              <div style={styles.battleRegion}>
                <strong>{battle.region}</strong>
                <span style={styles.battleOutcome}>
                  {battle.winner ? `${battle.winner} Victory` : 'Pending'}
                </span>
              </div>
              <div style={styles.battleDetails}>
                <span>{battle.country1} ({battle.country1_troops.toLocaleString()}) vs </span>
                <span>{battle.country2} ({battle.country2_troops.toLocaleString()})</span>
              </div>
              {battle.winner && (
                <div style={styles.battleOutcomeDetail}>
                  Casualties: {battle.country1_casualties} vs {battle.country2_casualties}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

window.BattleHistoryPanel = BattleHistoryPanel;
