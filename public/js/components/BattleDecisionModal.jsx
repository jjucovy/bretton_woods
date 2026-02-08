const { useState } = React;
const styles = window.SharedStyles;

function BattleDecisionModal({ battle, country, onSubmit, onCancel }) {
  const [decision, setDecision] = React.useState(null);
  const [strategy, setStrategy] = React.useState('BALANCED');

  const decisions = [
    {
      value: 'FIGHT',
      label: '⚔️ FIGHT',
      description: 'Engage in combat. Higher casualties but territorial control possible.'
    },
    {
      value: 'NEGOTIATE',
      label: '🤝 NEGOTIATE',
      description: 'Propose peaceful settlement. 50/50 split, light casualties.'
    },
    {
      value: 'RETREAT',
      label: '🏃 RETREAT',
      description: 'Withdraw from region. Avoid casualties but lose territory.'
    }
  ];

  const strategies = [
    { value: 'AGGRESSIVE', label: '💪 Aggressive', bonus: '+50% Damage' },
    { value: 'DEFENSIVE', label: '🛡️ Defensive', bonus: '-40% Damage Taken' },
    { value: 'BALANCED', label: '⚖️ Balanced', bonus: 'Moderate Stats' }
  ];

  const handleSubmit = () => {
    if (!decision) {
      console.error('Please select a decision');
      return;
    }
    onSubmit({ decision, strategy });
  };

  return (
    <div style={styles.modal}>
      <div style={styles.modalContent}>
        <h2>⚔️ Battle Decision - {battle.region}</h2>

        <div style={styles.battleInfo}>
          <div style={styles.side}>
            <h3>{battle.country1}</h3>
            <p>Troops: {battle.country1_troops.toLocaleString()}</p>
          </div>
          <div style={styles.vs}>VS</div>
          <div style={styles.side}>
            <h3>{battle.country2}</h3>
            <p>Troops: {battle.country2_troops.toLocaleString()}</p>
          </div>
        </div>

        <div style={styles.section}>
          <h3>Your Decision</h3>
          <div style={styles.decisionGrid}>
            {decisions.map(d => (
              <button
                key={d.value}
                onClick={() => setDecision(d.value)}
                style={{
                  ...styles.decisionButton,
                  ...(decision === d.value ? styles.decisionButtonActive : {})
                }}
              >
                <div>{d.label}</div>
                <small>{d.description}</small>
              </button>
            ))}
          </div>
        </div>

        {decision === 'FIGHT' && (
          <div style={styles.section}>
            <h3>Battle Strategy (If Fighting)</h3>
            <div style={styles.strategyGrid}>
              {strategies.map(s => (
                <button
                  key={s.value}
                  onClick={() => setStrategy(s.value)}
                  style={{
                    ...styles.strategyButton,
                    ...(strategy === s.value ? styles.strategyButtonActive : {})
                  }}
                >
                  <div>{s.label}</div>
                  <small>{s.bonus}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={styles.actions}>
          <button
            onClick={handleSubmit}
            style={styles.submitButton}
          >
            Submit Decision
          </button>
          <button
            onClick={onCancel}
            style={styles.cancelButton}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

window.BattleDecisionModal = BattleDecisionModal;
