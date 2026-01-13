const mysql = require('mysql2/promise');

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306 // Use the environment variable or default to 3306
});

/*connection.connect(err => {
  if (err) {
    console.error('Error connecting to the database:', err.stack);
    return;
  }
  console.log('Connected to Hostinger MySQL database!');
});*/
// Create connection pool
const pool = mysql.createPool(connection);

// Test connection on startup
async function testConnection() {
 try {
    const conn = await pool.getConnection();
    console.log('[DB] Connected to MySQL database');
   if (conn) { 
   conn.release();
    return true;
   }
  } catch (err) {
 console.error('Error connecting: ' + err.stack);
    return;
  }
}

// === USER FUNCTIONS ===

async function getUserByUsername(username) {
  const [rows] = await pool.execute(
    'SELECT * FROM users WHERE username = ?',
    [username]
  );
  return rows[0] || null;
}

async function getUserById(userId) {
  const [rows] = await pool.execute(
    'SELECT * FROM users WHERE user_id = ?',
    [userId]
  );
  return rows[0] || null;
}

async function getAllUsers() {
  const [rows] = await pool.execute('SELECT * FROM users');
  return rows;
}

async function createUser(username, passwordHash, displayName, email = null, isTeacher = false) {
  const [result] = await pool.execute(
    'INSERT INTO users (username, password_hash, display_name, email, is_teacher) VALUES (?, ?, ?, ?, ?)',
    [username, passwordHash, displayName, email, isTeacher ? 1 : 0]
  );
  return result.insertId;
}

async function updateUserLastLogin(userId) {
  await pool.execute(
    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = ?',
    [userId]
  );
}

// === COUNTRY FUNCTIONS ===

async function getAllCountries() {
  const [rows] = await pool.execute(
    'SELECT * FROM countries ORDER BY country_id'
  );
  return rows;
}

async function getCountryById(countryId) {
  const [rows] = await pool.execute(
    'SELECT * FROM countries WHERE country_id = ?',
    [countryId]
  );
  return rows[0] || null;
}

async function getCountryByCode(countryCode) {
  const [rows] = await pool.execute(
    'SELECT * FROM countries WHERE country_code = ?',
    [countryCode]
  );
  return rows[0] || null;
}

// === GAME FUNCTIONS ===

async function createGame(gameCode, hostUserId, maxPlayers = 7) {
  const [result] = await pool.execute(
    'INSERT INTO games (game_code, host_user_id, game_status, current_round, max_players) VALUES (?, ?, "lobby", 0, ?)',
    [gameCode, hostUserId, maxPlayers]
  );
  return result.insertId;
}

async function getGameByCode(gameCode) {
  const [rows] = await pool.execute(
    'SELECT * FROM games WHERE game_code = ?',
    [gameCode]
  );
  return rows[0] || null;
}

async function getGameById(gameId) {
  const [rows] = await pool.execute(
    'SELECT * FROM games WHERE game_id = ?',
    [gameId]
  );
  return rows[0] || null;
}

async function updateGameStatus(gameId, status, currentRound = null) {
  if (currentRound !== null) {
    await pool.execute(
      'UPDATE games SET game_status = ?, current_round = ? WHERE game_id = ?',
      [status, currentRound, gameId]
    );
  } else {
    await pool.execute(
      'UPDATE games SET game_status = ? WHERE game_id = ?',
      [status, gameId]
    );
  }
}

async function updateGameRound(gameId, round) {
  await pool.execute(
    'UPDATE games SET current_round = ? WHERE game_id = ?',
    [round, gameId]
  );
}

async function startGame(gameId) {
  await pool.execute(
    'UPDATE games SET game_status = "phase1_active", current_round = 1, started_at = CURRENT_TIMESTAMP WHERE game_id = ?',
    [gameId]
  );
}

async function completePhase1(gameId) {
  await pool.execute(
    'UPDATE games SET game_status = "phase1_complete", phase1_complete_time = CURRENT_TIMESTAMP WHERE game_id = ?',
    [gameId]
  );
}

