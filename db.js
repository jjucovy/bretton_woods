/**
 * Database module - calls PHP API on Hostinger
 * Complete game state persistence
 * 
 * CORRECTED VERSION - Consistent userId usage
 * Note: API converts userId to playerId internally where needed
 */

const API_URL = 'https://jucovy.com/api.php';
const API_KEY = 'bretton-woods-secret-key-2024';

async function callAPI(action, data = {}) {
  try {
    const payload = { action, ...data };
    // Log for critical data operations
    if (['saveVote', 'saveRoundResult', 'saveGameResult', 'saveCrisisResponse', 'saveDeployment'].includes(action)) {
      console.log(`📡 API Call: ${action}`, JSON.stringify(payload).substring(0, 200));
    }
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    if (!result.success) {
      console.error(`❌ API Error (${action}):`, result.error || 'Unknown error');
      throw new Error(result.error || 'API call failed');
    }
    
    if (['saveVote', 'saveRoundResult', 'saveGameResult', 'saveCrisisResponse', 'saveDeployment'].includes(action)) {
      console.log(`✅ API Success: ${action}`, result.data);
    }
    
    return result.data;
  } catch (err) {
    console.error(`❌ API call failed (${action}):`, err.message);
    throw err;
  }
}

// ============ SCHEMA ============
async function setupSchema() {
  return callAPI('setupSchema');
}

async function ensureScoreColumns() {
  return callAPI('ensureScoreColumns');
}

// ============ USERS ============
async function getAllUsers() {
  return callAPI('getAllUsers');
}

async function getUser(username) {
  return callAPI('getUser', { username });
}

async function createUser(username, password, role = 'student', email = '', displayName = '') {
  return callAPI('createUser', { username, password, role, email, displayName: displayName || username });
}

// ============ GAMES ============
async function createGame(gameCode, createdBy = null) {
  return callAPI('createGame', { gameCode, createdBy });
}

async function getGame(gameCode) {
  return callAPI('getGame', { gameCode });
}

async function updateGame(gameCode, updates) {
  return callAPI('updateGame', { gameCode, ...updates });
}

// ============ COUNTRIES ============
async function getCountries() {
  return callAPI('getCountries');
}

// ============ PLAYERS ============
/**
 * Add a player to a game with their assigned country
 * @param {string} gameCode - The game code
 * @param {number} userId - The user's ID (will be converted to player_id internally)
 * @param {string} countryCode - Country code (e.g., 'USA', 'UK')
 * @param {string} countryName - Full country name
 */
async function addPlayer(gameCode, userId, countryCode, countryName) {
  return callAPI('addPlayer', { gameCode, userId, countryCode, countryName });
}

/**
 * Get all players in a game
 * Returns players with country_code and country_name fields
 */
async function getPlayers(gameCode) {
  const result = await callAPI('getPlayers', { gameCode });
  console.log('🔍 [getPlayers API Result]', JSON.stringify(result, null, 2).substring(0, 1000));
  return result;
}

async function getPlayerActiveGame(userId) {
  return callAPI('getPlayerActiveGame', { userId });
}

/**
 * Update player points
 * @param {string} gameCode - The game code
 * @param {number} userId - The user's ID (will be converted to player_id internally)
 * @param {number} points - New point value (if addPoints is 0)
 * @param {number} phase - Game phase (1 or 2) - determines which score column to update
 * @param {number} addPoints - Points to add (if > 0, adds to existing score)
 */
async function updatePlayerPoints(gameCode, userId, points, phase = 1, addPoints = 0) {
  return callAPI('updatePlayerPoints', { gameCode, userId, points, phase, addPoints });
}

async function clearPlayerCountry(gameCode, userId) {
  return callAPI('clearPlayerCountry', { gameCode, userId });
}

async function releaseAllPlayers(gameCode) {
  return callAPI('releaseAllPlayers', { gameCode });
}

// ============ VOTES (Phase 1) ============
/**
 * Save a player's vote
 * @param {number} userId - The user's ID (API converts to player_id internally)
 */
async function saveVote(gameCode, userId, round, issueId, issueTitle, optionId, optionText, pointsEarned = 0) {
  return callAPI('saveVote', { gameCode, userId, round, issueId, issueTitle, optionId, optionText, pointsEarned });
}

async function getVotes(gameCode, round = null) {
  return callAPI('getVotes', { gameCode, round });
}

// ============ POLICY DECISIONS (Phase 2) ============
/**
 * Save a policy decision
 * @param {number} userId - The user's ID (API converts to player_id internally)
 */
