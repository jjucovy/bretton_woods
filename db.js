/**
 * Database module - calls PHP API on Hostinger
 * FIXED VERSION - matches actual database schema
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
  try {
    const result = await callAPI('getAllUsers');
    return result && result.users ? result.users : [];
  } catch (err) {
    console.error('getAllUsers failed:', err.message);
    return [];
  }
}

async function getUser(username) {
  try {
    return await callAPI('getUser', { username });
  } catch (err) {
    console.error('getUser failed:', err.message);
    return null;
  }
}

async function createUser(username, password, role = 'student', email = '', displayName = '') {
  try {
    return await callAPI('createUser', { 
      username, 
      password, 
      role, 
      email, 
      displayName: displayName || username 
    });
  } catch (err) {
    console.error('createUser failed:', err.message);
    return { error: err.message };
  }
}

// ============ GAMES ============
async function createNewGame(gameCode, createdBy) {
  try {
    return await callAPI('createNewGame', { gameCode, createdBy });
  } catch (err) {
    console.error('createNewGame failed:', err.message);
    return { error: err.message };
  }
}

async function getGame(gameCode) {
  try {
    return await callAPI('getGame', { gameCode });
  } catch (err) {
    console.error('getGame failed:', err.message);
    return null;
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

async function findActiveLobbyGame() {
  try {
    return await callAPI('findActiveLobbyGame', {});
  } catch (err) {
    console.error('findActiveLobbyGame failed:', err.message);
    return null;
  }
}

// ============ PLAYERS ============
// NOTE: Database uses country_id (foreign key), not countryCode/countryName directly
async function addPlayer(gameCode, userId, countryId) {
  try {
    return await callAPI('addPlayer', { 
      gameCode, 
      userId, 
      countryId  // ✅ FIXED: Use countryId, not countryCode/countryName
    });
  } catch (err) {
    console.error('addPlayer failed:', err.message);
    return { error: err.message };
  }
}

async function getPlayers(gameCode) {
  try {
    const result = await callAPI('getPlayers', { gameCode });
    console.log('🔍 [getPlayers API Result]', JSON.stringify(result, null, 2).substring(0, 1000));
    return result && result.players ? result.players : [];
  } catch (err) {
    console.error('getPlayers failed:', err.message);
    return [];
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

// NOTE: Database has separate phase1_score and phase2_score columns
async function updatePlayerPoints(gameCode, userId, points, phase = 'phase1', addPoints = 0) {
  try {
    return await callAPI('updatePlayerPoints', { 
      gameCode, 
      userId, 
      points,      // Absolute score
      phase,       // 'phase1' or 'phase2'
      addPoints    // Points to add (delta)
    });
  } catch (err) {
    console.error('updatePlayerPoints failed:', err.message);
    return { error: err.message };
  }
}

// ============ VOTES (Phase 1) ============
async function saveVote(gameCode, userId, round, issueId, issueTitle, optionId, optionText, pointsEarned = 0) {
  try {
    return await callAPI('saveVote', { 
      gameCode, 
      userId, 
      round, 
      issueId, 
      issueTitle, 
      optionId,      // ✅ FIXED: API expects optionId, not choice
      optionText, 
      pointsEarned 
    });
  } catch (err) {
    console.error('saveVote failed:', err.message);
    return { error: err.message };
  }
}

async function getVotes(gameCode, round = null) {
  try {
    return await callAPI('getVotes', { gameCode, round });
  } catch (err) {
    console.error('getVotes failed:', err.message);
    return [];
  }
}

// ============ POLICY DECISIONS (Phase 2) ============
async function savePolicy(gameCode, userId, round, policyData) {
  try {
    return await callAPI('savePolicy', { 
      gameCode, 
      userId, 
      round, 
      ...policyData  // Spread policy fields
    });
  } catch (err) {
    console.error('savePolicy failed:', err.message);
    return { error: err.message };
  }
}

async function getPolicies(gameCode, round = null) {
  try {
    return await callAPI('getPolicies', { gameCode, round });
  } catch (err) {
    console.error('getPolicies failed:', err.message);
    return [];
  }
}

// ============ ROUND RESULTS ============
async function saveRoundResult(gameCode, round, phase, resultData) {
  try {
    return await callAPI('saveRoundResult', { 
      gameCode, 
      round, 
      phase, 
      ...resultData  // Spread result fields
    });
  } catch (err) {
    console.error('saveRoundResult failed:', err.message);
    return { error: err.message };
  }
}

async function getRoundResults(gameCode) {
  try {
    return await callAPI('getRoundResults', { gameCode });
  } catch (err) {
    console.error('getRoundResults failed:', err.message);
    return [];
  }
}

// ============ FULL GAME STATE ============
async function getFullGameState(gameCode) {
  try {
    return await callAPI('getFullGameState', { gameCode });
  } catch (err) {
    console.error('getFullGameState failed:', err.message);
    return null;
  }
}

// ============ LEADERBOARD ============
async function getLeaderboard(gameCode = null) {
  try {
    return await callAPI('getLeaderboard', { gameCode });
  } catch (err) {
    console.error('getLeaderboard failed:', err.message);
    return [];
  }
}

// ============ CRISES ============
async function getCrises(year = null) {
  try {
    return await callAPI('getCrises', { year });
  } catch (err) {
    console.error('getCrises failed:', err.message);
    return [];
  }
}

async function getCrisisOptions(crisisId, countryCode = null) {
  try {
    return await callAPI('getCrisisOptions', { crisisId, countryCode });
  } catch (err) {
    console.error('getCrisisOptions failed:', err.message);
    return [];
  }
}

async function saveCrisisResponse(gameCode, userId, crisisId, optionId, year = null) {
  try {
    return await callAPI('saveCrisisResponse', { 
      gameCode, 
      userId,      // ✅ API expects userId, not playerId
      crisisId, 
      optionId,    // ✅ FIXED: optionId, not choiceId
      year
    });
  } catch (err) {
    console.error('saveCrisisResponse failed:', err.message);
    return { error: err.message };
  }
}

// ============ MILITARY DEPLOYMENTS ============
async function saveDeployment(gameCode, userId, deploymentData) {
  try {
    return await callAPI('saveDeployment', { 
      gameCode, 
      userId,      // ✅ API expects userId, not playerId
      country: deploymentData.country,
      region: deploymentData.region,
      troops: deploymentData.troops,
      branch: deploymentData.branch,  // ✅ CRITICAL: API requires this
      year: deploymentData.year,
      deploymentInfluence: deploymentData.deploymentInfluence || 0
    });
  } catch (err) {
    console.error('saveDeployment failed:', err.message);
    return { error: err.message };
  }
}

async function getDeployments(gameCode, year = null) {
  try {
    return await callAPI('getDeployments', { gameCode, year });
  } catch (err) {
    console.error('getDeployments failed:', err.message);
    return [];
  }
}

// ============ ECONOMIC STATE ============
async function saveEconomicState(gameCode, countryCode, year, stateData) {
  try {
    return await callAPI('saveEconomicState', {
      gameCode,
      countryCode,  // ✅ Pass country code, not country_id
      year,
      gdpGrowth: stateData.gdpGrowth,
      inflation: stateData.inflation,
      unemployment: stateData.unemployment,
      tradeBalance: stateData.tradeBalance,
      reserves: stateData.reserves,
      stability: stateData.stability
    });
  } catch (err) {
    console.error('saveEconomicState failed:', err.message);
    return { error: err.message };
  }
}

async function getEconomicState(gameCode, countryCode = null, year = null) {
  try {
    return await callAPI('getEconomicState', { gameCode, countryCode, year });
  } catch (err) {
    console.error('getEconomicState failed:', err.message);
    return [];
  }
}

// ============ GAME RESULTS ============
async function saveGameResult(gameCode, countryCode, finalScore, breakdown = null) {
  try {
    return await callAPI('saveGameResult', {
      gameCode,
      countryCode,
      finalScore,
      breakdown: breakdown ? JSON.stringify(breakdown) : null
    });
  } catch (err) {
    console.error('saveGameResult failed:', err.message);
    return { error: err.message };
  }
}

async function getGameResults(gameCode) {
  try {
    return await callAPI('getGameResults', { gameCode });
  } catch (err) {
    console.error('getGameResults failed:', err.message);
    return [];
  }
}

// ============ GAME STATE MANAGEMENT ============
async function releaseAllPlayers(gameCode) {
  try {
    return await callAPI('releaseAllPlayers', { gameCode });
  } catch (err) {
    console.error('releaseAllPlayers failed:', err.message);
    return { error: err.message };
  }
}

// ============ BATTLES ============
async function proposeBattle(gameCode, year, country1, country2, region, battleData) {
  try {
    return await callAPI('proposeBattle', {
      gameCode,
      year,
      country1,
      country2,
      region,
      ...battleData
    });
  } catch (err) {
    console.error('proposeBattle failed:', err.message);
    return { error: err.message };
  }
}

async function submitBattleDecision(battleId, country, decision, committedForces = 0) {
  try {
    return await callAPI('submitBattleDecision', {
      battleId,
      country,
      decision,
      committedForces
    });
  } catch (err) {
    console.error('submitBattleDecision failed:', err.message);
    return { error: err.message };
  }
}

async function resolveBattle(battleId) {
  try {
    return await callAPI('resolveBattle', { battleId });
  } catch (err) {
    console.error('resolveBattle failed:', err.message);
    return { error: err.message };
  }
}

async function getBattles(gameCode, year = null) {
  try {
    return await callAPI('getBattles', { gameCode, year });
  } catch (err) {
    console.error('getBattles failed:', err.message);
    return [];
  }
}

async function getBattleResults(gameCode) {
  try {
    return await callAPI('getBattleResults', { gameCode });
  } catch (err) {
    console.error('getBattleResults failed:', err.message);
    return [];
  }
}

// ============ ALLIANCES ============
async function proposeAlliance(gameCode, year, country1, country2) {
  try {
    return await callAPI('proposeAlliance', {
      gameCode,
      year,
      country1,
      country2
    });
  } catch (err) {
    console.error('proposeAlliance failed:', err.message);
    return { error: err.message };
  }
}

async function respondToAlliance(allianceId, response) {
  try {
    return await callAPI('respondToAlliance', {
      allianceId,
      response  // 'ACCEPTED' or 'REJECTED'
    });
  } catch (err) {
    console.error('respondToAlliance failed:', err.message);
    return { error: err.message };
  }
}

async function getAlliances(gameCode, year = null) {
  try {
    return await callAPI('getAlliances', { gameCode, year });
  } catch (err) {
    console.error('getAlliances failed:', err.message);
    return [];
  }
}

// ============ SCORING HELPERS ============
async function getBattleScores(gameId, country) {
  try {
    return await callAPI('getBattleScores', { gameId, country });
  } catch (err) {
    console.error('getBattleScores failed:', err.message);
    return { victories: 0, defeats: 0, negotiated: 0, territory_regions: 0 };
  }
}

async function getAlliancePoints(gameId, country) {
  try {
    return await callAPI('getAlliancePoints', { gameId, country });
  } catch (err) {
    console.error('getAlliancePoints failed:', err.message);
    return { active_alliances: 0 };
  }
}

async function getEconomicDamage(gameId, country) {
  try {
    return await callAPI('getEconomicDamage', { gameId, country });
  } catch (err) {
    console.error('getEconomicDamage failed:', err.message);
    return { total_damage: 0 };
  }
}

async function getCrisisPointsByCountry(gameId, country) {
  try {
    return await callAPI('getCrisisPointsByCountry', { gameId, country });
  } catch (err) {
    console.error('getCrisisPointsByCountry failed:', err.message);
    return { total_points: 0 };
  }
}

async function updatePlayerPhase2Score(playerId, phase2Score) {
  try {
    return await callAPI('updatePlayerPhase2Score', { playerId, phase2Score });
  } catch (err) {
    console.error('updatePlayerPhase2Score failed:', err.message);
    return { error: err.message };
  }
}

// ============ COUNTRIES ============
async function getCountries() {
  try {
    return await callAPI('getCountries', {});
  } catch (err) {
    console.error('getCountries failed:', err.message);
    return [];
  }
}

async function getCountryByCode(countryCode) {
  try {
    return await callAPI('getCountryByCode', { countryCode });
  } catch (err) {
    console.error('getCountryByCode failed:', err.message);
    return null;
  }
}

// ============ TEST ============
async function testConnection() {
  try {
    return await callAPI('test');
  } catch (err) {
    console.error('testConnection failed:', err.message);
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
  findActiveLobbyGame,
  
  // Players
  addPlayer,
  getPlayers,
  getPlayerActiveGame,
  updatePlayerPoints,
  updatePlayerPhase2Score,
  
  // Countries
  getCountries,
  getCountryByCode,
  
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
  getDeployments,
  
  // Battles
  proposeBattle,
  submitBattleDecision,
  resolveBattle,
  getBattles,
  getBattleResults,
  
  // Alliances
  proposeAlliance,
  respondToAlliance,
  getAlliances,
  
  // Scoring helpers
  getBattleScores,
  getAlliancePoints,
  getEconomicDamage,
  getCrisisPointsByCountry,
  
  // Game state management
  releaseAllPlayers
};