async function startPhase2(gameId) {
  await pool.execute(
    'UPDATE games SET game_status = "phase2_active" WHERE game_id = ?',
    [gameId]
  );
}

async function completeGame(gameId) {
  await pool.execute(
    'UPDATE games SET game_status = "completed", completed_at = CURRENT_TIMESTAMP WHERE game_id = ?',
    [gameId]
  );
}

// === PLAYER FUNCTIONS ===

async function addPlayerToGame(gameId, userId, countryId) {
  const [result] = await pool.execute(
    'INSERT INTO players (game_id, user_id, country_id, phase1_score, phase2_score, total_score, is_ready) VALUES (?, ?, ?, 0, 0, 0, 0)',
    [gameId, userId, countryId]
  );
  return result.insertId;
}

async function getPlayersInGame(gameId) {
  const [rows] = await pool.execute(
    `SELECT p.*, u.username, u.display_name, c.country_name, c.country_code, c.flag_emoji, c.objectives, c.economic_position,
            c.gold_reserves, c.trade_balance, c.gdp, c.war_debt, c.currency_rate, c.industrial_output
     FROM players p
     JOIN users u ON p.user_id = u.user_id
     JOIN countries c ON p.country_id = c.country_id
     WHERE p.game_id = ?`,
    [gameId]
  );
  return rows;
}

async function getPlayerByUserAndGame(userId, gameId) {
  const [rows] = await pool.execute(
    `SELECT p.*, c.country_name, c.country_code, c.flag_emoji
     FROM players p
     JOIN countries c ON p.country_id = c.country_id
     WHERE p.user_id = ? AND p.game_id = ?`,
    [userId, gameId]
  );
  return rows[0] || null;
}

async function updatePlayerScore(playerId, phase1Score, phase2Score) {
  await pool.execute(
    'UPDATE players SET phase1_score = ?, phase2_score = ?, total_score = ? WHERE player_id = ?',
    [phase1Score, phase2Score, phase1Score + phase2Score, playerId]
  );
}

async function setPlayerReady(playerId, isReady) {
  await pool.execute(
    'UPDATE players SET is_ready = ? WHERE player_id = ?',
    [isReady ? 1 : 0, playerId]
  );
}

async function removePlayerFromGame(playerId) {
  await pool.execute(
    'DELETE FROM players WHERE player_id = ?',
    [playerId]
  );
}

async function getAvailableCountries(gameId) {
  const [rows] = await pool.execute(
    `SELECT c.* FROM countries c
     WHERE c.country_id NOT IN (
       SELECT country_id FROM players WHERE game_id = ?
     )`,
    [gameId]
  );
  return rows;
}

// === ISSUE FUNCTIONS ===

async function getAllIssues() {
  const [rows] = await pool.execute(
    'SELECT * FROM issues WHERE is_active = 1 ORDER BY round_order'
  );
  return rows;
}

async function getIssueOptions(issueId) {
  const [rows] = await pool.execute(
    'SELECT * FROM issue_options WHERE issue_id = ?',
    [issueId]
  );
  return rows;
}

async function getIssueForRound(roundNumber) {
  const [rows] = await pool.execute(
    'SELECT * FROM issues WHERE round_order = ? AND is_active = 1',
    [roundNumber]
  );
  return rows[0] || null;
}

// === GAME ISSUE FUNCTIONS ===

async function createGameIssue(gameId, issueId, roundNumber) {
  const [result] = await pool.execute(
    'INSERT INTO game_issues (game_id, issue_id, round_number) VALUES (?, ?, ?)',
    [gameId, issueId, roundNumber]
  );
  return result.insertId;
}

async function getGameIssue(gameId, roundNumber) {
  const [rows] = await pool.execute(
    `SELECT gi.*, i.title, i.description, i.historical_context
     FROM game_issues gi
     JOIN issues i ON gi.issue_id = i.issue_id
     WHERE gi.game_id = ? AND gi.round_number = ?`,
    [gameId, roundNumber]
  );
  return rows[0] || null;
}

