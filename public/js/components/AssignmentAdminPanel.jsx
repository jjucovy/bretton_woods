const { useState, useEffect } = React;

function AssignmentAdminPanel({ socket, playerId, assignmentDefs }) {
  const [data, setData]         = useState(null);   // { [userId]: { [assignmentId]: record } }
  const [loading, setLoading]   = useState(false);
  const [expanded, setExpanded] = useState(null);   // { userId, assignmentId }
  const [open, setOpen]         = useState(false);

  function load() {
    setLoading(true);
    socket.emit('getAllAssignments', { userId: playerId });
  }

  useEffect(() => {
    const handler = ({ success, data: d }) => {
      setLoading(false);
      if (success) setData(d);
    };
    socket.on('allAssignments', handler);
    return () => socket.off('allAssignments', handler);
  }, []);

  const S = {
    panel: {
      background: 'white', borderRadius: '12px', padding: '20px 24px',
      marginBottom: '20px', border: '2px solid #fbbf24',
    },
    header: {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: open ? '16px' : 0,
    },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
    th: { background: '#f8fafc', padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 'bold', fontSize: '0.82rem' },
    td: { padding: '8px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' },
    badge: (done) => ({
      display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '0.78rem', fontWeight: 'bold',
      background: done ? '#dcfce7' : '#f1f5f9',
      color: done ? '#166534' : '#94a3b8',
    }),
    btn: { padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold', background: '#f59e0b', color: 'white' },
    responseBox: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px', marginTop: '6px', fontSize: '0.85rem', color: '#334155', lineHeight: '1.6', whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' },
  };

  const totalDefs = assignmentDefs.length || 4;
  const userIds   = data ? Object.keys(data) : [];

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <div>
          <span style={{ fontWeight: 'bold', fontSize: '1rem', color: '#92400e' }}>
            📋 Student Assignment Submissions
          </span>
          {data && (
            <span style={{ color: '#64748b', fontSize: '0.85rem', marginLeft: '12px' }}>
              {userIds.length} student(s) with submissions
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={S.btn} onClick={() => { setOpen(o => !o); if (!open && !data) load(); }}>
            {open ? 'Hide ▲' : 'View Submissions ▼'}
          </button>
          {open && (
            <button style={{ ...S.btn, background: '#64748b' }} onClick={load} disabled={loading}>
              {loading ? '⏳' : '↻ Refresh'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <>
          {loading && <p style={{ color: '#64748b' }}>Loading…</p>}
          {!loading && data && userIds.length === 0 && (
            <p style={{ color: '#64748b', textAlign: 'center', padding: '20px 0' }}>No submissions yet.</p>
          )}
          {!loading && data && userIds.length > 0 && (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>User ID</th>
                  {assignmentDefs.map(a => (
                    <th key={a.id} style={S.th}>A{a.id}: {a.title.split(' ').slice(0,2).join(' ')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {userIds.map(uid => {
                  const userRec = data[uid] || {};
                  return (
                    <React.Fragment key={uid}>
                      <tr>
                        <td style={S.td}><strong>User {uid}</strong></td>
                        {assignmentDefs.map(a => {
                          const rec = userRec[a.id];
                          const done = rec?.submitted;
                          return (
                            <td key={a.id} style={S.td}>
                              <span style={S.badge(done)}>{done ? '✓ Done' : '—'}</span>
                              {done && (
                                <button
                                  style={{ marginLeft: '6px', padding: '2px 8px', fontSize: '0.78rem', border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer', background: 'white' }}
                                  onClick={() => setExpanded(prev => prev?.uid === uid && prev?.aid === a.id ? null : { uid, aid: a.id })}
                                >
                                  {expanded?.uid === uid && expanded?.aid === a.id ? 'Hide' : 'View'}
                                </button>
                              )}
                              {done && rec.score !== undefined && (
                                <div style={{ fontSize: '0.78rem', color: '#16a34a', marginTop: '2px' }}>
                                  Score: {rec.score}/{rec.total}
                                </div>
                              )}
                              {done && (
                                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                                  {new Date(rec.submittedAt).toLocaleDateString()}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      {expanded?.uid === uid && (
                        <tr>
                          <td colSpan={assignmentDefs.length + 1} style={{ ...S.td, background: '#f8fafc' }}>
                            {(() => {
                              const rec = data[uid][expanded.aid];
                              const def = assignmentDefs.find(a => a.id === expanded.aid);
                              if (!rec || !def) return null;
                              if (def.type === 'quiz') {
                                return (
                                  <div>
                                    <strong>Quiz answers:</strong>
                                    {def.questions?.map(q => (
                                      <div key={q.id} style={{ marginTop: '6px' }}>
                                        <span style={{ color: '#475569', fontSize: '0.85rem' }}>{q.text}</span>
                                        <br/>
                                        <span style={{ fontWeight: 'bold' }}>Answer: {rec.responses?.[q.id]?.toUpperCase() || '—'}</span>
                                        {' '}<span style={{ color: rec.responses?.[q.id] === q.correct ? '#16a34a' : '#dc2626' }}>
                                          {rec.responses?.[q.id] === q.correct ? '✓' : '✗'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              if (def.type === 'essay') {
                                return (
                                  <div>
                                    <strong>Position Paper:</strong>
                                    <div style={S.responseBox}>{rec.responses?.essay || '—'}</div>
                                  </div>
                                );
                              }
                              // short_answer
                              return (
                                <div>
                                  {def.questions?.map((q, i) => (
                                    <div key={q.id} style={{ marginBottom: '12px' }}>
                                      <strong style={{ fontSize: '0.85rem' }}>Q{i+1}: {q.text}</strong>
                                      <div style={S.responseBox}>{rec.responses?.[q.id] || '—'}</div>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
