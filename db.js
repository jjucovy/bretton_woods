/**
 * Database module - calls PHP API on Hostinger
 * Complete game state persistence
 */

const fetch = require('node-fetch');
const { URLSearchParams } = require('url');

const API_URL = 'https://jucovy.com/api.php';
const API_KEY = 'bretton-woods-secret-key-2024';

async function callAPI(action, data = {}) {
  try {
    const payload = new URLSearchParams({
      action: action,
      ...data
    });
    
    console.log(`[DB API Call] Action: ${action}`);
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-API-Key': API_KEY
      },
      body: payload.toString()
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log(`[DB API Response] Action: ${action} - Success:`, result.success !== false);
    
    return result;
  } catch (err) {
    console.error(`[DB API Error] Action: ${action}`, err.message);
    throw err;
  }
}

// Add to db.js or update your API to support these calls:
async function getHighestGameId() {
  return await callAPI('getHighestGameId', {});
}

async function getHighestPlayerId() {
  return await callAPI('getHighestPlayerId', {});
}

// ============ SCHEMA ============
async function setupSchema() {
  return callAPI('setupSchema');
}

// ============ USERS ============
async function getAllUsers() {
  try {
    const result = await callAPI('getAllUsers');
    return result && result.users ? result.users : [];
  } catch (err) {
    console.error('getAllUsers failed:', err.message);
    return [];
  }
}

// Get user by username
async function getUser(username) {
  try {
    const result = await callAPI('getUser', { username });
    
    if (result && result.success) {
      return {
        user_id: result.user_id,
        username: result.username,
        password_hash: result.password_hash,
        is_teacher: result.is_teacher,
        created_at: result.created_at
      };
    }
    
    return null;
  } catch (err) {
    console.error('getUser failed:', err.message);
    return null;
  }
}

async function createUser(username, password, role = 'student', email = '', displayName = '') {
  return callAPI('createUser', { username, password, role, email, displayName: displayName || username });
}

// ============ GAMES ============
async function createGame(gameCode, createdBy = null) {
  console.log('[DB] createGame called:', { gameCode, createdBy });
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
  try {
    const result = await callAPI('getPlayers', { gameCode });
    return result && result.players ? result.players : [];
  } catch (err) {
    console.error('getPlayers failed:', err.message);
    return [];
  }
}

async function updatePlayerPoints(gameCode, userId, points, addPoints = 0) {
  return callAPI('updatePlayerPoints', { gameCode, userId, points, addPoints });
}

// Get player's active game
async function getPlayerActiveGame(userId) {
  try {
    return await callAPI('getPlayerActiveGame', { userId });
  } catch (err) {
    console.error('getPlayerActiveGame failed:', err.message);
    return null;
  }
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

// ============ DEPLOYMENTS ============
async function saveDeployment(gameCode, playerId, deployment) {
  return callAPI('saveDeployment', { 
    gameCode, 
    playerId, 
    deployment: JSON.stringify(deployment) 
  });
}

// ============ SCORE COLUMNS ============
async function ensureScoreColumns() {
  return callAPI('ensureScoreColumns');
}

// ============ TEST ============
async function testConnection() {
  try {
    console.log('🔍 Testing database connection...');
    console.log('   Endpoint:', API_URL);
    
    const result = await callAPI('testConnection');
    
    if (result && result.success) {
      console.log('✅ Database connection successful');
      return true;
    } else {
      console.error('❌ Database connection failed:', result);
      return false;
    }
  } catch (err) {
    console.error('❌ Database connection test failed:', err.message);
    return false;
  }
}

module.exports = {
  // Core
  callAPI,
  testConnection,
  
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
  getHighestGameId,
  getHighestPlayerId,
  
  // Players
  addPlayer,
  getPlayers,
  updatePlayerPoints,
  getPlayerActiveGame,
  
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
  saveDeployment
};
