const { useState, useEffect } = React;

// ─── Assignment Gate ────────────────────────────────────────────────────────
// Shows a sequential series of pre-simulation assignments.
// Students must complete each one before unlocking the next.
// After all assignments are submitted, onComplete() is called.
//
// Props:
//   socket       – the socket.io socket
//   playerId     – userId of the current student
//   playerCountry – country assigned in game (may be null if not yet joined)
//   assignments  – array of assignment definitions from assignments.json
//   onComplete   – callback when all assignments done
// ────────────────────────────────────────────────────────────────────────────

function AssignmentsGate({ socket, playerId, playerCountry, assignments, onComplete, onBypass }) {
  const [progress, setProgress]   = useState({});   // { [assignmentId]: { submitted, responses, score } }
  const [activeId, setActiveId]   = useState(null);  // which assignment is open
  const [loading, setLoading]     = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizResult, setQuizResult]  = useState(null); // { score, passed, feedback }
  const [shortAnswers, setShortAnswers] = useState({});
  const [essayText, setEssayText] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [error, setError] = useState('');

  // Load progress on mount
  useEffect(() => {
    if (!playerId) return;
    socket.emit('getAssignmentProgress', { userId: playerId });
    const handler = (data) => {
      setProgress(data.progress || {});
      setLoading(false);
    };
    socket.on('assignmentProgress', handler);
    return () => socket.off('assignmentProgress', handler);
  }, [playerId]);

  // Listen for submission result
  useEffect(() => {
    const handler = (data) => {
      setSubmitting(false);
      if (data.success) {
        setProgress(prev => ({ ...prev, [data.assignmentId]: data.record }));
        setActiveId(null);
        setQuizAnswers({});
        setQuizResult(null);
        setShortAnswers({});
        setEssayText('');
        setWordCount(0);
        setError('');
      } else {
        setError(data.message || 'Submission failed. Please try again.');
      }
    };
    socket.on('assignmentSubmitted', handler);
    return () => socket.off('assignmentSubmitted', handler);
  }, []);

  const completedCount = Object.values(progress).filter(r => r && r.submitted).length;
  const totalCount     = assignments.length;

  // All done → call onComplete
  useEffect(() => {
    if (!loading && completedCount >= totalCount) {
      onComplete();
    }
  }, [completedCount, totalCount, loading]);

  // Determine which assignment is currently available
  const nextAvailable = assignments.find(a => !progress[a.id]?.submitted);

  // ─── Quiz logic ─────────────────────────────────────────────────────────
  function gradeQuiz(assignment) {
    const { questions, passingScore } = assignment;
    let score = 0;
    const feedback = questions.map(q => {
      const selected = quizAnswers[q.id];
      const correct  = selected === q.correct;
      if (correct) score++;
      return { id: q.id, selected, correct, explanation: q.explanation };
    });
    return { score, total: questions.length, passed: score >= passingScore, feedback };
  }

  function submitQuiz(assignment) {
    setError('');
    if (Object.keys(quizAnswers).length < assignment.questions.length) {
      setError('Please answer all questions before submitting.');
      return;
    }
    const result = gradeQuiz(assignment);
    setQuizResult(result);
    if (result.passed) {
      setSubmitting(true);
      socket.emit('submitAssignment', {
        userId: playerId,
        assignmentId: assignment.id,
        responses: quizAnswers,
        score: result.score,
        total: result.total
      });
    }
  }

  function retryQuiz() {
    setQuizAnswers({});
    setQuizResult(null);
    setError('');
  }

  // ─── Short answer logic ──────────────────────────────────────────────────
  function submitShortAnswer(assignment) {
    setError('');
    const unanswered = assignment.questions.filter(q => {
      const text = (shortAnswers[q.id] || '').trim();
      const wc   = text.split(/\s+/).filter(Boolean).length;
      return wc < (q.minWords || 40);
    });
    if (unanswered.length) {
      setError(`Please write at least ${unanswered[0].minWords} words for each answer.`);
      return;
    }
    setSubmitting(true);
    socket.emit('submitAssignment', {
      userId: playerId,
      assignmentId: assignment.id,
      responses: shortAnswers
    });
  }

  // ─── Essay logic ─────────────────────────────────────────────────────────
  function handleEssayChange(text) {
    setEssayText(text);
    setWordCount(text.trim().split(/\s+/).filter(Boolean).length);
  }

  function submitEssay(assignment) {
    setError('');
    const min = assignment.minWords || 150;
    if (wordCount < min) {
      setError(`Your paper must be at least ${min} words. Current: ${wordCount}.`);
      return;
    }
    setSubmitting(true);
    socket.emit('submitAssignment', {
      userId: playerId,
      assignmentId: assignment.id,
      responses: { essay: essayText }
    });
  }

  // ─── Styles ──────────────────────────────────────────────────────────────
  const S = {
    wrap: { minHeight: '100vh', background: '#f1f5f9', padding: '24px 16px' },
    container: { maxWidth: '800px', margin: '0 auto' },
    header: {
      background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a8e 100%)',
      color: 'white', borderRadius: '16px', padding: '28px 32px', marginBottom: '24px',
    },
    progressBar: { height: '8px', background: 'rgba(255,255,255,0.2)', borderRadius: '4px', marginTop: '16px' },
    progressFill: {
      height: '100%', borderRadius: '4px', background: '#34d399',
      width: `${(completedCount / totalCount) * 100}%`,
      transition: 'width 0.5s ease',
    },
    card: {
      background: 'white', borderRadius: '12px', padding: '20px 24px',
      marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      border: '2px solid #e2e8f0',
    },
    cardLocked: { opacity: 0.5, cursor: 'default' },
    cardDone: { borderColor: '#34d399', background: '#f0fdf4' },
    cardActive: { borderColor: '#3b82f6', background: '#eff6ff' },
    num: (done, active) => ({
      width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 'bold', fontSize: '0.9rem',
      background: done ? '#34d399' : active ? '#3b82f6' : '#cbd5e1',
      color: done || active ? 'white' : '#64748b',
    }),
    btn: (color) => ({
      padding: '10px 24px', borderRadius: '8px', border: 'none', cursor: 'pointer',
      fontWeight: 'bold', fontSize: '0.95rem',
      background: color === 'blue' ? '#3b82f6' : color === 'green' ? '#10b981' : color === 'gray' ? '#94a3b8' : '#ef4444',
      color: 'white',
    }),
    textarea: {
      width: '100%', minHeight: '140px', padding: '12px', borderRadius: '8px',
      border: '2px solid #e2e8f0', fontSize: '0.95rem', lineHeight: '1.6',
      fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
    },
    optionBtn: (selected) => ({
      width: '100%', textAlign: 'left', padding: '10px 14px', borderRadius: '8px',
      border: `2px solid ${selected ? '#3b82f6' : '#e2e8f0'}`,
      background: selected ? '#eff6ff' : 'white', cursor: 'pointer',
      marginBottom: '8px', fontSize: '0.92rem', color: '#1e293b',
    }),
    optionResult: (correct, selected, isCorrect) => ({
      width: '100%', textAlign: 'left', padding: '10px 14px', borderRadius: '8px',
      border: `2px solid ${isCorrect ? '#10b981' : (selected && !isCorrect) ? '#ef4444' : '#e2e8f0'}`,
      background: isCorrect ? '#f0fdf4' : (selected && !isCorrect) ? '#fef2f2' : 'white',
      marginBottom: '8px', fontSize: '0.92rem',
    }),
  };

  // ─── Render open assignment content ──────────────────────────────────────
  function renderAssignment(a) {
    if (a.type === 'quiz') {
      if (quizResult) {
        return (
          <div>
            <div style={{ textAlign: 'center', padding: '16px 0', marginBottom: '20px' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>
                {quizResult.passed ? '🎉' : '📚'}
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: quizResult.passed ? '#166534' : '#991b1b' }}>
                {quizResult.passed ? 'Passed!' : 'Not quite — try again'}
              </div>
              <div style={{ color: '#64748b', marginTop: '4px' }}>
                Score: {quizResult.score} / {quizResult.total}
                &nbsp;(passing: {a.passingScore}/{a.total || quizResult.total})
              </div>
            </div>
            {a.questions.map((q, i) => {
              const fb = quizResult.feedback[i];
              return (
                <div key={q.id} style={{ marginBottom: '20px' }}>
                  <p style={{ fontWeight: 'bold', marginBottom: '10px', color: '#1e293b' }}>
                    {i + 1}. {q.text}
                  </p>
                  {q.options.map(opt => (
                    <div key={opt.id} style={S.optionResult(fb.correct, fb.selected === opt.id, opt.id === q.correct)}>
                      {opt.id === q.correct ? '✅ ' : (fb.selected === opt.id && !fb.correct) ? '❌ ' : '   '}
                      {opt.text}
                    </div>
                  ))}
                  <div style={{ color: '#475569', fontSize: '0.87rem', padding: '8px 12px', background: '#f8fafc', borderRadius: '6px', marginTop: '4px' }}>
                    💡 {q.explanation}
                  </div>
                </div>
              );
            })}
            {!quizResult.passed && (
              <button style={S.btn('blue')} onClick={retryQuiz}>Retake Quiz</button>
            )}
            {quizResult.passed && submitting && (
              <p style={{ color: '#64748b' }}>⏳ Saving your results…</p>
            )}
          </div>
        );
      }

      return (
        <div>
          <p style={{ color: '#475569', marginBottom: '20px' }}>
            Answer all {a.questions.length} questions. You need {a.passingScore}/{a.questions.length} to pass.
          </p>
          {a.questions.map((q, i) => (
            <div key={q.id} style={{ marginBottom: '22px' }}>
              <p style={{ fontWeight: 'bold', marginBottom: '10px', color: '#1e293b' }}>
                {i + 1}. {q.text}
              </p>
              {q.options.map(opt => (
                <button
                  key={opt.id}
                  style={S.optionBtn(quizAnswers[q.id] === opt.id)}
                  onClick={() => setQuizAnswers(prev => ({ ...prev, [q.id]: opt.id }))}
                >
                  <strong style={{ marginRight: '6px' }}>{opt.id.toUpperCase()}.</strong>{opt.text}
                </button>
              ))}
            </div>
          ))}
          {error && <p style={{ color: '#dc2626', marginBottom: '12px' }}>{error}</p>}
          <button style={S.btn('blue')} onClick={() => submitQuiz(a)} disabled={submitting}>
            {submitting ? '⏳ Submitting…' : 'Submit Quiz'}
          </button>
        </div>
      );
    }

    if (a.type === 'short_answer') {
      return (
        <div>
          <p style={{ color: '#475569', marginBottom: '20px' }}>{a.description}</p>
          {a.questions.map((q, i) => {
            const text = shortAnswers[q.id] || '';
            const wc   = text.trim().split(/\s+/).filter(Boolean).length;
            return (
              <div key={q.id} style={{ marginBottom: '24px' }}>
                <p style={{ fontWeight: 'bold', marginBottom: '6px', color: '#1e293b' }}>
                  {i + 1}. {q.text}
                </p>
                <textarea
                  style={S.textarea}
                  placeholder={q.placeholder}
                  value={text}
                  onChange={(e) => setShortAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                />
                <div style={{ color: wc >= q.minWords ? '#16a34a' : '#94a3b8', fontSize: '0.82rem', marginTop: '4px' }}>
                  {wc} words {wc < q.minWords ? `(minimum: ${q.minWords})` : '✓'}
                </div>
              </div>
            );
          })}
          {error && <p style={{ color: '#dc2626', marginBottom: '12px' }}>{error}</p>}
          <button style={S.btn('blue')} onClick={() => submitShortAnswer(a)} disabled={submitting}>
            {submitting ? '⏳ Submitting…' : 'Submit Assignment'}
          </button>
        </div>
      );
    }

    if (a.type === 'essay') {
      const min = a.minWords || 150;
      const max = a.maxWords || 400;
      return (
        <div>
          <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '16px', marginBottom: '20px', borderLeft: '4px solid #3b82f6' }}>
            <p style={{ margin: 0, color: '#1e293b', fontStyle: 'italic', lineHeight: '1.7', whiteSpace: 'pre-line' }}>
              {a.prompt}
            </p>
          </div>
          {playerCountry && (
            <div style={{ background: '#eff6ff', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '0.9rem', color: '#1d4ed8' }}>
              📌 You are representing: <strong>{playerCountry}</strong>
            </div>
          )}
          <textarea
            style={{ ...S.textarea, minHeight: '220px' }}
            placeholder="Write your position paper here…"
            value={essayText}
            onChange={(e) => handleEssayChange(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ color: wordCount >= min ? '#16a34a' : '#94a3b8', fontSize: '0.85rem' }}>
              {wordCount} words {wordCount >= min ? '✓' : `(minimum: ${min})`}
            </span>
            <span style={{ color: wordCount > max ? '#dc2626' : '#94a3b8', fontSize: '0.85rem' }}>
              {wordCount > max ? `Over limit! Max: ${max}` : `Maximum: ${max}`}
            </span>
          </div>
          {error && <p style={{ color: '#dc2626', marginBottom: '12px' }}>{error}</p>}
          <button style={S.btn('blue')} onClick={() => submitEssay(a)} disabled={submitting || wordCount > max}>
            {submitting ? '⏳ Submitting…' : 'Submit Position Paper'}
          </button>
        </div>
      );
    }

    return null;
  }

  // ─── Main render ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={S.wrap}>
        <div style={{ textAlign: 'center', marginTop: '80px', color: '#64748b' }}>
          Loading assignments…
        </div>
      </div>
    );
  }

  const icons = ['📖', '🗺️', '📝', '📊'];
  const typeLabels = { quiz: 'Multiple-Choice Quiz', short_answer: 'Short Answer', essay: 'Position Paper' };

  return (
    <div style={S.wrap}>
      <div style={S.container}>
        {/* Header */}
        <div style={S.header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>🌍 Bretton Woods Simulation</h1>
            {onBypass && (
              <button
                onClick={onBypass}
                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.4)', color: 'white', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
              >
                Skip →
              </button>
            )}
          </div>
          <p style={{ margin: '0 0 16px 0', opacity: 0.85 }}>
            Complete all {totalCount} pre-simulation assignments to unlock the game.
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.9rem', opacity: 0.85 }}>
              Progress: {completedCount} of {totalCount} complete
            </span>
            <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>
              {Math.round((completedCount / totalCount) * 100)}%
            </span>
          </div>
          <div style={S.progressBar}>
            <div style={S.progressFill} />
          </div>
        </div>

        {/* Assignment list */}
        {assignments.map((a, idx) => {
          const done   = !!progress[a.id]?.submitted;
          const locked = idx > 0 && !progress[assignments[idx - 1].id]?.submitted;
          const active = activeId === a.id;

          return (
            <div key={a.id}>
              <div
                style={{
                  ...S.card,
                  ...(done ? S.cardDone : {}),
                  ...(active && !done ? S.cardActive : {}),
                  ...(locked ? S.cardLocked : {}),
                }}
              >
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={S.num(done, active && !done)}>
                    {done ? '✓' : idx + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: '1rem', color: '#1e293b' }}>
                          {icons[idx]} Assignment {a.id}: {a.title}
                        </div>
                        <div style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '2px' }}>
                          {typeLabels[a.type] || a.type}
                        </div>
                      </div>
                      {done && (
                        <span style={{ background: '#dcfce7', color: '#166534', padding: '4px 12px', borderRadius: '20px', fontSize: '0.82rem', fontWeight: 'bold' }}>
                          ✓ Submitted
                        </span>
                      )}
                      {locked && (
                        <span style={{ background: '#f1f5f9', color: '#94a3b8', padding: '4px 12px', borderRadius: '20px', fontSize: '0.82rem' }}>
                          🔒 Locked
                        </span>
                      )}
                      {!done && !locked && !active && (
                        <button
                          style={S.btn('blue')}
                          onClick={() => {
                            setActiveId(a.id);
                            setQuizAnswers({});
                            setQuizResult(null);
                            setShortAnswers({});
                            setEssayText('');
                            setWordCount(0);
                            setError('');
                          }}
                        >
                          {idx === 0 ? 'Start' : 'Begin'} →
                        </button>
                      )}
                    </div>

                    <p style={{ color: '#475569', fontSize: '0.9rem', marginTop: '8px', marginBottom: active ? '20px' : 0 }}>
                      {a.description}
                    </p>

                    {/* Show assignment when active */}
                    {active && !done && (
                      <div style={{ borderTop: '2px solid #e2e8f0', paddingTop: '20px' }}>
                        {renderAssignment(a)}
                        <button
                          style={{ ...S.btn('gray'), marginTop: '12px', marginLeft: '12px' }}
                          onClick={() => { setActiveId(null); setError(''); }}
                        >
                          Save & Close
                        </button>
                      </div>
                    )}

                    {/* Show submitted timestamp */}
                    {done && progress[a.id]?.submittedAt && (
                      <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '6px' }}>
                        Submitted {new Date(progress[a.id].submittedAt).toLocaleString()}
                        {progress[a.id].score !== undefined && (
                          <span style={{ marginLeft: '12px', color: '#16a34a', fontWeight: 'bold' }}>
                            Quiz score: {progress[a.id].score}/{progress[a.id].total}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem', marginTop: '8px', paddingBottom: '24px' }}>
          All assignments must be completed before accessing the simulation.
        </div>
      </div>
    </div>
  );
}