async function savePolicy(gameCode, userId, round, policyData) {
  return callAPI('savePolicy', { gameCode, userId, round, ...policyData });
}

async function getPolicies(gameCode, round = null) {
  return callAPI('getPolicies', { gameCode, round });
}

// ============ ROUND RESULTS ============
async function saveRoundResult(gameCode, round, phase, resultData) {
  return callAPI('saveRoundResult', { gameCode, round, phase, ...resultData });
}

async function getRoundResults(gameCode) {
  return callAPI('getRoundResults', { gameCode });
}

// ============ FULL GAME STATE ============
async function getFullGameState(gameCode) {
  return callAPI('getFullGameState', { gameCode });
}

// ============ LEADERBOARD ============
async function getLeaderboard(gameCode = null) {
  return callAPI('getLeaderboard', { gameCode });
}

// ============ CRISES ============
async function getCrises(year = null) {
  return callAPI('getCrises', { year });
}

async function getCrisisOptions(crisisId, countryCode = null) {
  return callAPI('getCrisisOptions', { crisisId, countryCode });
}

async function seedCrises(crises) {
  return callAPI('seedCrises', { crises });
}

/**
 * Save a crisis response
 * @param {string} gameCode - The game code
 * @param {number} userId - The user's ID (API converts to player_id internally)
 * @param {string} crisisId - The crisis ID
 * @param {string} optionId - The chosen option ID
 * @param {number} year - The year of the crisis
 */
async function saveCrisisResponse(gameCode, userId, crisisId, optionId, year = null) {
  return callAPI('saveCrisisResponse', { 
    gameCode, 
    userId,  // ✅ API expects userId and converts to player_id internally
    crisisId, 
    optionId,
    year
  });
}

/**
 * Save a military deployment
 * @param {string} gameCode - The game code
 * @param {number} userId - The user's ID (API converts to player_id internally)
 * @param {object} deploymentData - Deployment details (country, region, troops, branch, year, etc.)
 */
async function saveDeployment(gameCode, userId, deploymentData) {
  return callAPI('saveDeployment', { 
    gameCode, 
    userId,  // ✅ API expects userId and converts to player_id internally
    country: deploymentData.country,
    region: deploymentData.region,
    troops: deploymentData.troops,
    branch: deploymentData.branch,
    year: deploymentData.year,
    deploymentInfluence: deploymentData.deploymentInfluence || 0
  });
}

// ============ ECONOMIC STATE ============
async function saveEconomicState(gameCode, countryCode, year, stateData) {
  return callAPI('saveEconomicState', {
    gameCode,
    countryCode,
    year,
    gdpGrowth: stateData.gdpGrowth,
    inflation: stateData.inflation,
    unemployment: stateData.unemployment,
    tradeBalance: stateData.tradeBalance,
    reserves: stateData.reserves,
    stability: stateData.stability
  });
}

async function getEconomicState(gameCode, countryCode = null, year = null) {
  return callAPI('getEconomicState', { gameCode, countryCode, year });
}

// ============ GAME RESULTS ============
async function saveGameResult(gameCode, countryCode, finalScore, breakdown = null) {
  return callAPI('saveGameResult', {
    gameCode,
    countryCode,
    finalScore,
    breakdown: breakdown ? JSON.stringify(breakdown) : null
  });
}

async function getGameResults(gameCode) {
  return callAPI('getGameResults', { gameCode });
}

// ============ TEST ============
async function testConnection() {
  return callAPI('test');
}

module.exports = {
  // Schema
  setupSchema,
  ensureScoreColumns,
  
  // Users
  getAllUsers,
  getUser,
  createUser,
  
  // Games
  createGame,
  getGame,
  updateGame,
  
  // Countries
  getCountries,
  
  // Players
  addPlayer,
  getPlayers,
  getPlayerActiveGame,
  updatePlayerPoints,
  clearPlayerCountry,
  releaseAllPlayers,
  
  // Votes
  saveVote,
  getVotes,
  
  // Policies
  savePolicy,
  getPolicies,
  
  // Results
  saveRoundResult,
  getRoundResults,
  
  // Economic State
  saveEconomicState,
  getEconomicState,
  
  // Game Results
  saveGameResult,
  getGameResults,
  
  // Full state
  getFullGameState,
  
  // Leaderboard
  getLeaderboard,
  
  // Crises
  getCrises,
  getCrisisOptions,
  seedCrises,
  saveCrisisResponse,
  
  // Deployments
  saveDeployment,
  
  // Test
  testConnection
};