async function updateGameIssueResult(gameIssueId, winningOptionId, votesFor, votesAgainst) {
  await pool.execute(
    'UPDATE game_issues SET winning_option_id = ?, votes_for = ?, votes_against = ?, completed_at = CURRENT_TIMESTAMP WHERE game_issue_id = ?',
    [winningOptionId, votesFor, votesAgainst, gameIssueId]
  );
}

// === VOTE FUNCTIONS ===

async function submitVote(gameIssueId, playerId, optionId, voteValue) {
  // Check if vote already exists
  const [existing] = await pool.execute(
    'SELECT vote_id FROM votes WHERE game_issue_id = ? AND player_id = ?',
    [gameIssueId, playerId]
  );
  
  if (existing.length > 0) {
    // Update existing vote
    await pool.execute(
      'UPDATE votes SET option_id = ?, vote_value = ?, voted_at = CURRENT_TIMESTAMP WHERE game_issue_id = ? AND player_id = ?',
      [optionId, voteValue, gameIssueId, playerId]
    );
  } else {
    // Insert new vote
    await pool.execute(
      'INSERT INTO votes (game_issue_id, player_id, option_id, vote_value) VALUES (?, ?, ?, ?)',
      [gameIssueId, playerId, optionId, voteValue]
    );
  }
}

async function getVotesForGameIssue(gameIssueId) {
  const [rows] = await pool.execute(
    `SELECT v.*, p.country_id, c.country_code, c.country_name
     FROM votes v
     JOIN players p ON v.player_id = p.player_id
     JOIN countries c ON p.country_id = c.country_id
     WHERE v.game_issue_id = ?`,
    [gameIssueId]
  );
  return rows;
}

async function countVotesForGameIssue(gameIssueId) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) as count FROM votes WHERE game_issue_id = ?',
    [gameIssueId]
  );
  return rows[0].count;
}

// === PLAYER READINESS FUNCTIONS ===

async function setPlayerRoundReady(gameId, playerId, roundNumber, isReady) {
  const [existing] = await pool.execute(
    'SELECT readiness_id FROM player_readiness WHERE game_id = ? AND player_id = ? AND round_number = ?',
    [gameId, playerId, roundNumber]
  );
  
  if (existing.length > 0) {
    await pool.execute(
      'UPDATE player_readiness SET is_ready = ?, marked_ready_at = CURRENT_TIMESTAMP WHERE game_id = ? AND player_id = ? AND round_number = ?',
      [isReady ? 1 : 0, gameId, playerId, roundNumber]
    );
  } else {
    await pool.execute(
      'INSERT INTO player_readiness (game_id, player_id, round_number, is_ready) VALUES (?, ?, ?, ?)',
      [gameId, playerId, roundNumber, isReady ? 1 : 0]
    );
  }
}

async function getReadyPlayersForRound(gameId, roundNumber) {
  const [rows] = await pool.execute(
    'SELECT player_id FROM player_readiness WHERE game_id = ? AND round_number = ? AND is_ready = 1',
    [gameId, roundNumber]
  );
  return rows.map(r => r.player_id);
}

// === GAME RESULTS FUNCTIONS ===

