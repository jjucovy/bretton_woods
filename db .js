/**
 * Database module - calls PHP API on Hostinger
 * Complete game state persistence
 */

const API_URL = 'https://jucovy.com/api.php';
const API_KEY = 'bretton-woods-secret-key-2024';

async function callAPI(action, data = {}) {
  try {
    console.log(`[DB API Call] Action: ${action}`);
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({ action, ...data })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log(`[DB API Response] Action: ${action} - Success:`, result.success !== false);
    
    return result;
  } catch (err) {
    console.error(`[DB API Error] Action: ${action}:`, err.message);
    throw err;
  }
}

// ============ ID COUNTERS ============
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

async function ensureScoreColumns() {
  return callAPI('ensureScoreColumns');
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

// Find active lobby game with available slots
async function findActiveLobbyGame() {
  try {
    const result = await callAPI('findActiveLobbyGame', {});
    if (result && result.success) {
      return {
        gameId: result.game_id,
        gameCode: result.game_code,
        playerCount: result.player_count || 0
      };
    }
    return null;
  } catch (err) {
    console.error('findActiveLobbyGame failed:', err.message);
    return null;
  }
}

// Release all players from a game
async function releaseAllPlayers(gameCode) {
  try {
    return await callAPI('releasePlayersFromGame', { gameCode });
  } catch (err) {
    console.error('releaseAllPlayers failed:', err.message);
    return { success: false, error: err.message };
  }
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
  return callAPI('saveRoundResult', { gameCode, round, phase, ...resultDa
