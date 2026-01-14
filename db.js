// Database connection module for Bretton Woods Simulation
// Connects to MySQL via PHP API on Hostinger

const API_URL = process.env.DB_API_URL || 'https://jucovy.com/api.php';
const API_KEY = process.env.DB_API_KEY || 'bretton-woods-secret-key-2024';

// Flag to enable/disable database sync
let DB_ENABLED = true;

async function apiCall(action, data = {}) {
    if (!DB_ENABLED) return null;
    
    try {
        const response = await fetch(`${API_URL}?action=${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            console.error(`API error (${action}):`, response.status);
            return null;
        }
        
        return await response.json();
    } catch (error) {
        console.error(`API call failed (${action}):`, error.message);
        return null;
    }
}

// ============ CONNECTION ============

async function testConnection() {
    const result = await apiCall('test');
    if (result && result.status === 'ok') {
        console.log('✅ Database API connected');
        return true;
    }
    console.log('⚠️ Database API not available - running in local-only mode');
    DB_ENABLED = false;
    return false;
}

function isEnabled() {
    return DB_ENABLED;
}

function setEnabled(enabled) {
    DB_ENABLED = enabled;
    console.log(`Database sync ${enabled ? 'enabled' : 'disabled'}`);
}

// ============ USERS ============

async function getUser(username) {
    return await apiCall('getUser', { username });
}

async function createUser(username, password, role = 'student') {
    return await apiCall('createUser', { username, password, role });
}

async function getAllUsers() {
    return await apiCall('getAllUsers') || [];
}

// ============ COUNTRIES ============

async function getCountries() {
    return await apiCall('getCountries') || [];
}

async function getCountry(code) {
    return await apiCall('getCountry', { code });
}

// ============ ISSUES & OPTIONS ============

async function getIssues() {
    return await apiCall('getIssues') || [];
}

async function getOptions(issueId = null) {
    return await apiCall('getOptions', { issueId }) || [];
}

async function getPreferences(countryCode = null) {
    return await apiCall('getPreferences', { countryCode }) || [];
}

// ============ GAME ROOMS ============

async function createGame(code, teacherId, status = 'waiting') {
    return await apiCall('createGame', { code, teacherId, status });
}

async function getGame(code) {
    return await apiCall('getGame', { code });
}

async function updateGame(code, updates) {
    return await apiCall('updateGame', { code, ...updates });
}

async function getAllGames() {
    return await apiCall('getAllGames') || [];
}

// ============ PLAYERS ============

async function addPlayer(gameCode, userId, countryCode) {
    return await apiCall('addPlayer', { gameCode, userId, countryCode });
}

async function getPlayers(gameCode) {
    return await apiCall('getPlayers', { gameCode }) || [];
}

// ============ VOTES ============

async function saveVote(gameCode, round, countryCode, optionId) {
    return await apiCall('saveVote', { gameCode, round, countryCode, optionId });
}

async function getVotes(gameCode, round = null) {
    return await apiCall('getVotes', { gameCode, round }) || [];
}

// ============ RESULTS ============

async function saveResult(gameCode, round, issueId, winningOptionId) {
    return await apiCall('saveResult', { gameCode, round, issueId, winningOptionId });
}

async function getResults(gameCode) {
    return await apiCall('getResults', { gameCode }) || [];
}

// ============ ECONOMIC STATE ============

// saveEconomicState(roomId, country, year, state) - matches server.js signature
async function saveEconomicState(gameCode, countryCode, year, state) {
    return await apiCall('saveEconomicState', { 
        gameCode, 
        year, 
        countryCode,
        gdpGrowth: state.gdpGrowth,
        inflation: state.inflation,
        unemployment: state.unemployment,
        tradeBalance: state.tradeBalance,
        reserves: state.reserves,
        stability: state.stability
    });
}

async function getEconomicState(gameCode, year = null, countryCode = null) {
    return await apiCall('getEconomicState', { gameCode, year, countryCode }) || [];
}

// ============ POLICIES ============

async function savePolicy(gameCode, year, countryCode, policyType, policyValue) {
    return await apiCall('savePolicy', { gameCode, year, countryCode, policyType, policyValue });
}

async function getPolicies(gameCode, year = null) {
    return await apiCall('getPolicies', { gameCode, year }) || [];
}

// ============ CRISES ============

async function saveCrisis(gameCode, year, crisisType, severity = 'medium') {
    return await apiCall('saveCrisis', { gameCode, year, crisisType, severity });
}

async function saveCrisisResponse(gameCode, crisisId, countryCode, response) {
    return await apiCall('saveCrisisResponse', { gameCode, crisisId, countryCode, response });
}

// ============ FULL DATA LOAD1 ============

async function getFullGameData() {
    return await apiCall('getFullGameData');
}

// ============ ALIASES FOR SERVER.JS COMPATIBILITY ============

// createGameSession(roomId, roomName, playerId)
async function createGameSession(roomId, roomName, teacherId) {
    return await apiCall('createGame', { code: roomId, teacherId, status: 'waiting' });
}

// addPlayerToGame(roomId, odplayerId, country)
async function addPlayerToGame(roomId, odplayerId, country) {
    return await apiCall('addPlayer', { gameCode: roomId, odplayerId, countryCode: country });
}

// saveGameResult(roomId, country, score, breakdown)
async function saveGameResult(roomId, country, score, breakdown) {
    return await apiCall('saveResult', { 
        gameCode: roomId, 
        round: 0, 
        countryCode: country, 
        score,
        breakdown: JSON.stringify(breakdown)
    });
}

// submitEconomicPolicy(roomId, country, year, policy)
async function submitEconomicPolicy(roomId, country, year, policy) {
    return await apiCall('savePolicy', { 
        gameCode: roomId, 
        year, 
        countryCode: country,
        policyType: 'economic',
        policyValue: JSON.stringify(policy)
    });
}

// ============ EXPORTS ============

module.exports = {
    // Connection
    testConnection,
    isEnabled,
    setEnabled,
    
    // Users
    getUser,
    createUser,
    getAllUsers,
    
    // Countries
    getCountries,
    getCountry,
    
    // Issues
    getIssues,
    getOptions,
    getPreferences,
    
    // Games
    createGame,
    createGameSession,  // Alias for server.js
    getGame,
    updateGame,
    getAllGames,
    
    // Players
    addPlayer,
    addPlayerToGame,    // Alias for server.js
    getPlayers,
    
    // Votes
    saveVote,
    getVotes,
    
    // Results
    saveResult,
    saveGameResult,     // Alias for server.js
    getResults,
    
    // Economic
    saveEconomicState,
    getEconomicState,
    savePolicy,
    submitEconomicPolicy, // Alias for server.js
    getPolicies,
    
    // Crises
    saveCrisis,
    saveCrisisResponse,
    
    // Full data
    getFullGameData
};