async function saveGameResult(gameId, playerId, finalRank, phase1Score, phase2Score, agreementsFavored, agreementsOpposed) {
  await pool.execute(
    `INSERT INTO game_results (game_id, player_id, final_rank, phase1_score, phase2_score, total_score, agreements_favored, agreements_opposed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [gameId, playerId, finalRank, phase1Score, phase2Score, phase1Score + phase2Score, agreementsFavored, agreementsOpposed]
  );
}

async function getGameResults(gameId) {
  const [rows] = await pool.execute(
    `SELECT gr.*, u.display_name, c.country_name, c.flag_emoji
     FROM game_results gr
     JOIN players p ON gr.player_id = p.player_id
     JOIN users u ON p.user_id = u.user_id
     JOIN countries c ON p.country_id = c.country_id
     WHERE gr.game_id = ?
     ORDER BY gr.final_rank`,
    [gameId]
  );
  return rows;
}

// === UTILITY FUNCTIONS ===

function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// === PHASE 2 ECONOMIC POLICY FUNCTIONS ===

async function submitEconomicPolicy(gameId, playerId, year, policy) {
  const [existing] = await pool.execute(
    'SELECT policy_id FROM economic_policies WHERE game_id = ? AND player_id = ? AND year = ?',
    [gameId, playerId, year]
  );
  
  const params = [
    policy.monetaryPolicy || 'neutral',
    policy.fiscalPolicy || 'balanced',
    policy.tradePolicy || 'moderate',
    policy.currencyAction || 'maintain',
    policy.imfRequestType || null,
    policy.imfRequestAmount || 0,
    policy.bilateralOfferCountry || null,
    policy.bilateralOfferType || null
  ];
  
  if (existing.length > 0) {
    await pool.execute(
      `UPDATE economic_policies SET 
        monetary_policy = ?, fiscal_policy = ?, trade_policy = ?, currency_action = ?,
        imf_request_type = ?, imf_request_amount = ?, bilateral_offer_country = ?, bilateral_offer_type = ?,
        submitted_at = CURRENT_TIMESTAMP
       WHERE game_id = ? AND player_id = ? AND year = ?`,
      [...params, gameId, playerId, year]
    );
  } else {
    await pool.execute(
      `INSERT INTO economic_policies (game_id, player_id, year, monetary_policy, fiscal_policy, trade_policy, currency_action,
        imf_request_type, imf_request_amount, bilateral_offer_country, bilateral_offer_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [gameId, playerId, year, ...params]
    );
  }
}

async function getPoliciesForYear(gameId, year) {
  const [rows] = await pool.execute(
    `SELECT ep.*, p.country_id, c.country_code, c.country_name
     FROM economic_policies ep
     JOIN players p ON ep.player_id = p.player_id
     JOIN countries c ON p.country_id = c.country_id
     WHERE ep.game_id = ? AND ep.year = ?`,
    [gameId, year]
  );
  return rows;
}

async function countPoliciesForYear(gameId, year) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) as count FROM economic_policies WHERE game_id = ? AND year = ?',
    [gameId, year]
  );
  return rows[0].count;
}

// === ECONOMIC STATE FUNCTIONS ===

