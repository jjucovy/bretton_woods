/**
 * Database module - calls PHP API on Hostinger
 * Complete game state persistence
 */

const API_URL = 'https://jucovy.com/api.php';
const API_KEY = 'bretton-woods-secret-key-2024';

async function callAPI(action, data = {}) {
  try {
    const payload = { action, api_key: API_KEY, ...data };
    // Log for critical data operations
    if (['saveVote', 'saveRoundResult', 'saveGameResult', 'saveCrisisResponse', 'saveDeployment', 'submitBattleDecision'].includes(action)) {
      console.log(`📡 API Call: ${action}`, JSON.stringify(payload).substring(0, 200));
    }
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    if (!result.success) {
      console.error(`❌ API Error (${action}):`, result.error || 'Unknown error');
      throw new Error(result.error || 'API call failed');
    }
    
    if (['saveVote', 'saveRoundResult', 'saveGameResult', 'saveCrisisResponse', 'saveDeployment', 'submitBattleDecision'].includes(action)) {
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

// ============ ID COUNTERS ============
async function getHighestGameId() {
  try {
    const result = await callAPI('getHighestGameId', {});
    console.log('[getHighestGameId] Result:', result);
    return result.highest_game_id || 0;
  } catch (err) {
    console.error('getHighestGameId failed:', err.message);
    return 0;
  }
}

async function getHighestPlayerId() {
  try {
    const result = await callAPI('getHighestPlayerId', {});
    console.log('[getHighestPlayerId] Result:', result);
    return result.highest_player_id || 0;
  } catch (err) {
    console.error('getHighestPlayerId failed:', err.message);
    return 0;
  }
}

// ✅ NEW: Get highest game code number for initializing counter
async function getHighestGameCode() {
  try {
    const result = await callAPI('getHighestGameCode', {});
    console.log('[getHighestGameCode] Result:', result);
    return result;
  } catch (err) {
    console.error('getHighestGameCode failed:', err.message);
    return { highest_number: 0 };
  }
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
async function createNewGame(gameCode, createdBy) {
  return callAPI('createNewGame', { gameCode, createdBy });
}

async function getGame(gameCode) {
  return callAPI('getGame', { gameCode });
}

async function updateGame(gameCode, updates) {
  return callAPI('updateGame', { gameCode, ...updates });
}

// ============ PLAYERS ============
async function addPlayer(gameCode, userId, countryCode, countryName) {
  return callAPI('addPlayer', { gameCode, userId, countryCode, countryName });
}

async function getPlayers(gameCode) {
  const result = await callAPI('getPlayers', { gameCode });
  console.log('🔍 [getPlayers API Result]', JSON.stringify(result, null, 2).substring(0, 1000));
  return result;
}

async function getPlayerActiveGame(userId) {
  return callAPI('getPlayerActiveGame', { userId });
}

async function updatePlayerPoints(gameCode, userId, points, phase = 'phase1', addPoints = 0) {
  return callAPI('updatePlayerPoints', { gameCode, userId, points, phase, addPoints });
}

// ============ VOTES (Phase 1) ============
async function saveVote(gameCode, userId, round, issueId, issueTitle, optionId, optionText, pointsEarned = 0) {
  return callAPI('saveVote', { gameCode, userId, round, issueId, issueTitle, optionId, optionText, pointsEarned });
}

async function getVotes(gameCode, round = null) {
  return callAPI('getVotes', { gameCode, round });
}

// ============ POLICY DECISIONS (Phase 2) ============
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

async function saveCrisisResponse(gameCode, userId, crisisId, optionId, year = null) {
  return callAPI('saveCrisisResponse', { 
    gameCode, 
    userId,  // ✅ API expects userId, not playerId
    crisisId, 
    optionId,
    year
  });
}

// ============ DEPLOYMENTS ============
async function saveDeployment(gameCode, userId, deploymentData) {
  return callAPI('saveDeployment', { 
    gameCode, 
    userId, 
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

// ============ GAME STATE MANAGEMENT ============
async function releaseAllPlayers(gameCode) {
  return callAPI('releaseAllPlayers', { gameCode });
}

// ============ TESTING ============
async function test() {
  return callAPI('test');
}

// ============ EXPORTS ============
module.exports = {
  // Core
  callAPI,
  test,
  // Schema
  setupSchema,
  ensureScoreColumns,
  
  // ID Counters
  getHighestGameId,
  getHighestPlayerId,
  getHighestGameCode,
  
  // Users
  getAllUsers,
  getUser,
  createUser,
  
  // Games
  createNewGame,
  getGame,
  updateGame,
  
  // Players
  addPlayer,
  getPlayers,
  getPlayerActiveGame,
  updatePlayerPoints,
  
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
  saveCrisisResponse,
  
  // Deployments
  saveDeployment,
  
  // Game state management
  releaseAllPlayers
};
