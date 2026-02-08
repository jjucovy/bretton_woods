const styles = window.SharedStyles;

function AllianceProposalModal({ proposal, country, onAccept, onReject, onCancel }) {
  const otherCountry = proposal.country1 === country ? proposal.country2 : proposal.country1;

  return (
    <div style={styles.modal}>
      <div style={styles.modalContent}>
        <h2>🤝 Alliance Proposal</h2>

        <div style={styles.proposalContent}>
          <p><strong>{otherCountry}</strong> proposes an alliance with you!</p>

          <div style={styles.allianceTerms}>
            <h4>Alliance Benefits:</h4>
            <ul>
              <li>✅ +15% military strength when allied</li>
              <li>✅ +5 bonus points per year</li>
              <li>✅ Mutual defense support</li>
              <li>✅ Shared diplomatic influence</li>
            </ul>
          </div>

          <p style={styles.warning}>
            ⚠️ If you reject, diplomatic relations may suffer.
          </p>
        </div>

        <div style={styles.actions}>
          <button
            onClick={() => onAccept(proposal.alliance_id)}
            style={styles.acceptButton}
          >
            ✅ Accept Alliance
          </button>
          <button
            onClick={() => onReject(proposal.alliance_id)}
            style={styles.rejectButton}
          >
            ❌ Reject
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

window.AllianceProposalModal = AllianceProposalModal;