async function saveEconomicState(gameId, playerId, year, state) {
  const [existing] = await pool.execute(
    'SELECT state_id FROM economic_state WHERE game_id = ? AND player_id = ? AND year = ?',
    [gameId, playerId, year]
  );
  
  const params = [
    state.goldReserves || 0,
    state.dollarReserves || 0,
    state.tradeBalance || 0,
    state.gdp || 0,
    state.gdpGrowth || 0,
    state.inflation || 0,
    state.unemployment || 0,
    state.currencyRate || 1,
    state.stabilityScore || 100,
    state.imfCreditUsed || 0,
    state.marshallAidReceived || 0
  ];
  
  if (existing.length > 0) {
    await pool.execute(
      `UPDATE economic_state SET 
        gold_reserves = ?, dollar_reserves = ?, trade_balance = ?, gdp = ?, gdp_growth = ?,
        inflation = ?, unemployment = ?, currency_rate = ?, stability_score = ?,
        imf_credit_used = ?, marshall_aid_received = ?, calculated_at = CURRENT_TIMESTAMP
       WHERE game_id = ? AND player_id = ? AND year = ?`,
      [...params, gameId, playerId, year]
    );
  } else {
    await pool.execute(
      `INSERT INTO economic_state (game_id, player_id, year, gold_reserves, dollar_reserves, trade_balance, 
        gdp, gdp_growth, inflation, unemployment, currency_rate, stability_score, imf_credit_used, marshall_aid_received)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [gameId, playerId, year, ...params]
    );
  }
}

async function getEconomicState(gameId, playerId, year) {
  const [rows] = await pool.execute(
    'SELECT * FROM economic_state WHERE game_id = ? AND player_id = ? AND year = ?',
    [gameId, playerId, year]
  );
  return rows[0] || null;
}

async function getAllEconomicStatesForYear(gameId, year) {
  const [rows] = await pool.execute(
    `SELECT es.*, p.country_id, c.country_code, c.country_name
     FROM economic_state es
     JOIN players p ON es.player_id = p.player_id
     JOIN countries c ON p.country_id = c.country_id
     WHERE es.game_id = ? AND es.year = ?`,
    [gameId, year]
  );
  return rows;
}

// === CRISIS FUNCTIONS ===

async function createCrisis(gameId, year, crisisType, crisisName, description, affectedCountries) {
  const [result] = await pool.execute(
    `INSERT INTO game_crises (game_id, year, crisis_type, crisis_name, description, affected_countries)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [gameId, year, crisisType, crisisName, description, affectedCountries]
  );
  return result.insertId;
}

async function getActiveCrises(gameId) {
  const [rows] = await pool.execute(
    'SELECT * FROM game_crises WHERE game_id = ? AND is_resolved = 0',
    [gameId]
  );
  return rows;
}

async function resolveCrisis(crisisId) {
  await pool.execute(
    'UPDATE game_crises SET is_resolved = 1, resolved_at = CURRENT_TIMESTAMP WHERE crisis_id = ?',
    [crisisId]
  );
}

async function submitCrisisResponse(crisisId, playerId, responseType, responseDetails) {
  await pool.execute(
    'INSERT INTO crisis_responses (crisis_id, player_id, response_type, response_details) VALUES (?, ?, ?, ?)',
    [crisisId, playerId, responseType, responseDetails]
  );
}

async function getCrisisResponses(crisisId) {
  const [rows] = await pool.execute(
    `SELECT cr.*, p.country_id, c.country_code, c.country_name
     FROM crisis_responses cr
     JOIN players p ON cr.player_id = p.player_id
     JOIN countries c ON p.country_id = c.country_id
     WHERE cr.crisis_id = ?`,
    [crisisId]
  );
  return rows;
}

// Export all functions
module.exports = {
  pool,
  testConnection,
  // Users
  getUserByUsername,
  getUserById,
  getAllUsers,
  createUser,
  updateUserLastLogin,
  // Countries
  getAllCountries,
  getCountryById,
  getCountryByCode,
  // Games
  createGame,
  getGameByCode,
  getGameById,
  updateGameStatus,
  updateGameRound,
  startGame,
  completePhase1,
  startPhase2,
  completeGame,
  // Players
  addPlayerToGame,
  getPlayersInGame,
  getPlayerByUserAndGame,
  updatePlayerScore,
  setPlayerReady,
  removePlayerFromGame,
  getAvailableCountries,
  // Issues
  getAllIssues,
  getIssueOptions,
  getIssueForRound,
  // Game Issues
  createGameIssue,
  getGameIssue,
  updateGameIssueResult,
  // Votes
  submitVote,
  getVotesForGameIssue,
  countVotesForGameIssue,
  // Readiness
  setPlayerRoundReady,
  getReadyPlayersForRound,
  // Results
  saveGameResult,
  getGameResults,
  // Phase 2 - Economic Policies
  submitEconomicPolicy,
  getPoliciesForYear,
  countPoliciesForYear,
  // Phase 2 - Economic State
  saveEconomicState,
  getEconomicState,
  getAllEconomicStatesForYear,
  // Phase 2 - Crises
  createCrisis,
  getActiveCrises,
  resolveCrisis,
  submitCrisisResponse,
  getCrisisResponses,
  // Utils
  generateGameCode
};
