const { useState, useEffect } = React;
const styles = window.SharedStyles;

function YearEndBattlePhase({
  gameCode,
  gameYear,
  currentCountry,
  allPlayers,
  onPhaseProgress,
  socket
}) {
  const [pendingBattles, setPendingBattles] = React.useState([]);
  const [battleResults, setBattleResults] = React.useState([]);
  const [submittedDecisions, setSubmittedDecisions] = React.useState(new Set());
  const [selectedBattle, setSelectedBattle] = React.useState(null);
  const [proposals, setProposals] = React.useState([]);

  React.useEffect(() => {
    // Load pending battles for this year
    socket.emit('getPendingBattles', { gameCode, year: gameYear });
  }, [gameYear]);

  React.useEffect(() => {
    // Listen for battle events
    socket.on('battlesDetected', (data) => {
      setPendingBattles(data.battles);
    });

    socket.on('battleDecisionSubmitted', (data) => {
      setSubmittedDecisions(prev => new Set([...prev, data.battleId]));
    });

    socket.on('battleResolved', (data) => {
      setBattleResults(prev => [...prev, data]);
      setPendingBattles(prev => prev.filter(b => b.battle_id !== data.battleId));
    });

    socket.on('allianceProposed', (data) => {
      setProposals(prev => [...prev, data]);
    });

    return () => {
      socket.off('battlesDetected');
      socket.off('battleDecisionSubmitted');
      socket.off('battleResolved');
      socket.off('allianceProposed');
    };
  }, [socket]);

  const handleBattleDecision = (battle, decision, strategy) => {
    socket.emit('submitBattleDecision', {
      battleId: battle.battle_id,
      gameCode,
      country: currentCountry,
      decision,
      strategy
    });
    setSelectedBattle(null);
  };

  const handleAllianceAccept = (allianceId) => {
    socket.emit('respondToAlliance', {
      allianceId,
      gameCode,
      response: 'ACCEPTED'
    });
  };

  const handleAllianceReject = (allianceId) => {
    socket.emit('respondToAlliance', {
      allianceId,
      gameCode,
      response: 'REJECTED'
    });
  };

  return (
    <div style={styles.battlePhaseContainer}>
      <h2>⚔️ Year {gameYear} - Military Phase</h2>

      {proposals.length > 0 && (
        <div style={styles.section}>
          <h3>Alliance Proposals</h3>
          {proposals.map(p => (
            <AllianceProposalModal
              key={p.allianceId}
              proposal={p}
              country={currentCountry}
              onAccept={handleAllianceAccept}
              onReject={handleAllianceReject}
              onCancel={() => setProposals(prev => prev.filter(x => x.allianceId !== p.allianceId))}
            />
          ))}
        </div>
      )}

      {pendingBattles.length > 0 && (
        <div style={styles.section}>
          <h3>⚔️ Pending Battles ({pendingBattles.length})</h3>
          <p>Make your battle decisions:</p>
          {pendingBattles.map(battle => {
            const isYourBattle =
              (battle.country1 === currentCountry || battle.country2 === currentCountry);

            return (
              <div key={battle.battle_id} style={styles.pendingBattleCard}>
                <div style={styles.pendingBattleInfo}>
                  <strong>{battle.region}</strong>
                  <p>{battle.country1} vs {battle.country2}</p>
                </div>
                {isYourBattle && !submittedDecisions.has(battle.battle_id) && (
                  <button
                    onClick={() => setSelectedBattle(battle)}
                    style={styles.decideButton}
                  >
                    Make Decision
                  </button>
                )}
                {submittedDecisions.has(battle.battle_id) && (
                  <span style={styles.submitted}>✓ Decision Submitted</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedBattle && (
        <BattleDecisionModal
          battle={selectedBattle}
          country={currentCountry}
          onSubmit={(data) => handleBattleDecision(selectedBattle, data.decision, data.strategy)}
          onCancel={() => setSelectedBattle(null)}
        />
      )}

      {battleResults.length > 0 && (
        <div style={styles.section}>
          <h3>✓ Battle Results</h3>
          {battleResults.map((result, idx) => (
            <BattleResultsCard key={idx} battle={result} />
          ))}
        </div>
      )}

      <BattleHistoryPanel battles={[...pendingBattles, ...battleResults]} gameYear={gameYear} />

      {pendingBattles.every(b => submittedDecisions.has(b.battle_id)) && pendingBattles.length > 0 && (
        <button
          onClick={onPhaseProgress}
          style={styles.continueButton}
        >
          Continue to Next Phase
        </button>
      )}
    </div>
  );
}

window.YearEndBattlePhase = YearEndBattlePhase;
