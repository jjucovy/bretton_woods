const { useState } = React;

        // User Management Panel Component
        function UserManagementPanel({ playerId }) {
          const [showUsers, setShowUsers] = useState(false);
          const [users, setUsers] = useState([]);

          const loadUsers = async () => {
            try {
              const response = await fetch(`/api/users?adminPlayerId=${playerId}`);
              const data = await response.json();
              if (data.users) {
                setUsers(data.users);
                setShowUsers(true);
              }
            } catch (err) {
              console.error('Error loading users:', err);
            }
          };

          const deleteUser = async (username) => {
            if (!confirm(`Delete user "${username}"?\n\nThis cannot be undone!`)) return;

            try {
              const response = await fetch(`/api/users/${username}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminPlayerId: playerId })
              });

              const result = await response.json();
              if (result.success) {
                // User deleted successfully
                loadUsers(); // Refresh list
              } else {
                console.error('Delete user error:', result.error);
              }
            } catch (err) {
              console.error('Error deleting user:', err.message);
            }
          };

          const exportUsers = () => {
            window.location.href = `/api/export-users?adminPlayerId=${playerId}`;
          };

          return (
            <div className="card" style={{ background: '#f0f9ff', border: '2px solid #0891b2', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ marginTop: 0, marginBottom: '15px', color: '#075985' }}>
                  👥 User Management
                </h3>
                <button
                  onClick={() => showUsers ? setShowUsers(false) : loadUsers()}
                  style={{
                    padding: '8px 16px',
                    background: '#0891b2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  {showUsers ? '🔼 Hide Users' : '🔽 Show Users'}
                </button>
              </div>

              {showUsers && (
                <div>
                  <div style={{ marginBottom: '15px', display: 'flex', gap: '10px' }}>
                    <button
                      onClick={exportUsers}
                      style={{
                        padding: '8px 16px',
                        background: '#7c3aed',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      💾 Export User Database
                    </button>
                    <button
                      onClick={loadUsers}
                      style={{
                        padding: '8px 16px',
                        background: '#059669',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        cursor: 'pointer'
                      }}
                    >
                      🔄 Refresh
                    </button>
                  </div>

                  <div style={{
                    maxHeight: '400px',
                    overflowY: 'auto',
                    background: 'white',
                    borderRadius: '6px',
                    padding: '12px'
                  }}>
                    <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                          <th style={{ padding: '10px', textAlign: 'left' }}>Username</th>
                          <th style={{ padding: '10px', textAlign: 'left' }}>Role</th>
                          <th style={{ padding: '10px', textAlign: 'left' }}>Created</th>
                          <th style={{ padding: '10px', textAlign: 'left' }}>Last Login</th>
                          <th style={{ padding: '10px', textAlign: 'center' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.length === 0 ? (
                          <tr>
                            <td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                              No users found
                            </td>
                          </tr>
                        ) : (
                          users.map(user => (
                            <tr key={user.username} style={{ borderBottom: '1px solid #e5e7eb' }}>
                              <td style={{ padding: '10px', fontWeight: 'bold' }}>
                                {user.username}
                                {user.playerId === playerId && (
                                  <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: '#3b82f6' }}>(You)</span>
                                )}
                              </td>
                              <td style={{ padding: '10px' }}>
                                <span style={{
                                  padding: '4px 8px',
                                  background: user.role === 'superadmin' ? '#dc2626' : '#0891b2',
                                  color: 'white',
                                  borderRadius: '4px',
                                  fontSize: '0.75rem',
                                  fontWeight: 'bold'
                                }}>
                                  {user.role === 'superadmin' ? 'ADMIN' : 'PLAYER'}
                                </span>
                              </td>
                              <td style={{ padding: '10px', color: '#64748b', fontSize: '0.8rem' }}>
                                {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
                              </td>
                              <td style={{ padding: '10px', color: '#64748b', fontSize: '0.8rem' }}>
                                {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
                              </td>
                              <td style={{ padding: '10px', textAlign: 'center' }}>
                                {user.playerId !== playerId && (
                                  <button
                                    onClick={() => deleteUser(user.username)}
                                    style={{
                                      padding: '6px 12px',
                                      background: '#dc2626',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    🗑️ Delete
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div style={{
                    marginTop: '12px',
                    padding: '10px',
                    background: '#fef3c7',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    color: '#78350f'
                  }}>
                    <strong>💡 Tip:</strong> User accounts persist across server restarts. Export database for backup.
                    Total users: {users.length}
                  </div>
                </div>
              )}
            </div>
          );
        }

window.UserManagementPanel = UserManagementPanel;
