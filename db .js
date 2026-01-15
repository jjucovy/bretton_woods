/**
 * Database module - calls PHP API on Hostinger
 * Complete game state persistence
 */

const API_URL = 'https://jucovy.com/api.php';
const API_KEY = 'bretton-woods-secret-key-2024';

async function callAPI(action, data = {}) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({ action, ...data })
    });
    
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'API call failed');
    }
    return result.data;
  } catch (err) {
    console.error(`API call failed (${action}):`, err.message);
    throw err;
  }
}

// ============ SCHEMA ============
async function setupSchema() {
  return callAPI('setupSchema');
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

// ============ PLAYERS ============
async function addPlayer(gameCode, userId, countryCode, countryName) {
  return callAPI('addPlayer', { gameCode, userId, countryCode, countryName });
}

async function getPlayers(gameCode) {
  return callAPI('getPlayers', { gameCode });
}

async function updatePlayerPoints(gameCode, userId, points, addPoints = 0) {
  return callAPI('updatePlayerPoints', { gameCode, userId, points, addPoints });
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

async function saveCrisisResponse(gameCode, playerId, crisisId, optionId, responseDetails = null) {
  return callAPI('saveCrisisResponse', { 
    gameCode, 
    playerId, 
    crisisId, 
    optionId,
    responseDetails 
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
  
  // Users
  getAllUsers,
  getUser,
  createUser,
  
  // Games
  createGame,
  getGame,
  updateGame,
  
  // Players
  addPlayer,
  getPlayers,
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
  
  // Test
  testConnection
};
