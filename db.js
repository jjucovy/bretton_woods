/**
 * Database module - calls PHP API on Hostinger
 * Complete game state persistence
 */

const API_URL = 'https://jucovy.com/api.php';
const API_KEY = 'bretton-woods-secret-key-2024';

async function callAPI(action, data = {}) {
  try {
    const payload = { action, ...data };
    // Log for critical data operations
    if (['saveVote', 'saveRoundResult', 'saveGameResult', 'saveCrisisResponse', 'saveDeployment', 'submitBattleDecision'].includes(action)) {
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


async function getGame(gameCode) {
  return callAPI('getGame', { gameCode });
}

async function updateGame(gameCode, updates) {
  return callAPI('updateGame', { gameCode, ...updates });
}

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

async function saveDeployment(gameCode, userId, deploymentData) {
  return callAPI('saveDeployment', { 
    gameCode, 
    userId, 
    country: deploymentData.country,
    region: deploymentData.region,
    troops: deploymentData.troops,
    branch: deploymentData.branch,  // ✅ CRITICAL: API requires this
    year: deploymentData.year,
    deploymentInfluence: deploymentData.deploymentInfluence || 0
  });
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

// ============ TEST ============
async function testConnection() {
  return callAPI('test');
}



// Get user by username
async function getUser(username) {
  try {
    return await callAPI('getUser', { username });
  } catch (err) {
    console.error('getUser failed:', err.message);
    return null;
  }
}

// Get all users
async function getAllUsers() {
  try {
    const result = await callAPI('getAllUsers');
    return result && result.users ? result.users : [];
  } catch (err) {
    console.error('getAllUsers failed:', err.message);
    return [];
  }
}

// Create new user
async function createUser(username, passwordHash, role = 'player') {
  try {
    return await callAPI('createUser', { username, passwordHash, role });
  } catch (err) {
    console.error('createUser failed:', err.message);
    return { error: err.message };
  }
}

// Other database functions...
async function getGame(gameCode) {
  try {
    return await callAPI('getGame', { gameCode });
  } catch (err) {
    console.error('getGame failed:', err.message);
    return null;
  }
}

async function createNewGame(gameCode, createdBy) {
  try {
    return await callAPI('createNewGame', { gameCode, createdBy });
  } catch (err) {
    console.error('createNewGame failed:', err.message);
    return { error: err.message };
  }
}

async function updateGame(gameCode, updates) {
  try {
    return await callAPI('updateGame', { gameCode, ...updates });
  } catch (err) {
    console.error('updateGame failed:', err.message);
    return { error: err.message };
  }
}

async function getPlayers(gameCode) {
  try {
    const result = await callAPI('getPlayers', { gameCode });
    return result && result.players ? result.players : [];
  } catch (err) {
    console.error('getPlayers failed:', err.message);
    return [];
  }
}

async function addPlayer(gameCode, userId, countryCode, countryName) {
  try {
    return await callAPI('addPlayer', { gameCode, userId, countryCode, countryName });
  } catch (err) {
    console.error('addPlayer failed:', err.message);
    return { error: err.message };
  }
}

async function setupSchema() {
  try {
    return await callAPI('setupSchema');
  } catch (err) {
    console.error('setupSchema failed:', err.message);
    return { error: err.message };
  }
}

async function ensureScoreColumns() {
  try {
    return await callAPI('ensureScoreColumns');
  } catch (err) {
    console.error('ensureScoreColumns failed:', err.message);
    return { error: err.message };
  }
}

async function saveVote(gameCode, userId, round, issueId, issueTitle, choice, optionText, pointsEarned) {
  try {
    return await callAPI('saveVote', { 
      gameCode, userId, round, issueId, issueTitle, choice, optionText, pointsEarned 
    });
  } catch (err) {
    console.error('saveVote failed:', err.message);
    return { error: err.message };
  }
}

async function saveRoundResult(gameCode, round, phase, results) {
  try {
    return await callAPI('saveRoundResult', { gameCode, round, phase, results: JSON.stringify(results) });
  } catch (err) {
    console.error('saveRoundResult failed:', err.message);
    return { error: err.message };
  }
}

async function savePolicy(gameCode, userId, round, policy) {
  try {
    return await callAPI('savePolicy', { gameCode, userId, round, policy: JSON.stringify(policy) });
  } catch (err) {
    console.error('savePolicy failed:', err.message);
    return { error: err.message };
  }
}

async function saveEconomicState(gameCode, country, year, state) {
  try {
    return await callAPI('saveEconomicState', { gameCode, country, year, state: JSON.stringify(state) });
  } catch (err) {
    console.error('saveEconomicState failed:', err.message);
    return { error: err.message };
  }
}

async function saveGameResult(gameCode, country, score, breakdown) {
  try {
    return await callAPI('saveGameResult', { gameCode, country, score, breakdown: JSON.stringify(breakdown) });
  } catch (err) {
    console.error('saveGameResult failed:', err.message);
    return { error: err.message };
  }
}

async function updatePlayerPoints(gameCode, userId, points, phase) {
  try {
    return await callAPI('updatePlayerPoints', { gameCode, userId, points, phase });
  } catch (err) {
    console.error('updatePlayerPoints failed:', err.message);
    return { error: err.message };
  }
}

async function getPlayerActiveGame(userId) {
  try {
    return await callAPI('getPlayerActiveGame', { userId });
  } catch (err) {
    console.error('getPlayerActiveGame failed:', err.message);
    return null;
  }
}

async function saveDeployment(gameCode, playerId, deployment) {
  try {
    return await callAPI('saveDeployment', { gameCode, playerId, deployment: JSON.stringify(deployment) });
  } catch (err) {
    console.error('saveDeployment failed:', err.message);
    return { error: err.message };
  }
}

async function saveCrisisResponse(gameCode, userId, crisisId, choiceId, year) {
  try {
    return await callAPI('saveCrisisResponse', { gameCode, userId, crisisId, choiceId, year });
  } catch (err) {
    console.error('saveCrisisResponse failed:', err.message);
    return { error: err.message };
  }
}

module.exports = {
  // Core
  callAPI,
  testConnection,
  
  // Schema
  setupSchema,
  ensureScoreColumns,
  
  // ID Counters
  getHighestGameId,
  getHighestPlayerId,
  
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
