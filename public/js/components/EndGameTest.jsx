// EndGameTest Component
// 10-question end-of-game assessment shown when gamePhase === 'complete' before final scores are revealed.
// Props: { socket, playerId, onComplete }

const EndGameTest = ({ socket, playerId, onComplete }) => {
  const { useState, useEffect } = React;

  const questions = [
    {
      id: 1,
      text: 'Under the Bretton Woods system, which country\'s currency served as the global reserve currency?',
      options: { a: 'United Kingdom (GBP)', b: 'United States (USD)', c: 'France (Franc)', d: 'Germany (Deutschmark)' },
      correct: 'b',
      explanation: 'The US dollar was chosen as the reserve currency because the US held the majority of the world\'s gold reserves and had the largest economy after WWII. All other currencies were pegged to the USD, which was in turn pegged to gold at $35/oz.'
    },
    {
      id: 2,
      text: 'The Plaza Accord (1985) was an agreement among major economies to:',
      options: {
        a: 'Establish the Euro as a common European currency',
        b: 'Coordinated depreciation of the US dollar against other currencies',
        c: 'Create the World Trade Organization',
        d: 'Set OPEC oil pricing benchmarks'
      },
      correct: 'b',
      explanation: 'The Plaza Accord (signed at the Plaza Hotel, New York) was an agreement between the G5 nations (USA, UK, France, West Germany, Japan) to intervene in currency markets to depreciate the overvalued US dollar, which was hurting US exports and manufacturing.'
    },
    {
      id: 3,
      text: 'In a command economy, resource allocation is primarily determined by:',
      options: {
        a: 'Central government planning',
        b: 'Market prices and supply/demand',
        c: 'Consumer demand signals',
        d: 'International trade agreements'
      },
      correct: 'a',
      explanation: 'In a command (planned) economy, the government centrally decides what to produce, how to produce it, and how to distribute it. The Soviet bloc nations operated command economies during the Cold War era of Bretton Woods.'
    },
    {
      id: 4,
      text: 'The Korean War (1950–1953) primarily affected post-WWII economics by:',
      options: {
        a: 'Causing European hyperinflation',
        b: 'Triggering a massive US military spending surge',
        c: 'Ending the Marshall Plan prematurely',
        d: 'Causing the IMF to collapse'
      },
      correct: 'b',
      explanation: 'The Korean War triggered a dramatic surge in US defense spending, from about $13 billion in 1950 to $50 billion by 1953. This military Keynesianism paradoxically boosted US and allied economies, but also began the cycle of deficit spending that would eventually strain the Bretton Woods gold peg.'
    },
    {
      id: 5,
      text: 'If a country runs persistent trade surpluses under the Bretton Woods system, it would typically:',
      options: {
        a: 'Automatically devalue its currency',
        b: 'Accumulate gold and dollar reserves',
        c: 'Join COMECON',
        d: 'Receive emergency IMF loans'
      },
      correct: 'b',
      explanation: 'Under Bretton Woods, surplus countries (like West Germany and Japan in the 1960s) accumulated dollars and gold as other nations paid for their exports. This created imbalances: surplus nations held excess reserves while deficit nations (primarily the US) depleted theirs, contributing to the system\'s eventual collapse.'
    },
    {
      id: 6,
      text: 'High tariffs protect domestic industries but also tend to:',
      options: {
        a: 'Boost all exports and improve the trade balance',
        b: 'Raise consumer prices and invite retaliation from trading partners',
        c: 'Strengthen the domestic currency',
        d: 'Reduce inflation by limiting import costs'
      },
      correct: 'b',
      explanation: 'Tariffs raise prices for consumers and downstream industries that use imported inputs. They also often provoke retaliatory tariffs from trading partners, potentially starting trade wars that reduce overall welfare for all parties. This was a key lesson from the destructive Smoot-Hawley tariffs of the 1930s.'
    },
    {
      id: 7,
      text: 'The Marshall Plan was primarily funded by:',
      options: {
        a: 'The United States',
        b: 'The United Kingdom',
        c: 'The International Monetary Fund',
        d: 'All Allied nations contributing equally'
      },
      correct: 'a',
      explanation: 'The Marshall Plan (1948–1952) was an American initiative. The US provided approximately $13.3 billion (roughly $140 billion in today\'s dollars) to rebuild Western European economies. It was partly humanitarian and partly strategic — preventing the spread of communism to economically devastated nations.'
    },
    {
      id: 8,
      text: 'Cold War military spending in the 1950s primarily caused:',
      options: {
        a: 'Rapid deflation across Western economies',
        b: 'Higher government debt and crowded out social investment',
        c: 'Currency appreciation in NATO member states',
        d: 'Persistent trade surpluses for the US'
      },
      correct: 'b',
      explanation: 'Massive defense spending during the Cold War increased government debt and competed with social programs like healthcare, education, and infrastructure. The US running deficits to fund both the military and the Marshall Plan flooded the world with dollars, eventually creating more claims on US gold than the US could honor at $35/oz.'
    },
    {
      id: 9,
      text: 'COMECON (the Council for Mutual Economic Assistance) was:',
      options: {
        a: 'A NATO financial arm for Western rearmament',
        b: 'A Soviet-led economic cooperation bloc for Eastern Europe',
        c: 'A World Bank affiliate for Asian development',
        d: 'An Asian free trade agreement'
      },
      correct: 'b',
      explanation: 'COMECON (1949–1991) was the Soviet-led counterpart to Western economic integration. It coordinated economic planning among USSR, Poland, East Germany, Czechoslovakia, Hungary, Romania, Bulgaria, and others — operating largely outside the Bretton Woods dollar system.'
    },
    {
      id: 10,
      text: 'The primary lesson of the Bretton Woods era for international economics is:',
      options: {
        a: 'A gold standard always provides the most stability',
        b: 'International monetary coordination stabilizes exchange rates but requires sustained political will',
        c: 'Freely floating exchange rates cause less volatility than fixed systems',
        d: 'Persistent trade deficits always eventually cause military conflict'
      },
      correct: 'b',
      explanation: 'Bretton Woods demonstrated both the power and fragility of international economic cooperation. Fixed exchange rates provided 25+ years of stable growth, but the system required countries — especially the US — to subordinate domestic policy goals to international commitments. When political will eroded (US spending on Vietnam, Great Society, and mounting deficits), the system collapsed. This tension between national sovereignty and international stability remains central to global economics today.'
    }
  ];

  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  const selectAnswer = (questionId, option) => {
    if (submitted) return;
    setAnswers(prev => ({ ...prev, [questionId]: option }));
  };

  const allAnswered = questions.every(q => answers[q.id] !== undefined);
  const answeredCount = Object.keys(answers).length;
  const progressPct = (answeredCount / questions.length) * 100;

  const handleSubmit = () => {
    const calculatedScore = questions.reduce((acc, q) => {
      return acc + (answers[q.id] === q.correct ? 1 : 0);
    }, 0);
    setScore(calculatedScore);
    setSubmitted(true);

    if (socket) {
      socket.emit('submitEndGameTest', {
        playerId,
        answers: { ...answers },
        score: calculatedScore,
        total: 10
      });
    }
  };

  const handleReveal = () => {
    if (onComplete) onComplete();
  };

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15, 23, 42, 0.85)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      zIndex: 1000,
      overflowY: 'auto',
      padding: '24px 16px'
    },
    card: {
      background: '#ffffff',
      borderRadius: '16px',
      padding: '32px',
      maxWidth: '720px',
      width: '100%',
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      marginBottom: '24px'
    },
    header: {
      marginBottom: '24px',
      borderBottom: '2px solid #e2e8f0',
      paddingBottom: '20px'
    },
    title: {
      fontSize: '1.6rem',
      fontWeight: '700',
      color: '#1e3a5f',
      margin: '0 0 8px 0'
    },
    badge: {
      display: 'inline-block',
      background: 'linear-gradient(135deg, #7c3aed, #0891b2)',
      color: '#ffffff',
      fontSize: '0.7rem',
      fontWeight: '700',
      padding: '3px 10px',
      borderRadius: '20px',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: '10px'
    },
    subtitle: {
      color: '#64748b',
      margin: '0 0 16px 0',
      fontSize: '0.95rem'
    },
    progressBar: {
      height: '8px',
      background: '#e2e8f0',
      borderRadius: '4px',
      overflow: 'hidden',
      marginBottom: '6px'
    },
    progressFill: {
      height: '100%',
      background: 'linear-gradient(90deg, #7c3aed, #0891b2)',
      borderRadius: '4px',
      transition: 'width 0.3s ease',
      width: `${progressPct}%`
    },
    progressText: {
      fontSize: '0.8rem',
      color: '#94a3b8',
      textAlign: 'right'
    },
    questionBlock: {
      marginBottom: '28px',
      padding: '20px',
      background: '#f8fafc',
      borderRadius: '12px',
      border: '1px solid #e2e8f0'
    },
    questionNumber: {
      fontSize: '0.75rem',
      fontWeight: '600',
      color: '#7c3aed',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      marginBottom: '6px'
    },
    questionText: {
      fontSize: '1rem',
      fontWeight: '600',
      color: '#1e293b',
      marginBottom: '14px',
      lineHeight: '1.5'
    },
    optionsGrid: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    },
    optionBtn: (isSelected, isCorrectOpt, isWrongOpt, showResults) => {
      let bg = '#ffffff';
      let border = '1.5px solid #cbd5e1';
      let color = '#374151';
      let cursor = showResults ? 'default' : 'pointer';

      if (showResults) {
        if (isCorrectOpt) {
          bg = '#dcfce7'; border = '1.5px solid #16a34a'; color = '#14532d';
        } else if (isWrongOpt) {
          bg = '#fee2e2'; border = '1.5px solid #dc2626'; color = '#7f1d1d';
        } else if (isSelected) {
          bg = '#ede9fe'; border = '1.5px solid #7c3aed'; color = '#4c1d95';
        }
      } else if (isSelected) {
        bg = '#ede9fe'; border = '1.5px solid #7c3aed'; color = '#4c1d95';
      }

      return {
        background: bg,
        border,
        color,
        borderRadius: '8px',
        padding: '10px 14px',
        textAlign: 'left',
        cursor,
        fontSize: '0.9rem',
        transition: 'all 0.15s ease',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '100%'
      };
    },
    optionLetter: {
      fontWeight: '700',
      minWidth: '18px',
      fontSize: '0.85rem'
    },
    explanation: {
      marginTop: '10px',
      padding: '10px 14px',
      background: '#f5f3ff',
      borderLeft: '3px solid #7c3aed',
      borderRadius: '0 6px 6px 0',
      fontSize: '0.85rem',
      color: '#4c1d95',
      lineHeight: '1.5'
    },
    scorePanel: {
      textAlign: 'center',
      padding: '24px',
      background: score >= 8 ? '#dcfce7' : score >= 6 ? '#fef9c3' : '#fee2e2',
      borderRadius: '12px',
      marginBottom: '24px',
      border: score >= 8 ? '2px solid #16a34a' : score >= 6 ? '2px solid #ca8a04' : '2px solid #dc2626'
    },
    scoreBig: {
      fontSize: '3.5rem',
      fontWeight: '800',
      color: score >= 8 ? '#16a34a' : score >= 6 ? '#ca8a04' : '#dc2626',
      margin: '0',
      lineHeight: '1'
    },
    scoreLabel: {
      fontSize: '1rem',
      color: '#475569',
      margin: '8px 0 0 0',
      fontWeight: '500'
    },
    submitBtn: {
      display: 'block',
      width: '100%',
      padding: '14px',
      background: allAnswered ? 'linear-gradient(135deg, #7c3aed, #0891b2)' : '#94a3b8',
      color: '#ffffff',
      border: 'none',
      borderRadius: '10px',
      fontSize: '1rem',
      fontWeight: '600',
      cursor: allAnswered ? 'pointer' : 'not-allowed',
      marginTop: '8px',
      transition: 'all 0.2s ease'
    },
    revealBtn: {
      display: 'block',
      width: '100%',
      padding: '16px',
      background: 'linear-gradient(135deg, #f59e0b, #dc2626)',
      color: '#ffffff',
      border: 'none',
      borderRadius: '10px',
      fontSize: '1.05rem',
      fontWeight: '700',
      cursor: 'pointer',
      marginTop: '20px',
      transition: 'all 0.2s ease',
      letterSpacing: '0.02em'
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.badge}>End of Game Assessment</div>
          <h2 style={styles.title}>Final Knowledge Test</h2>
          <p style={styles.subtitle}>
            The game is over! Before final results are revealed, complete this 10-question assessment
            on what you've learned. Answer all questions to unlock the final scores.
          </p>
          <div style={styles.progressBar}>
            <div style={styles.progressFill}></div>
          </div>
          <div style={styles.progressText}>{answeredCount} of {questions.length} answered</div>
        </div>

        {submitted && (
          <div style={styles.scorePanel}>
            <p style={styles.scoreBig}>{score}/10</p>
            <p style={styles.scoreLabel}>
              {score >= 8
                ? 'Outstanding! You have a deep grasp of Bretton Woods economics.'
                : score >= 6
                ? 'Good work! You absorbed the key lessons of the simulation.'
                : 'Keep studying! The Bretton Woods system has many layers to explore.'}
            </p>
          </div>
        )}

        {questions.map((q) => {
          const selected = answers[q.id];
          const isWrong = submitted && selected && selected !== q.correct;

          return (
            <div key={q.id} style={styles.questionBlock}>
              <div style={styles.questionNumber}>Question {q.id} of 10</div>
              <div style={styles.questionText}>{q.text}</div>
              <div style={styles.optionsGrid}>
                {Object.entries(q.options).map(([letter, text]) => {
                  const isSelected = selected === letter;
                  const isCorrectOpt = q.correct === letter;
                  const isWrongOpt = submitted && isSelected && !isCorrectOpt;

                  return (
                    <button
                      key={letter}
                      style={styles.optionBtn(isSelected, isCorrectOpt, isWrongOpt, submitted)}
                      onClick={() => selectAnswer(q.id, letter)}
                    >
                      <span style={styles.optionLetter}>{letter.toUpperCase()})</span>
                      <span>{text}</span>
                      {submitted && isCorrectOpt && <span style={{ marginLeft: 'auto' }}>✓</span>}
                      {submitted && isWrongOpt && <span style={{ marginLeft: 'auto' }}>✗</span>}
                    </button>
                  );
                })}
              </div>
              {submitted && (isWrong || answers[q.id] === q.correct) && (
                <div style={styles.explanation}>
                  <strong>{isWrong ? 'Correction:' : 'Why this is correct:'}</strong> {q.explanation}
                </div>
              )}
            </div>
          );
        })}

        {!submitted ? (
          <button
            style={styles.submitBtn}
            onClick={handleSubmit}
            disabled={!allAnswered}
          >
            {allAnswered ? 'Submit Assessment' : `Answer all questions to submit (${answeredCount}/10 done)`}
          </button>
        ) : (
          <button style={styles.revealBtn} onClick={handleReveal}>
            Reveal Final Results →
          </button>
        )}
      </div>
    </div>
  );
};

window.EndGameTest = EndGameTest;
