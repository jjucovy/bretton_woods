// PreGameQuiz Component
// Shown to players after game starts (Phase 1 voting begins) but before they can vote.
// Props: { socket, playerId, onComplete }

const PreGameQuiz = ({ socket, playerId, onComplete }) => {
  const { useState, useEffect } = React;

  const questions = [
    {
      id: 1,
      text: 'In what year did the Bretton Woods Conference take place?',
      options: { a: '1939', b: '1944', c: '1948', d: '1952' },
      correct: 'b',
      explanation: 'The Bretton Woods Conference was held in July 1944 at the Mount Washington Hotel in New Hampshire, near the end of World War II.'
    },
    {
      id: 2,
      text: 'Where was the Bretton Woods Conference held?',
      options: { a: 'Washington DC', b: 'London', c: 'Bretton Woods, New Hampshire', d: 'Geneva' },
      correct: 'c',
      explanation: 'The conference was held at the Mount Washington Hotel in Bretton Woods, New Hampshire, USA.'
    },
    {
      id: 3,
      text: 'What was the name of the supranational currency proposed by John Maynard Keynes at the conference?',
      options: { a: 'Sterling Standard', b: 'Bancor', c: 'Globo', d: 'Econom' },
      correct: 'b',
      explanation: 'Keynes proposed the "Bancor" as an international reserve currency to balance trade. The US rejected this idea in favor of the USD as reserve currency.'
    },
    {
      id: 4,
      text: 'Under the Bretton Woods system, the US dollar was convertible to gold at what rate?',
      options: { a: '$20/oz', b: '$25/oz', c: '$35/oz', d: '$45/oz' },
      correct: 'c',
      explanation: 'The USD was pegged to gold at $35 per troy ounce. Other currencies were then pegged to the USD, creating a stable exchange rate system.'
    },
    {
      id: 5,
      text: 'Which institution was created specifically to stabilize exchange rates and provide short-term loans to countries with balance of payments problems?',
      options: { a: 'World Bank', b: 'IMF', c: 'WTO', d: 'GATT' },
      correct: 'b',
      explanation: 'The International Monetary Fund (IMF) was created at Bretton Woods to oversee the international monetary system and provide short-term stabilization loans.'
    },
    {
      id: 6,
      text: 'Which institution was created to provide long-term loans for post-war reconstruction and development?',
      options: { a: 'IMF', b: 'BIS', c: 'World Bank', d: 'GATT' },
      correct: 'c',
      explanation: 'The World Bank (International Bank for Reconstruction and Development) was established to fund long-term reconstruction of war-torn nations and development projects.'
    },
    {
      id: 7,
      text: 'The Bretton Woods system effectively collapsed when:',
      options: {
        a: 'The UK devalued the pound in 1967',
        b: 'The Korean War began in 1950',
        c: 'Nixon suspended gold convertibility in 1971',
        d: 'The OPEC oil shock occurred in 1973'
      },
      correct: 'c',
      explanation: 'On August 15, 1971 ("Nixon Shock"), President Nixon unilaterally suspended the convertibility of USD to gold, effectively ending the Bretton Woods fixed exchange rate system.'
    },
    {
      id: 8,
      text: 'IMF voting power is primarily based on:',
      options: {
        a: 'Population',
        b: 'Military strength',
        c: 'Economic size and quota contribution',
        d: 'Equal votes per country'
      },
      correct: 'c',
      explanation: 'IMF voting rights are weighted by member quotas, which are based on economic size (GDP, trade volumes, reserves). This means wealthier countries have more voting power.'
    },
    {
      id: 9,
      text: 'GDP (Gross Domestic Product) measures:',
      options: {
        a: 'Government debt level',
        b: 'Total value of goods and services produced',
        c: 'Inflation rate',
        d: 'Trade surplus'
      },
      correct: 'b',
      explanation: 'GDP measures the total monetary value of all goods and services produced within a country\'s borders in a specific time period. It is the primary indicator of economic size.'
    },
    {
      id: 10,
      text: 'Inflation is best defined as:',
      options: {
        a: 'Rising unemployment',
        b: 'A general increase in price levels over time',
        c: 'Falling GDP growth',
        d: 'Trade deficit widening'
      },
      correct: 'b',
      explanation: 'Inflation refers to the sustained increase in the general price level of goods and services, which erodes purchasing power. It is typically measured by indices like the CPI.'
    },
    {
      id: 11,
      text: 'A trade deficit occurs when:',
      options: {
        a: 'Exports exceed imports',
        b: 'Imports exceed exports',
        c: 'The budget runs a surplus',
        d: 'The currency appreciates sharply'
      },
      correct: 'b',
      explanation: 'A trade deficit (negative trade balance) means a country imports more goods and services than it exports. The US ran persistent trade deficits in the late Bretton Woods era, straining the system.'
    },
    {
      id: 12,
      text: 'Raising interest rates typically:',
      options: {
        a: 'Stimulates more inflation',
        b: 'Increases employment quickly',
        c: 'Reduces inflation and slows growth',
        d: 'Strengthens exports'
      },
      correct: 'c',
      explanation: 'Higher interest rates make borrowing more expensive, reducing consumer spending and business investment. This cools demand-driven inflation but can also slow economic growth and raise unemployment.'
    },
    {
      id: 13,
      text: 'When a country\'s currency appreciates in value, it makes:',
      options: {
        a: 'Exports cheaper and imports more expensive',
        b: 'Exports more expensive and imports cheaper',
        c: 'Both exports and imports cheaper',
        d: 'No effect on trade'
      },
      correct: 'b',
      explanation: 'Currency appreciation means foreign buyers pay more for your exports (hurting competitiveness) while domestic buyers pay less for foreign goods (boosting imports). This tends to worsen the trade balance.'
    },
    {
      id: 14,
      text: 'Fiscal policy refers to:',
      options: {
        a: 'Central bank interest rate decisions',
        b: 'Government spending and taxation decisions',
        c: 'Exchange rate management',
        d: 'Trade tariff setting'
      },
      correct: 'b',
      explanation: 'Fiscal policy involves government decisions on taxation and spending to influence the economy. Expansionary fiscal policy (more spending, less taxes) stimulates growth; contractionary policy does the opposite.'
    },
    {
      id: 15,
      text: 'Monetary policy is primarily conducted by:',
      options: {
        a: 'Parliament',
        b: 'The Treasury Department',
        c: 'The Central Bank',
        d: 'International institutions'
      },
      correct: 'c',
      explanation: 'The central bank (e.g., the Federal Reserve in the US) controls monetary policy through setting interest rates, controlling money supply, and other tools. It is typically independent from elected government.'
    },
    {
      id: 16,
      text: 'The Marshall Plan (1948) primarily aimed to:',
      options: {
        a: 'Rebuild European economies destroyed by WWII',
        b: 'Establish the NATO military alliance',
        c: 'Create the United Nations',
        d: 'Decolonize Asia and Africa'
      },
      correct: 'a',
      explanation: 'The Marshall Plan (officially the European Recovery Program) provided over $13 billion in US economic aid to rebuild Western European economies after WWII. It also aimed to prevent the spread of communism.'
    },
    {
      id: 17,
      text: 'Hyperinflation is characterized by:',
      options: {
        a: 'Price increases of 1-5% annually',
        b: 'Extreme rapid price increases (50%+ per month)',
        c: 'Steadily falling prices',
        d: 'Stable exchange rate collapse'
      },
      correct: 'b',
      explanation: 'Hyperinflation typically refers to inflation exceeding 50% per month. Famous examples include Weimar Germany (1923) and Zimbabwe (2000s), where money became nearly worthless within months.'
    },
    {
      id: 18,
      text: 'A fixed exchange rate system requires:',
      options: {
        a: 'The currency floats freely with market forces',
        b: 'Maintaining currency convertibility at a fixed rate',
        c: 'Adopting a foreign currency entirely',
        d: 'Eliminating all trade barriers'
      },
      correct: 'b',
      explanation: 'A fixed exchange rate requires a government or central bank to buy and sell its currency as needed to maintain the official peg. This demands sufficient foreign reserves and can constrain domestic monetary policy.'
    },
    {
      id: 19,
      text: 'The "Triffin Dilemma" refers to:',
      options: {
        a: 'The tension between national monetary policy and global reserve currency needs',
        b: 'The fixed vs. floating exchange rate debate',
        c: 'IMF voting power inequality',
        d: 'Trade deficits causing military conflict'
      },
      correct: 'a',
      explanation: 'Economist Robert Triffin observed that the US dollar\'s role as global reserve currency required the US to run trade deficits to supply dollars worldwide, but those deficits undermined confidence in the dollar\'s gold backing — a fundamental contradiction.'
    },
    {
      id: 20,
      text: 'Special Drawing Rights (SDRs) are:',
      options: {
        a: 'IMF membership fees',
        b: 'World Bank development loans',
        c: 'A supplementary reserve asset created by the IMF',
        d: 'Fixed exchange rate pegs'
      },
      correct: 'c',
      explanation: 'SDRs are an international reserve asset created by the IMF in 1969 to supplement member countries\' official reserves. Their value is based on a basket of major currencies (USD, EUR, CNY, JPY, GBP).'
    }
  ];

  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [quizCompleted, setQuizCompleted] = useState(false);

  useEffect(() => {
    if (socket) {
      const handleQuizCompleted = () => {
        setQuizCompleted(true);
        if (onComplete) onComplete();
      };
      socket.on('quizCompleted', handleQuizCompleted);
      return () => socket.off('quizCompleted', handleQuizCompleted);
    }
  }, [socket, onComplete]);

  const selectAnswer = (questionId, option) => {
    if (submitted) return;
    setAnswers(prev => ({ ...prev, [questionId]: option }));
  };

  const allAnswered = questions.every(q => answers[q.id] !== undefined);

  const handleSubmit = () => {
    const calculatedScore = questions.reduce((acc, q) => {
      return acc + (answers[q.id] === q.correct ? 1 : 0);
    }, 0);
    setScore(calculatedScore);
    setSubmitted(true);

    if (socket) {
      socket.emit('submitPreGameQuiz', {
        playerId,
        answers: Object.fromEntries(
          Object.entries(answers).map(([k, v]) => [k, v])
        ),
        score: calculatedScore,
        total: 20
      });
    }
  };

  const handleContinue = () => {
    if (onComplete) onComplete();
  };

  const answeredCount = Object.keys(answers).length;
  const progressPct = (answeredCount / questions.length) * 100;

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
      background: 'linear-gradient(90deg, #2563eb, #0891b2)',
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
      color: '#2563eb',
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
    optionBtn: (selected, correct, wrong, submitted, isCorrect) => {
      let bg = '#ffffff';
      let border = '1.5px solid #cbd5e1';
      let color = '#374151';
      let cursor = submitted ? 'default' : 'pointer';

      if (submitted) {
        if (isCorrect) {
          bg = '#dcfce7'; border = '1.5px solid #16a34a'; color = '#14532d';
        } else if (selected && wrong) {
          bg = '#fee2e2'; border = '1.5px solid #dc2626'; color = '#7f1d1d';
        } else if (selected) {
          bg = '#dbeafe'; border = '1.5px solid #2563eb'; color = '#1e3a8a';
        }
      } else if (selected) {
        bg = '#dbeafe'; border = '1.5px solid #2563eb'; color = '#1e3a8a';
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
      background: '#eff6ff',
      borderLeft: '3px solid #2563eb',
      borderRadius: '0 6px 6px 0',
      fontSize: '0.85rem',
      color: '#1e40af',
      lineHeight: '1.5'
    },
    submitBtn: {
      display: 'block',
      width: '100%',
      padding: '14px',
      background: allAnswered ? 'linear-gradient(135deg, #2563eb, #0891b2)' : '#94a3b8',
      color: '#ffffff',
      border: 'none',
      borderRadius: '10px',
      fontSize: '1rem',
      fontWeight: '600',
      cursor: allAnswered ? 'pointer' : 'not-allowed',
      marginTop: '8px',
      transition: 'all 0.2s ease'
    },
    scorePanel: {
      textAlign: 'center',
      padding: '24px',
      background: score >= 16 ? '#dcfce7' : score >= 12 ? '#fef9c3' : '#fee2e2',
      borderRadius: '12px',
      marginBottom: '24px'
    },
    scoreBig: {
      fontSize: '3rem',
      fontWeight: '800',
      color: score >= 16 ? '#16a34a' : score >= 12 ? '#ca8a04' : '#dc2626',
      margin: '0'
    },
    scoreLabel: {
      fontSize: '1rem',
      color: '#475569',
      margin: '4px 0 0 0'
    },
    continueBtn: {
      display: 'block',
      width: '100%',
      padding: '14px',
      background: 'linear-gradient(135deg, #16a34a, #0891b2)',
      color: '#ffffff',
      border: 'none',
      borderRadius: '10px',
      fontSize: '1rem',
      fontWeight: '600',
      cursor: 'pointer',
      marginTop: '20px',
      transition: 'all 0.2s ease'
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h2 style={styles.title}>Pre-Game Knowledge Quiz</h2>
          <p style={styles.subtitle}>
            Test your knowledge of Bretton Woods history and macroeconomics before voting begins.
            Answer all 20 questions to unlock the game — your score won't affect voting power!
          </p>
          <div style={styles.progressBar}>
            <div style={styles.progressFill}></div>
          </div>
          <div style={styles.progressText}>{answeredCount} of {questions.length} answered</div>
        </div>

        {submitted && (
          <div style={styles.scorePanel}>
            <p style={styles.scoreBig}>{score}/20</p>
            <p style={styles.scoreLabel}>
              {score >= 16 ? 'Excellent work!' : score >= 12 ? 'Good effort!' : 'Keep learning!'}
            </p>
          </div>
        )}

        {questions.map((q) => {
          const selected = answers[q.id];
          const isWrong = submitted && selected && selected !== q.correct;

          return (
            <div key={q.id} style={styles.questionBlock}>
              <div style={styles.questionNumber}>Question {q.id} of 20</div>
              <div style={styles.questionText}>{q.text}</div>
              <div style={styles.optionsGrid}>
                {Object.entries(q.options).map(([letter, text]) => {
                  const isSelected = selected === letter;
                  const isCorrectOpt = q.correct === letter;
                  const isWrongOpt = submitted && isSelected && !isCorrectOpt;

                  return (
                    <button
                      key={letter}
                      style={styles.optionBtn(isSelected, isCorrectOpt, isWrongOpt, submitted, isCorrectOpt && submitted)}
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
              {submitted && isWrong && (
                <div style={styles.explanation}>
                  <strong>Explanation:</strong> {q.explanation}
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
            {allAnswered ? 'Submit Quiz' : `Answer all questions to submit (${answeredCount}/20 done)`}
          </button>
        ) : (
          <button style={styles.continueBtn} onClick={handleContinue}>
            Continue to Game →
          </button>
        )}
      </div>
    </div>
  );
};

window.PreGameQuiz = PreGameQuiz;
