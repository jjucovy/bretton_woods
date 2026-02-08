// public/js/shared-styles.js - Shared inline styles for battle/alliance components
// Loaded as a regular <script> (no JSX) before component scripts.

var styles = {
  modal: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: '30px',
    borderRadius: '10px',
    maxWidth: '700px',
    width: '90%',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
  },
  battleInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: '20px 0',
    padding: '15px',
    backgroundColor: '#f5f5f5',
    borderRadius: '5px'
  },
  side: { flex: 1, textAlign: 'center' },
  vs: { fontWeight: 'bold', margin: '0 20px', fontSize: '18px' },
  section: { marginTop: '20px' },
  decisionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px',
    marginTop: '10px'
  },
  decisionButton: {
    padding: '15px 10px',
    border: '2px solid #ddd',
    borderRadius: '5px',
    cursor: 'pointer',
    backgroundColor: '#f9f9f9',
    transition: 'all 0.2s'
  },
  decisionButtonActive: { borderColor: '#4CAF50', backgroundColor: '#e8f5e9' },
  strategyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px',
    marginTop: '10px'
  },
  strategyButton: {
    padding: '10px',
    border: '2px solid #ddd',
    borderRadius: '5px',
    cursor: 'pointer',
    backgroundColor: '#f9f9f9'
  },
  strategyButtonActive: { borderColor: '#2196F3', backgroundColor: '#e3f2fd' },
  actions: {
    display: 'flex',
    gap: '10px',
    marginTop: '20px',
    justifyContent: 'flex-end'
  },
  submitButton: {
    padding: '10px 20px',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer'
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: '#999',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer'
  },
  acceptButton: {
    padding: '10px 20px',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer'
  },
  rejectButton: {
    padding: '10px 20px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer'
  },
  proposalContent: { margin: '15px 0' },
  allianceTerms: {
    backgroundColor: '#e8f5e9',
    padding: '15px',
    borderRadius: '5px',
    marginTop: '10px'
  },
  warning: { color: '#d32f2f', fontWeight: 'bold', marginTop: '15px' },
  resultCard: {
    backgroundColor: '#f0f8ff',
    border: '2px solid #1976d2',
    borderRadius: '8px',
    padding: '15px',
    marginTop: '15px'
  },
  resultHeader: {
    borderBottom: '2px solid #1976d2',
    paddingBottom: '10px',
    marginBottom: '15px'
  },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    gap: '15px'
  },
  resultColumn: { textAlign: 'center' },
  divider: { borderLeft: '2px solid #ddd', width: '1px' },
  resultStat: { marginTop: '10px', padding: '5px' },
  casualty: { color: '#d32f2f', fontWeight: 'bold' },
  damage: { color: '#f57c00', fontWeight: 'bold' },
  victory: { color: '#388e3c', fontWeight: 'bold' },
  resultPoints: {
    marginTop: '15px',
    padding: '10px',
    backgroundColor: '#fff9c4',
    borderRadius: '5px',
    textAlign: 'center'
  },
  historyPanel: {
    marginTop: '20px',
    padding: '15px',
    backgroundColor: '#f5f5f5',
    borderRadius: '5px'
  },
  noBattles: { color: '#888', fontStyle: 'italic' },
  battlesList: { marginTop: '10px' },
  battleHistoryItem: {
    padding: '10px',
    marginTop: '10px',
    backgroundColor: '#fff',
    borderLeft: '4px solid #2196F3',
    borderRadius: '3px'
  },
  battleRegion: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '5px'
  },
  battleOutcome: { fontSize: '12px', color: '#388e3c' },
  battleDetails: { fontSize: '13px', color: '#666' },
  battleOutcomeDetail: { fontSize: '12px', color: '#d32f2f', marginTop: '5px' },
  battlePhaseContainer: { padding: '20px' },
  pendingBattleCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '15px',
    backgroundColor: '#fff3e0',
    border: '2px solid #f57c00',
    borderRadius: '5px',
    marginTop: '10px'
  },
  pendingBattleInfo: { flex: 1 },
  decideButton: {
    padding: '8px 16px',
    backgroundColor: '#ff6f00',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer'
  },
  submitted: { color: '#388e3c', fontWeight: 'bold' },
  continueButton: {
    marginTop: '20px',
    padding: '12px 30px',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '16px'
  }
};
