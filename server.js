// server-multiroom.js - Bretton Woods Multi-Room Server
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const qs = require('qs');

// Database module for MySQL persistence
const db = require('./db');

// PHP API Configuration for MySQL
const PHP_API_ENDPOINT = 'https://jucovy.com/api.php';
const API_KEY = 'bretton-woods-secret-key-2024';

// Country code to short name mapping (matching game-data.json naming)
// Note: Database uses 'USS' for Soviet Union, but game-data.json uses 'USSR'
const COUNTRY_CODE_TO_NAME = {
  'USA': 'USA',
  'UK': 'UK',
  'USS': 'USSR',      // Database code → game-data name
  'FRA': 'France',
  'CHN': 'China',     // Database code → game-data name
  'IND': 'India',
  'ARG': 'Argentina'
};

// Add these helper functions near the top of the file, after the initial variable declarations

// Cache for tracking highest IDs
let highestGameId = 0;
let highestPlayerId = 0;
let gameCodeCounter = 0;  // ✅ Counter for generating gameCode: "game1", "game2", etc.

// Function to initialize highest IDs from database on startup
async function initializeIdCounters() {
  try {
    // Get highest game_id from database
    const highestGameFromDb = await db.getHighestGameId();
    highestGameId = highestGameFromDb || 0;
    console.log(`✅ Initialized highestGameId: ${highestGameId}`);
    
    // Get highest player_id from database
    const highestPlayerFromDb = await db.getHighestPlayerId();
    highestPlayerId = highestPlayerFromDb || 0;
    console.log(`✅ Initialized highestPlayerId: ${highestPlayerId}`);
    
    // Initialize gameCodeCounter from existing games
    try {
      const result = await db.callAPI('getHighestGameCode', {});
      if (result && result.highest_number) {
        gameCodeCounter = parseInt(result.highest_number) || 0;
        console.log(`✅ Initialized gameCodeCounter: ${gameCodeCounter}`);
      } else {
        gameCodeCounter = 0;
        console.log(`✅ Initialized gameCodeCounter: 0 (no existing games)`);
      }
    } catch (err) {
      console.warn('⚠️ Could not get highest game code:', err.message);
      gameCodeCounter = 0;
    }
  } catch (err) {
    console.warn('⚠️ Could not initialize ID counters from database:', err.message);
    console.log('   Will start from 0 and increment as needed');
  }
}
// Function to find the active lobby game with available slots
async function findActiveLobbyGame() {
  try {
    const result = await db.callAPI('findActiveLobbyGame', {});
    if (result && result.game_id) {
      console.log(`✅ Found active lobby game: game_id=${result.game_id}, gameCode=${result.game_code}, players=${result.player_count}/7`);
      return {
        gameId: result.game_id,
        gameCode: result.game_code,
        playerCount: parseInt(result.player_count) || 0
      };
    }
    console.log(`ℹ️ No active lobby game found with available slots`);
    return null;
  } catch (err) {
    console.error('❌ Error finding active lobby game:', err.message);
    return null;
  }
}

// Function to get next game ID
function getNextGameId() {
  highestGameId++;
  return highestGameId;
}

// Function to get next player ID
function getNextPlayerId() {
  highestPlayerId++;
  return highestPlayerId;
}

// Helper function to convert country code to name for voting checks
function getCountryName(countryCode) {
  return COUNTRY_CODE_TO_NAME[countryCode] || countryCode;
}

// Helper to safely call DB functions (fails silently, logs errors)
async function dbSync(operation, ...args) {
  try {
    const result = await operation(...args);
    if (!result || result.error) {
      console.error(`❌ [DB Sync] ${operation.name || 'operation'} API error:`, result?.error || 'No result');
    }
    return result;
  } catch (err) {
    console.error(`❌ [DB Sync] ${operation.name || 'operation'} failed:`, err.message);
    console.error(`   Args:`, args);
    return null;
  }
}

// Cache for user IDs (username -> user_id from MySQL)
const userIdCache = {};

// Get MySQL user_id for a username
async function getUserId(username) {
  if (userIdCache[username]) return userIdCache[username];
  try {
    const user = await db.getUser(username);
    if (user && user.user_id) {
      userIdCache[username] = user.user_id;
      return user.user_id;
    }
  } catch (err) {
    console.warn(`Could not get user_id for ${username}:`, err.message);
  }
  return null;
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 65002;
const STATE_FILE = path.join(__dirname, 'game-state.json');

// Serve game HTML as the main page (MUST come before static middleware!)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Diagnostic endpoint to check state
app.get('/debug/users', (req, res) => {
  const userList = Object.entries(globalState.users).map(([username, data]) => ({
    username,
    playerId: data.playerId,
    role: data.role,
    createdAt: new Date(data.createdAt).toLocaleString()
  }));
  
  res.json({
    totalUsers: userList.length,
    users: userList,
    totalRooms: Object.keys(globalState.rooms).length,
    rooms: Object.keys(globalState.rooms)
  });
});

// Serve static files (after the specific route)
app.use(express.static(__dirname));

// Multi-room game state
let globalState = {
  users: {}, // username -> { password: hashedPassword, playerId: string, createdAt: timestamp }
  rooms: {}, // roomId -> gameState
  roomList: [] // { id, name, host, playerCount, maxPlayers, status, createdAt }
};

// Load military deployments data
const militaryDeploymentsData = require('./military-deployments.json');

// Load crisis events data
const crisisEventsData = require('./crisis-events.json');

// Create default game state template
function createNewGame(gameCode, roomName, hostId) {
  return {
    gameCode: gameCode,  // ✅ Use gameCode instead of roomId
    roomName: roomName,
    hostId: hostId,
    gameId: null,  // ✅ Will be set from database
    gameStarted: false,
    currentRound: 0,
    players: {},
    votes: {},
    readyPlayers: [],
    gamePhase: 'lobby',
    scores: { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 },
    roundHistory: [],
    militaryDeployments: militaryDeploymentsData,
    phase2: {
      active: false,
      currentYear: 1946,
      maxYears: 7, // 1946-1952
      policies: {}, // year -> country -> policy
      yearlyData: {}, // year -> country -> economic data
      achievements: {},
      crises: {
        active: null, // Current active crisis
        history: [], // Resolved crises
        responses: {} // playerId -> response choice
      }
    },
    maxPlayers: 7,
    createdAt: Date.now(),
    autoAdvance: true, // Auto-advance when all players submit
    autoAdvanceDelay: 5000 // Delay in ms before auto-advancing (for Phase 1 results viewing)
  };
}

// Load/save state functions
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      const loadedState = JSON.parse(data);
      
      globalState = {
        users: loadedState.users || {},
        rooms: loadedState.rooms || {},
        roomList: loadedState.roomList || []
      };
      
      console.log('✅ Multi-room state loaded from file');
      console.log(`   - Users: ${Object.keys(globalState.users).length}`);
      console.log(`   - Rooms: ${Object.keys(globalState.rooms).length}`);
    } else {
      console.log('📝 No saved state found, using defaults');
    }
  } catch (err) {
    console.error('❌ Error loading state:', err);
    console.log('⚠️  Using default state');
  }
}

function saveState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const backupFile = STATE_FILE.replace('.json', '-backup.json');
      fs.copyFileSync(STATE_FILE, backupFile);
    }
    
    fs.writeFileSync(STATE_FILE, JSON.stringify(globalState, null, 2));
    console.log('💾 Game state saved');
  } catch (err) {
    console.error('❌ Error saving state:', err);
  }
}

// Load state on startup
loadState();

// Try to load users from MySQL if local state is empty
async function loadUsersFromDB(retries = 3) {
  if (Object.keys(globalState.users).length === 0) {
    console.log('📊 Attempting to load users from MySQL...');
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const users = await db.getAllUsers();
        if (!users || !Array.isArray(users)) {
          console.log('⚠️ Could not load users from API');
          return;
        }
        users.forEach(user => {
          globalState.users[user.username] = {
            password: user.password_hash,
            playerId: `player_db_${user.user_id || user.id || user.username}`,
            createdAt: user.created_at ? new Date(user.created_at).getTime() : Date.now(),
            role: (user.is_teacher === '1' || user.is_teacher === 1) ? 'superadmin' : 'player'
          };
        });
        if (users.length > 0) {
          console.log(`✅ Loaded ${users.length} users from MySQL`);
          saveState(); // Save to local file too
        } else {
          console.log('ℹ️  No users in MySQL database yet');
        }
        return; // Success, exit
      } catch (err) {
        console.warn(`⚠️  MySQL connection attempt ${attempt}/${retries} failed: ${err.message}`);
        if (attempt < retries) {
          console.log(`   Retrying in 5 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }
    console.log('ℹ️  MySQL unavailable - server will use local state and sync when DB is available');
  } else {
    console.log(`ℹ️  Using ${Object.keys(globalState.users).length} users from local state`);
  }
}

// Call async loader (non-blocking)
loadUsersFromDB();

// ============================================
// EXPORT/IMPORT GAME STATE
// ============================================

// Export game state (download JSON)
app.get('/api/export-state/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = globalState.rooms[roomId];
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  // Create export package with timestamp
  const exportData = {
    exportedAt: new Date().toISOString(),
    version: '2.0',
    roomId: roomId,
    roomData: room
  };
  
  // Set headers for file download
  const filename = `bretton-woods-${roomId}-${Date.now()}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  
  res.json(exportData);
  console.log(`📥 Exported game state for room ${roomId}`);
});

// Import game state (restore from JSON)
app.post('/api/import-state/:roomId', express.json({ limit: '10mb' }), (req, res) => {
  const { roomId } = req.params;
  const { roomData, playerId } = req.body;
  
  // Verify admin permissions
  const user = Object.values(globalState.users).find(u => u.playerId === playerId);
  if (!user || user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only administrators can import game states' });
  }
  
  if (!roomData) {
    return res.status(400).json({ error: 'No room data provided' });
  }
  
  try {
    // Restore room state
    globalState.rooms[roomId] = roomData;
    
    // Save to disk
    saveState();
    
    // Broadcast update to all clients in room
    io.to(roomId).emit('gameStateUpdate', roomData);
    
    console.log(`📤 Imported game state for room ${roomId}`);
    res.json({ success: true, message: 'Game state imported successfully' });
  } catch (err) {
    console.error('Error importing state:', err);
    res.status(500).json({ error: 'Failed to import game state' });
  }
});

// ============================================
// END EXPORT/IMPORT
// ============================================

// ============================================
// USER MANAGEMENT API
// ============================================

// Get all users (admin only)
app.get('/api/users', (req, res) => {
  const { adminPlayerId } = req.query;
  
  // Verify admin
  const admin = Object.values(globalState.users).find(u => u.playerId === adminPlayerId);
  if (!admin || admin.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  // Return users without passwords
  const users = Object.entries(globalState.users).map(([username, data]) => ({
    username,
    playerId: data.playerId,
    role: data.role,
    createdAt: data.createdAt,
    lastLogin: data.lastLogin
  }));
  
  res.json({ users });
});

// Delete user (admin only)
app.delete('/api/users/:username', express.json(), (req, res) => {
  const { username } = req.params;
  const { adminPlayerId } = req.body;
  
  // Verify admin
  const admin = Object.values(globalState.users).find(u => u.playerId === adminPlayerId);
  if (!admin || admin.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  // Don't allow deleting self
  const adminUsername = Object.keys(globalState.users).find(u => globalState.users[u].playerId === adminPlayerId);
  if (username === adminUsername) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  
  if (!globalState.users[username]) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  delete globalState.users[username];
  saveState();
  
  console.log(`User deleted: ${username} by admin`);
  res.json({ success: true, message: 'User deleted successfully' });
});

// Export user database (admin only)
app.get('/api/export-users', (req, res) => {
  const { adminPlayerId } = req.query;
  
  // Verify admin
  const admin = Object.values(globalState.users).find(u => u.playerId === adminPlayerId);
  if (!admin || admin.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const exportData = {
    exportedAt: new Date().toISOString(),
    version: '2.0',
    users: globalState.users
  };
  
  const filename = `users-database-${Date.now()}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  
  res.json(exportData);
  console.log(`📥 Exported user database`);
});

// ============================================
// END USER MANAGEMENT
// ============================================


// ============================================
// SINGLE-ROOM MODE: Auto-create main game room
// ============================================
const SINGLE_ROOM_ID = 'main-game';

console.log('🔍 Checking for main game room...');
console.log('   Current rooms:', Object.keys(globalState.rooms));

if (!globalState.rooms[SINGLE_ROOM_ID]) {
  // Try loading from database first
  (async () => {
    try {
      console.log('📂 Loading game from database...');
      const gameData = await db.getGame(SINGLE_ROOM_ID);
      
      if (gameData) {
        console.log('✅ Found existing game in database, restoring state...');
        // Create room structure from DB data
        globalState.rooms[SINGLE_ROOM_ID] = createNewGame(SINGLE_ROOM_ID, 'Bretton Woods 1944', null);

        
        // Restore game status and round
        globalState.rooms[SINGLE_ROOM_ID].gameStatus = gameData.game_status;
        globalState.rooms[SINGLE_ROOM_ID].gamePhase = gameData.game_status === 'lobby' ? 'lobby' : 
                                                      gameData.game_status === 'phase1_active' ? 'voting' :
                                                      gameData.game_status === 'phase2_active' ? 'phase2' :
                                                      gameData.game_status === 'completed' ? 'complete' : 'lobby';
        globalState.rooms[SINGLE_ROOM_ID].currentRound = parseInt(gameData.current_round) || 0;
        globalState.rooms[SINGLE_ROOM_ID].gameStarted = gameData.game_status !== 'lobby';
        
        console.log(`✅ Game restored: status=${gameData.game_status}, phase=${globalState.rooms[SINGLE_ROOM_ID].gamePhase}, started=${globalState.rooms[SINGLE_ROOM_ID].gameStarted}`);
        
        // Only restore players if game is active
        if (gameData.game_status !== 'lobby') {
          try {
            const players = await db.getPlayers(SINGLE_ROOM_ID);
            console.log('   📋 Restored', players.length, 'players from database');
            for (const p of players) {
              const playerId = `player_db_${p.user_id}`;
              const countryName = getCountryName(p.country_code);
              globalState.rooms[SINGLE_ROOM_ID].players[playerId] = {
                playerId: playerId,
                userId: p.user_id,
                username: p.username,
                country: countryName,
                countryCode: p.country_code,
                countryId: p.country_id
              };
              
              let pointsValue = p.total_points || p.totalPoints || p.points || p.phase1_score || 0;
              if (pointsValue && !isNaN(parseInt(pointsValue))) {
                globalState.rooms[SINGLE_ROOM_ID].scores[countryName] = parseInt(pointsValue);
              }
            }
          } catch (err) {
            console.log('   Warning: Could not restore players:', err.message);
          }
        } else {
          console.log('   ℹ️  Game is in lobby - no players to restore');
        }
        
        updateRoomList();
      } 
      
      else {
        /*console.log('📝 No game found in database, creating new game in LOBBY...');
        const newGameId = getNextGameId();
        const newGameCode = `game_${newGameId}`;
        
        globalState.rooms[SINGLE_ROOM_ID] = createNewGame(SINGLE_ROOM_ID, 'Bretton Woods 1944', null);
        globalState.rooms[SINGLE_ROOM_ID].gameId = newGameId;
        globalState.rooms[SINGLE_ROOM_ID].gameCode = newGameCode;
        globalState.rooms[SINGLE_ROOM_ID].gamePhase = 'lobby';
        globalState.rooms[SINGLE_ROOM_ID].gameStatus = 'lobby';
        globalState.rooms[SINGLE_ROOM_ID].gameStarted = false;
        globalState.rooms[SINGLE_ROOM_ID].currentRound = 0;
        
        updateRoomList();
        saveState();
        
        // Create in database with lobby status
        await db.callAPI('createNewGame', {
          gameCode: newGameCode,
          gameId: newGameId,
          createdBy: null
        });
        
        console.log(`✅ New game created in LOBBY: game_id=${newGameId}, gameCode=${newGameCode}`);*/
      }
    } catch (err) {
      console.error('❌ Error loading game on startup:', err.message);
      console.log('📝 Creating fresh game room in LOBBY...');
      
      const newGameId = getNextGameId();
      const newGameCode = `game_${newGameId}`;
      
     // globalState.rooms[SINGLE_ROOM_ID] = createNewGame(SINGLE_ROOM_ID, 'Bretton Woods 1944', null);
      globalState.rooms[SINGLE_ROOM_ID].gameId = newGameId;
      globalState.rooms[SINGLE_ROOM_ID].gameCode = newGameCode;
      globalState.rooms[SINGLE_ROOM_ID].gamePhase = 'lobby';
      globalState.rooms[SINGLE_ROOM_ID].gameStatus = 'lobby';
      globalState.rooms[SINGLE_ROOM_ID].gameStarted = false;
      globalState.rooms[SINGLE_ROOM_ID].currentRound = 0;
      
      updateRoomList();
      saveState();
    }
  })();
}
  else {
  console.log('✅ Main game room already exists in memory:', SINGLE_ROOM_ID);
  console.log('   Room details:', {
    roomId: globalState.rooms[SINGLE_ROOM_ID].roomId,
    gameStarted: globalState.rooms[SINGLE_ROOM_ID].gameStarted,
    playerCount: Object.keys(globalState.rooms[SINGLE_ROOM_ID].players).length,
    currentRound: globalState.rooms[SINGLE_ROOM_ID].currentRound
  });
}
// ============================================

// Auto-save every 2 minutes
setInterval(() => {
  saveState();
  console.log('🔄 Auto-save completed');
}, 2 * 60 * 1000);

// Save on shutdown
process.on('SIGINT', () => {
  console.log('\n⚠️  Server shutting down...');
  saveState();
  console.log('✅ Final save completed');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Server terminating...');
  saveState();
  console.log('✅ Final save completed');
  process.exit(0);
});

// Password functions
// (crypto already required at top of file)

// Simple password hashing (for educational use - in production use bcrypt)
// Using SHA256 with salt for better security
function hashPassword(password) {
  const salt = 'bretton-woods-2024'; // Static salt for consistency
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

function verifyPassword(password, hashedPassword) {
  return hashPassword(password) === hashedPassword;
}

// Helper to update room list
function updateRoomList() {
  globalState.roomList = Object.keys(globalState.rooms).map(roomId => {
    const room = globalState.rooms[roomId];
    const playerCount = Object.keys(room.players).length;
    
    return {
      id: roomId,
      name: room.roomName,
      host: room.hostId,
      playerCount: playerCount,
      maxPlayers: room.maxPlayers,
      status: room.gameStarted ? 'playing' : 'waiting',
      phase: room.gamePhase,
      createdAt: room.createdAt
    };
  });
}

// Broadcast to specific room
function broadcastToRoom(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return;
  
  // DEBUG: Log what we're broadcasting
  console.log(`📡 Broadcasting stateUpdate for ${roomId}:`, {
    gameStarted: room.gameStarted,
    gamePhase: room.gamePhase,
    currentRound: room.currentRound,
    phase2Active: room.phase2?.active,
    phase2Year: room.phase2?.currentYear,
    readyPlayersCount: room.readyPlayers?.length,
    playersCount: Object.keys(room.players).length,
    scores: room.scores,
    roundScores: room.roundScores
  });
  
  io.to(roomId).emit('stateUpdate', room);
}

// Broadcast room list to lobby
function broadcastRoomList() {
  updateRoomList();
  io.emit('roomListUpdate', globalState.roomList);
}

// ============================================
// PHASE 2: POST-WAR ECONOMIC MANAGEMENT (1946-1952)
// ============================================

function initializePhase2(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return;
  
  const gameDataPath = path.join(__dirname, 'game-data.json');
  const gameData = JSON.parse(fs.readFileSync(gameDataPath, 'utf8'));
  const initialEconomicData = gameData.economicData;
  
  room.phase2.active = true;
  room.phase2.currentYear = 1946;
  room.phase2.policies = {};
  room.phase2.deployments = room.phase2.deployments || [];
  room.phase2.conflicts = room.phase2.conflicts || [];
  room.phase2.battleDecisions = room.phase2.battleDecisions || [];
  room.gamePhase = 'phase2';
  room.readyPlayers = [];
  
  // Initialize starting economic conditions for each country
  room.phase2.yearlyData[1946] = {};
  Object.values(room.players).forEach(player => {
    const country = player.country;
    const initialData = initialEconomicData[country];
    
    room.phase2.yearlyData[1946][country] = {
      gdpGrowth: 0,
      goldReserves: initialData.goldReserves,
      unemployment: country === 'USA' ? 3.9 : country === 'UK' ? 2.5 : country === 'USSR' ? 0 : country === 'France' ? 4.5 : country === 'China' ? 6.0 : country === 'India' ? 7.0 : 5.0,
      tradeBalance: initialData.tradeBalance,
      inflation: country === 'USA' ? 8.3 : country === 'UK' ? 3.1 : country === 'USSR' ? 0 : country === 'France' ? 50.0 : country === 'China' ? 300.0 : 20.0,
      industrialOutput: initialData.industrialOutput,
      military: {
        army: initialData.military.army,
        navy: initialData.military.navy,
        airForce: initialData.military.airForce,
        total: initialData.military.total
      }
    };
  });
  
  console.log(`Phase 2 initialized for room ${roomId}: Post-war economic management begins (1946-1952)`);
}

function calculateAgreementBonus(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return {};
  
  const bonus = {};
  const roundHistory = room.roundHistory || [];
  
  // Analyze each country's Bretton Woods positions
  Object.values(room.players).forEach(player => {
    const country = player.country;
    let gdpBonus = 0;
    let tradeBonus = 0;
    let cooperationBonus = 0;
    
    roundHistory.forEach((round, idx) => {
      const playerVote = room.votes[player.playerId];
      const winningOption = round.winningOption;
      
      if (!playerVote || !winningOption) return;
      
      // Issue-specific bonuses based on historical outcomes
      const issueTitle = round.issueTitle || '';
      
      // Voted with majority = cooperation benefit
      if (playerVote === winningOption) {
        cooperationBonus += 0.3; // GDP bonus for being part of consensus
        
        // Specific issue bonuses
        if (issueTitle.includes('IMF') || issueTitle.includes('loans')) {
          // Supporting IMF/loans = better access to capital
          tradeBonus += 200; // Million USD trade balance improvement
        }
        
        if (issueTitle.includes('tariff') || issueTitle.includes('trade')) {
          // Supporting free trade = trade benefits
          gdpBonus += 0.4;
          tradeBonus += 300;
        }
        
        if (issueTitle.includes('gold') || issueTitle.includes('currency')) {
          // Supporting gold standard = monetary stability
          gdpBonus += 0.2;
        }
        
        if (issueTitle.includes('World Bank') || issueTitle.includes('development')) {
          // Supporting development aid = reconstruction benefits
          gdpBonus += 0.3;
        }
      } else {
        // Voted against majority = isolation penalty
        cooperationBonus -= 0.1;
      }
    });
    
    // Store detailed bonuses
    bonus[country] = {
      gdpBonus: gdpBonus + cooperationBonus,
      tradeBonus: tradeBonus,
      description: `Bretton Woods alignment: ${cooperationBonus > 0 ? 'cooperative' : 'isolated'}`
    };
  });
  
  return bonus;
}

// Map crisis country names to database country codes
const CRISIS_COUNTRY_MAPPING = {
  'USA': 'USA',
  'UK': 'UK',
  'France': 'FRA',
  'USSR': 'USS',      // Crisis uses 'USSR', database uses 'USS'
  'China': 'CHN',
  'India': 'IND',
  'Argentina': 'ARG'
};

// Reverse map: codes to names
const CRISIS_CODE_TO_NAME = {
  'USA': 'USA',
  'UK': 'UK',
  'FRA': 'France',
  'USS': 'USSR',
  'CHN': 'China',
  'IND': 'India',
  'ARG': 'Argentina'
};

// Convert country code to name for frontend
function getCountryNameFromCode(countryCode) {
  return CRISIS_CODE_TO_NAME[countryCode] || countryCode;
}

// Convert country name to code for database
function getCountryCodeFromName(countryName) {
  return CRISIS_COUNTRY_MAPPING[countryName] || countryName;
}

// Transform crisis options from display names to country codes
// Only include countries that are actually playing in the game
function transformCrisisOptions(crisisEvent, playingCountryNames = []) {
  if (!crisisEvent.options) return crisisEvent;
  
  // Convert country names to codes for filtering
  const playingCountryCodes = playingCountryNames.map(name => getCountryCodeFromName(name));
  
  // Keep options keyed by NAMES so frontend can look them up with playerCountry
  const transformedOptions = {};
  for (const countryName in crisisEvent.options) {
    const countryCode = getCountryCodeFromName(countryName);
    // Only include if country is playing, or if no filter provided (include all)
    if (playingCountryCodes.length === 0 || playingCountryCodes.includes(countryCode)) {
      // Store with NAME as key so frontend can look up by playerCountry (which is a name)
      transformedOptions[countryName] = crisisEvent.options[countryName];
    }
  }
  
  // Filter affected countries to only those playing (keep as names for frontend)
  const filteredAffectedCountries = playingCountryNames.length > 0 
    ? crisisEvent.affectedCountries.filter(name => {
        const code = getCountryCodeFromName(name);
        return playingCountryCodes.includes(code);
      })
    : crisisEvent.affectedCountries;
  
  return {
    ...crisisEvent,
    affectedCountries: filteredAffectedCountries,
    options: transformedOptions
  };
}

// Trigger crisis events if appropriate for current year
function triggerCrisisIfNeeded(roomId, year) {
  const room = globalState.rooms[roomId];
  if (!room) return;
  
  // Check if there's already an active crisis
  if (room.phase2.crises.active) {
    console.log(`Crisis already active, skipping trigger for year ${year}`);
    return;
  }
  
  // Find crisis events for this year that haven't been triggered yet
  const availableCrisis = crisisEventsData.crisisEvents.find(event => 
    event.year === year && 
    !room.phase2.crises.history.find(h => h.id === event.id)
  );
  
  if (availableCrisis) {
    // Get the list of countries that are actually playing (as names)
    const playingCountryNames = Object.values(room.players).map(p => p.country);
    
    console.log(`🚨 Triggering crisis: ${availableCrisis.title} for year ${year}`);
    console.log(`Playing countries:`, playingCountryNames);
    
    const transformedCrisis = transformCrisisOptions(availableCrisis, playingCountryNames);
    room.phase2.crises.active = {
      ...transformedCrisis,
      triggeredAt: Date.now(),
      resolved: false
    };
    room.phase2.crises.responses = {};
    
    console.log(`✋ Crisis active - waiting for player responses`);
    console.log(`Affected countries (filtered):`, transformedCrisis.affectedCountries);
    console.log(`Transformed options keys:`, Object.keys(room.phase2.crises.active.options));
    console.log(`Playing countries:`, playingCountryNames);
    console.log(`Full transformed crisis options:`, JSON.stringify(Object.keys(room.phase2.crises.active.options)));
  }
}

function calculateYearEconomics(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return;
  
  const currentYear = room.phase2.currentYear;
  const policies = room.phase2.policies[currentYear] || {};
  const prevYearData = room.phase2.yearlyData[currentYear];
  
  if (!prevYearData) return;
  
  // Initialize next year's data
  const nextYear = currentYear + 1;
  room.phase2.yearlyData[nextYear] = {};
  
  // Get Bretton Woods agreements impact
  const agreementBonuses = calculateAgreementBonus(roomId);
  
  // STEP 1: Calculate average global economic conditions
  const allCountries = Object.values(room.players).map(p => p.country);
  let globalAvgTariff = 0;
  let globalAvgExchangeRate = 0;
  let globalAvgInterestRate = 0;
  let countriesWithPolicies = 0;
  
  allCountries.forEach(country => {
    const policy = policies[country];
    if (policy) {
      globalAvgTariff += policy.tariffRate;
      globalAvgExchangeRate += policy.exchangeRate;
      globalAvgInterestRate += policy.centralBankRate;
      countriesWithPolicies++;
    }
  });
  
  if (countriesWithPolicies > 0) {
    globalAvgTariff /= countriesWithPolicies;
    globalAvgExchangeRate /= countriesWithPolicies;
    globalAvgInterestRate /= countriesWithPolicies;
  }
  
  // STEP 2: Calculate each country's economics with cross-country effects
  const tempResults = {}; // Store intermediate results
  
  Object.values(room.players).forEach(player => {
    const country = player.country;
    const policy = policies[country];
    const prevData = prevYearData[country];
    
    if (!policy || !prevData) {
      // If no policy submitted, use defaults with penalty
      tempResults[country] = {
        ...prevData,
        gdpGrowth: -2.0,
        industrialOutput: prevData.industrialOutput * 0.98
      };
      return;
    }
    
    // Economic calculation model with DYNAMIC CROSS-COUNTRY EFFECTS
    const isCommandEconomy = policy.isCommandEconomy || false;
    
    // Extract policy variables based on economy type
    let centralBankRate, exchangeRate, tariffRate;
    if (isCommandEconomy) {
      // Command economies don't use market mechanisms
      centralBankRate = 0; // No independent central bank
      exchangeRate = 1.0; // Fixed by state
      tariffRate = 50; // High barriers, autarky
    } else {
      centralBankRate = policy.centralBankRate || 3.0;
      exchangeRate = policy.exchangeRate || 1.0;
      tariffRate = policy.tariffRate || 10;
    }
    
    const militarySpending = policy.militarySpending || 5;
    
    // NEW: Military branch breakdown
    const armySize = policy.armySize || prevData.military.army;
    const navySize = policy.navySize || prevData.military.navy;
    const airForceSize = policy.airForceSize || prevData.military.airForce;
    const totalMilitary = armySize + navySize + airForceSize;
    
    // Base growth rate (post-war boom)
    let gdpGrowth = 4.0;
    let tradeBalance = prevData.tradeBalance; // Initialize early - used in military effects
    
    // === MILITARY ECONOMIC IMPACT (BRANCH-SPECIFIC) ===
    // Military spending as % of GDP
    const milSpending = militarySpending || 5;
    
    // Calculate actual cost based on branch composition
    // Army: $1 per soldier (cheap - food, basic equipment)
    // Navy: $4 per sailor (ships, fuel, maintenance)
    // Air Force: $6 per airman (planes, fuel, high-tech equipment)
    const armyCost = armySize * 1;
    const navyCost = navySize * 4;
    const airForceCost = airForceSize * 6;
    const totalMilitaryCost = armyCost + navyCost + airForceCost;
    
    // Calculate effective military spending based on force structure
    const gdp = country === 'USA' ? 210000 : country === 'UK' ? 61000 : country === 'USSR' ? 126000 : country === 'France' ? 37000 : country === 'China' ? 45000 : country === 'India' ? 55000 : 32000;
    const effectiveMilSpending = (totalMilitaryCost / (gdp * 10)) * 100; // Convert to % of GDP
    
    // High military spending drains civilian economy
    if (effectiveMilSpending > 10) {
      gdpGrowth -= (effectiveMilSpending - 10) * 0.15; // Each % above 10 hurts growth
    }
    
    // But some military spending stimulates industry (Keynesian effect)
    if (effectiveMilSpending >= 5 && effectiveMilSpending <= 8) {
      gdpGrowth += 0.3; // Optimal military-industrial stimulus
    }
    
    // Large standing army reduces civilian workforce
    const laborForceImpact = (totalMilitary / 1000000) * -0.2; // Per million troops
    gdpGrowth += laborForceImpact;
    
    // Navy protects trade routes (if you have a navy)
    if (navySize > 100000) {
      tradeBalance += (navySize / 100000) * 150; // Large navy protects commerce
    }
    
    // Air Force provides strategic capabilities but very expensive
    if (airForceSize > 200000) {
      gdpGrowth -= 0.3; // High-tech maintenance burden
    }
    
    // Central bank rate impact
    const optimalCBRate = 3.0;
    const cbRateDeviation = Math.abs(centralBankRate - optimalCBRate);
    gdpGrowth -= cbRateDeviation * 0.5;
    
    // === DYNAMIC TRADE EFFECTS ===
    // Calculate trade competitiveness vs other countries
    let tradeCompetitiveness = 0;
    
    allCountries.forEach(otherCountry => {
      if (otherCountry === country) return;
      
      const otherPolicy = policies[otherCountry];
      if (!otherPolicy) return;
      
      // Exchange rate competitiveness
      // If your currency is weaker (lower exchangeRate), you export more
      const exchangeRateDiff = otherPolicy.exchangeRate - exchangeRate;
      tradeCompetitiveness += exchangeRateDiff * 0.3; // Boosts GDP if you're more competitive
      
      // Tariff barriers hurt trade
      // If they have high tariffs, you can't export to them as much
      const theirTariffImpact = (otherPolicy.tariffRate - 15) * -20; // They block your exports
      const yourTariffImpact = (tariffRate - 15) * -30; // You block your own imports
      
      tradeBalance += theirTariffImpact + yourTariffImpact;
      
      // If both countries have low tariffs, trade flourishes
      if (tariffRate < 20 && otherPolicy.tariffRate < 20) {
        tradeBalance += 100; // Mutual trade benefit
        gdpGrowth += 0.2; // Trade-driven growth
      }
      
      // Currency wars: if you devalue aggressively while others don't, they retaliate
      if (exchangeRate < 0.8 && otherPolicy.exchangeRate > 1.1) {
        gdpGrowth -= 0.5; // Backlash from competitive devaluation
      }
      
      // === MILITARY TENSION & ARMS RACE ===
      const otherMilSpending = otherPolicy.militarySpending || 5;
      const otherArmySize = otherPolicy.armySize || 500000;
      const otherNavySize = otherPolicy.navySize || 100000;
      const otherAirForceSize = otherPolicy.airForceSize || 100000;
      const otherTotalMilitary = otherArmySize + otherNavySize + otherAirForceSize;
      
      // Arms race: if they heavily militarize, you feel pressure
      // Specific rivalries
      const isRival = (
        (country === 'USA' && otherCountry === 'USSR') ||
        (country === 'USSR' && otherCountry === 'USA') ||
        (country === 'UK' && otherCountry === 'USSR') ||
        (country === 'USSR' && (otherCountry === 'UK' || otherCountry === 'France'))
      );
      
      if (isRival) {
        // If rival has much larger military, you lose influence
        if (otherTotalMilitary > totalMilitary * 1.5) {
          gdpGrowth -= 0.3; // Lost influence hurts economy
          tradeBalance -= 200; // Less favorable trade terms
        }
        
        // Naval rivalry for maritime powers
        if ((country === 'UK' || country === 'USA') && otherNavySize > navySize * 1.3) {
          tradeBalance -= 300; // Lost sea control hurts trade
        }
        
        // If rival spends heavily on military (>12%), creates tension
        if (otherMilSpending > 12) {
          // If you don't match, you lose strategic position
          if (milSpending < otherMilSpending - 3) {
            gdpGrowth -= 0.4; // Strategic weakness
          }
        }
      }
      
      // Military spending affects trade relations
      // Countries with similar military spending cooperate better
      const milSpendingDiff = Math.abs(milSpending - otherMilSpending);
      if (milSpendingDiff < 3 && milSpending < 10) {
        tradeBalance += 50; // Peaceful cooperation
      }
    });
    
    // Apply trade competitiveness to GDP
    gdpGrowth += tradeCompetitiveness;
    
    // === GLOBAL ECONOMIC SYNCHRONIZATION ===
    // If everyone raises interest rates together, global slowdown
    if (globalAvgInterestRate > 6) {
      gdpGrowth -= 1.5; // Global recession
    }
    
    // If everyone lowers rates together, global boom (but inflation)
    if (globalAvgInterestRate < 2) {
      gdpGrowth += 1.0; // Global stimulus
    }
    
    // === TRADE BLOC EFFECTS ===
    // Countries with similar tariff policies benefit from coordination
    const tariffDeviation = Math.abs(tariffRate - globalAvgTariff);
    if (tariffDeviation < 10) {
      gdpGrowth += 0.3; // Benefit from coordinated trade policy
    }
    
    // === CAPITAL FLOWS ===
    // High interest rates attract capital (helps balance of payments)
    if (centralBankRate > globalAvgInterestRate + 2) {
      tradeBalance += 500; // Capital inflows
    } else if (centralBankRate < globalAvgInterestRate - 2) {
      tradeBalance -= 300; // Capital outflows
    }
    
    // Bretton Woods agreement bonuses
    const bwBonus = agreementBonuses[country] || { gdpBonus: 0, tradeBonus: 0 };
    gdpGrowth += bwBonus.gdpBonus;
    tradeBalance += bwBonus.tradeBonus;
    
    // Country-specific modifiers
    if (country === 'USSR') {
      // USSR command economy effects
      if (policy.isCommandEconomy) {
        // Five-Year Plan effects
        const planTarget = policy.fiveYearPlanTarget || 8;
        const heavyIndustry = policy.heavyIndustryAllocation || 60;
        const foreignTrade = policy.foreignTradeOrientation || 50; // 0=COMECON, 100=West
        const planPriority = policy.planFulfillmentPriority || 70;
        
        // Five-Year Plan ambitious targets
        if (planTarget > 10) {
          gdpGrowth += (planTarget - 10) * 0.3; // Rapid industrialization
          inflation += (planTarget - 10) * 0.5; // But creates shortages/inflation
        }
        
        // Heavy industry focus
        if (heavyIndustry > 60) {
          industrialOutput *= 1.01 + ((heavyIndustry - 60) / 100); // Strong industrial growth
        }
        
        // Foreign Trade Orientation (replaces tariffs)
        // Ministry of Foreign Trade controls via state monopoly
        if (foreignTrade < 30) {
          // COMECON-oriented (bilateral barter with socialist bloc)
          tradeBalance -= 400; // Limited hard currency, barter inefficiency
          gdpGrowth += 0.3; // But political solidarity benefits
        } else if (foreignTrade > 70) {
          // Western-oriented (oil/gas for hard currency + technology)
          tradeBalance += 600; // Export energy for hard currency
          gdpGrowth += 0.5; // Technology imports boost productivity
          // But political vulnerability
        } else {
          // Balanced approach
          tradeBalance += 100; // Modest hard currency earnings
        }
        
        // Plan Fulfillment Priority (replaces interest rates)
        // Gosbank credit allocation rigor
        if (planPriority > 80) {
          // Strict credit allocation to meet plan targets
          gdpGrowth += 0.4; // Strong plan fulfillment
          inflation += 1.0; // But bottlenecks create shortages
        } else if (planPriority < 60) {
          // More enterprise flexibility
          gdpGrowth -= 0.3; // Weaker coordination
          inflation -= 0.5; // But less pressure = fewer shortages
        }
      }
      
      // Marshall Plan isolation (from 1948)
      if (currentYear >= 1948) {
        gdpGrowth -= 1.0; // Isolation from Marshall Plan
        tradeBalance -= 400; // Additional Western trade cutoff
      }
    }
    
    if (country === 'China') {
      // Chinese Civil War (1946-1949) - intensifying effects
      if (currentYear <= 1949) {
        const warIntensity = {
          1946: -1.0,  // War resumes after WWII
          1947: -1.5,  // Escalation
          1948: -2.5,  // Major battles
          1949: -4.0   // Final decisive campaigns
        };
        
        gdpGrowth += (warIntensity[currentYear] || -1.0); // Negative growth from civil war
        tradeBalance -= (currentYear - 1945) * 200; // Worsening trade disruption
        // Note: Unemployment and inflation increases handled later in their respective sections
      }
      
      // Communist China (post-1949) - command economy
      if (currentYear >= 1949 && policy.isCommandEconomy) {
        const planTarget = policy.fiveYearPlanTarget || 8;
        const foreignTrade = policy.foreignTradeOrientation || 40; // More COMECON-oriented initially
        const planPriority = policy.planFulfillmentPriority || 75;
        
        // Great Leap Forward preparation / early industrialization
        if (planTarget > 12) {
          gdpGrowth += (planTarget - 12) * 0.2; // Aggressive targets
          inflation += (planTarget - 12) * 0.8; // But creates chaos
        }
        
        // Foreign trade orientation
        if (foreignTrade < 30) {
          // Heavy COMECON reliance (Soviet aid)
          tradeBalance -= 200; // Barter inefficiency
          gdpGrowth += 0.2; // Soviet technical assistance
        } else if (foreignTrade > 70) {
          // Attempting Western trade (difficult post-1949)
          tradeBalance += 200; // Some hard currency
          // But Western embargo limits this
        }
        
        // Strict plan fulfillment
        if (planPriority > 80) {
          gdpGrowth += 0.3; // Mobilization
          inflation += 1.2; // Severe bottlenecks in recovering economy
        }
        
        // Post-civil war recovery penalty
        gdpGrowth -= 1.5; // Still recovering from devastation
        tradeBalance -= 200; // Limited foreign trade capacity
      }
    }
    
    if (country === 'India' && currentYear >= 1947) {
      gdpGrowth += 1.0; // Independence boost
    }
    
    if (country === 'USA') {
      // USA benefits from being reserve currency
      tradeBalance += 400; // Dollar demand
    }
    
    // Random shock
    const randomShock = (Math.random() - 0.5) * 2;
    gdpGrowth += randomShock;
    
    // === INFLATION (affected by global conditions) ===
    let inflation = prevData.inflation;
    
    // China civil war effect on inflation (agricultural disruption)
    if (country === 'China' && currentYear >= 1948 && currentYear <= 1949) {
      inflation += 3.0; // Severe shortages from agricultural collapse
    }
    
    // Your own interest rate
    if (centralBankRate < 2.0) {
      inflation += (2.0 - centralBankRate) * 2.0;
    } else if (centralBankRate > 5.0) {
      inflation -= (centralBankRate - 5.0) * 1.5;
    }
    
    // Global inflationary pressure
    if (globalAvgInterestRate < 2.5) {
      inflation += 1.5; // Global loose money
    }
    
    // Competitive devaluation causes import inflation
    if (exchangeRate < 0.9) {
      inflation += (0.9 - exchangeRate) * 5; // Weak currency = expensive imports
    }
    
    inflation = Math.max(0, inflation + (Math.random() - 0.5) * 3);
    
    // === UNEMPLOYMENT ===
    let unemployment = prevData.unemployment;
    
    // China civil war effect on unemployment
    if (country === 'China' && currentYear <= 1949) {
      unemployment += (currentYear - 1945) * 0.5; // Rising unemployment from civil war
    }
    
    if (gdpGrowth > 3.0) {
      unemployment -= (gdpGrowth - 3.0) * 0.3;
    } else if (gdpGrowth < 2.0) {
      unemployment += (2.0 - gdpGrowth) * 0.4;
    }
    
    // High tariffs protect jobs but reduce efficiency
    if (tariffRate > 30) {
      unemployment -= 0.5; // Protected jobs
      gdpGrowth -= 0.3; // But less efficient
    }
    
    unemployment = Math.max(0, Math.min(15, unemployment));
    
    // === INDUSTRIAL OUTPUT ===
    let industrialOutput = prevData.industrialOutput;
    industrialOutput *= (1 + gdpGrowth / 100);
    
    // === GOLD RESERVES ===
    let goldReserves = prevData.goldReserves;
    if (tradeBalance > 0) {
      goldReserves += tradeBalance * 0.01;
    } else {
      goldReserves += tradeBalance * 0.02; // Lose gold faster with deficits
    }
    goldReserves = Math.max(0, goldReserves);
    
    // Store results
    tempResults[country] = {
      gdpGrowth: Math.round(gdpGrowth * 10) / 10,
      goldReserves: Math.round(goldReserves),
      unemployment: Math.round(unemployment * 10) / 10,
      tradeBalance: Math.round(tradeBalance),
      inflation: Math.round(inflation * 10) / 10,
      industrialOutput: Math.round(industrialOutput),
      militarySpending: milSpending,
      military: {
        army: armySize,
        navy: navySize,
        airForce: airForceSize,
        total: totalMilitary
      }
    };
  });
  
  // STEP 3: Save all results
  Object.keys(tempResults).forEach(country => {
    room.phase2.yearlyData[nextYear][country] = tempResults[country];
  });
  
  console.log(`Calculated economics for year ${nextYear} in room ${roomId} with cross-country dynamics`);
  
  // Sync economic state to MySQL (hybrid persistence)
  Object.keys(tempResults).forEach(country => {
    const state = tempResults[country];
    db.saveEconomicState(roomId, country, nextYear, state)
      .then(() => console.log(`📊 Economic state synced to MySQL: ${country} (${nextYear})`))
      .catch(err => console.error(`MySQL sync error (economic state ${country}):`, err.message));
  });
}

function calculatePhase2Scores(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return;
  
  const phase2Scores = {};
  const scoreBreakdowns = {};
  
  Object.values(room.players).forEach(player => {
    const country = player.country;
    let score = 0;
    const breakdown = {
      gdp: 0,
      inflation: 0,
      unemployment: 0,
      trade: 0,
      stability: 0,
      brettonWoods: 0
    };
    
    // Calculate average performance
    let totalGDP = 0, totalInflation = 0, totalUnemployment = 0, yearsCount = 0;
    let positiveTradeYears = 0;
    
    for (let year = 1947; year <= 1952; year++) {
      const data = room.phase2.yearlyData[year]?.[country];
      if (data) {
        totalGDP += data.gdpGrowth;
        totalInflation += data.inflation;
        totalUnemployment += data.unemployment;
        if (data.tradeBalance > 0) positiveTradeYears++;
        yearsCount++;
      }
    }
    
    if (yearsCount > 0) {
      const avgGDP = totalGDP / yearsCount;
      const avgInflation = totalInflation / yearsCount;
      const avgUnemployment = totalUnemployment / yearsCount;
      
      // GDP Growth: 10 pts per % (increased importance)
      breakdown.gdp = Math.round(avgGDP * 10);
      score += breakdown.gdp;
      
      // Inflation control (inverse scoring)
      if (avgInflation < 3) {
        breakdown.inflation = 50; // Excellent price stability
      } else if (avgInflation < 5) {
        breakdown.inflation = 40;
      } else if (avgInflation < 10) {
        breakdown.inflation = 25;
      } else if (avgInflation < 20) {
        breakdown.inflation = 10;
      } else {
        breakdown.inflation = -10; // Hyperinflation penalty
      }
      score += breakdown.inflation;
      
      // Unemployment (inverse scoring)
      if (avgUnemployment < 2) {
        breakdown.unemployment = 40; // Full employment
      } else if (avgUnemployment < 4) {
        breakdown.unemployment = 30;
      } else if (avgUnemployment < 6) {
        breakdown.unemployment = 15;
      } else if (avgUnemployment < 10) {
        breakdown.unemployment = 5;
      } else {
        breakdown.unemployment = -5; // High unemployment penalty
      }
      score += breakdown.unemployment;
      
      // Trade balance consistency
      breakdown.trade = positiveTradeYears * 8; // 8 pts per year with positive balance
      score += breakdown.trade;
      
      // Economic stability bonus (low variance)
      let gdpVariance = 0;
      for (let year = 1947; year <= 1952; year++) {
        const data = room.phase2.yearlyData[year]?.[country];
        if (data) {
          gdpVariance += Math.abs(data.gdpGrowth - avgGDP);
        }
      }
      const avgVariance = gdpVariance / yearsCount;
      if (avgVariance < 1.5) {
        breakdown.stability = 30; // Very stable growth
      } else if (avgVariance < 3) {
        breakdown.stability = 15;
      } else if (avgVariance < 5) {
        breakdown.stability = 5;
      }
      score += breakdown.stability;
      
      // Bretton Woods cooperation bonus
      const agreementBonuses = calculateAgreementBonus(roomId);
      const bwBonus = agreementBonuses[country];
      if (bwBonus) {
        // Award points for being part of Bretton Woods system
        breakdown.brettonWoods = Math.round((bwBonus.gdpBonus + bwBonus.tradeBonus / 100) * 5);
        score += breakdown.brettonWoods;
      }
      
      // Crisis diplomatic points
      if (room.phase2.diplomaticPoints && room.phase2.diplomaticPoints[country]) {
        breakdown.crisisDiplomacy = room.phase2.diplomaticPoints[country] * 2; // 2 pts per diplomatic point
        score += breakdown.crisisDiplomacy;
      }
    }
    
    phase2Scores[country] = Math.round(score);
    scoreBreakdowns[country] = breakdown;
    room.scores[country] = (room.scores[country] || 0) + phase2Scores[country];
  });
  
  // Store breakdowns for display
  room.phase2.scoreBreakdowns = scoreBreakdowns;
  
  console.log(`Phase 2 final scores:`, phase2Scores);
  console.log(`Score breakdowns:`, scoreBreakdowns);
  
  // Sync final results to MySQL (hybrid persistence)
  Object.entries(phase2Scores).forEach(([country, score]) => {
    db.createNewGame(roomId, country, score, scoreBreakdowns[country])
      .then(() => console.log(`📊 Final result synced to MySQL: ${country} -> ${score}`))
      .catch(err => console.error(`MySQL sync error (result ${country}):`, err.message));
  });
  
  return phase2Scores;
}

// Helper function to resolve crisis and apply effects
function resolveCrisisEffects(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return false;
  
  const crisis = room.phase2.crises.active;
  if (!crisis) return false;
  
  const responses = room.phase2.crises.responses;
  const currentYear = room.phase2.currentYear;
  
  console.log(`=== AUTO-RESOLVING CRISIS: ${crisis.title} ===`);
  
  // Apply each country's choice effects
  Object.entries(responses).forEach(([country, response]) => {
    const choice = response.choice;
    const effects = choice.effects || {};
    
    // Get or create year data for this country
    if (!room.phase2.yearlyData[currentYear]) {
      room.phase2.yearlyData[currentYear] = {};
    }
    if (!room.phase2.yearlyData[currentYear][country]) {
      // Initialize with previous year data if missing
      const prevYear = currentYear - 1;
      room.phase2.yearlyData[currentYear][country] = {
        ...room.phase2.yearlyData[prevYear]?.[country]
      };
    }
    
    const yearData = room.phase2.yearlyData[currentYear][country];
    
    // Apply economic effects
    if (effects.gdpGrowth) yearData.gdpGrowth = (yearData.gdpGrowth || 0) + effects.gdpGrowth;
    if (effects.tradeBalance) yearData.tradeBalance = (yearData.tradeBalance || 0) + effects.tradeBalance;
    if (effects.inflation) yearData.inflation = (yearData.inflation || 0) + effects.inflation;
    if (effects.unemployment) yearData.unemployment = (yearData.unemployment || 0) + effects.unemployment;
    
    // Apply diplomatic points (stored separately, counted in final scoring)
    if (effects.diplomaticPoints) {
      if (!room.phase2.diplomaticPoints) room.phase2.diplomaticPoints = {};
      room.phase2.diplomaticPoints[country] = (room.phase2.diplomaticPoints[country] || 0) + effects.diplomaticPoints;
    }
    
    console.log(`  ${country}: ${choice.text}`);
    if (Object.keys(effects).length > 0) {
      console.log(`    Effects:`, effects);
    }
  });
  
  // Move crisis to history
  room.phase2.crises.history.push({
    ...crisis,
    responses,
    resolvedAt: Date.now(),
    autoResolved: true
  });
  
  room.phase2.crises.active = null;
  room.phase2.crises.responses = {};
  
  console.log(`✅ Crisis auto-resolved - ${Object.keys(responses).length} countries responded`);
  
  saveState();
  return true;
}

// ============================================
// END PHASE 2 FUNCTIONS
// ============================================

// Socket connection
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Send current room list
  socket.emit('roomListUpdate', globalState.roomList);
  
  // Register new user
  socket.on('register', async ({ username, password }) => {
    if (!username || !password) {
      socket.emit('registerResult', { success: false, message: 'Username and password required' });
      return;
    }
    
    // Check memory first
    if (globalState.users[username]) {
      socket.emit('registerResult', { success: false, message: 'Username already exists' });
      return;
    }
    
    // Check database for existing user
    try {
      const existingUser = await db.getUser(username);
      if (existingUser) {
        socket.emit('registerResult', { success: false, message: 'Username already exists' });
        return;
      }
    } catch (err) {
      console.warn('⚠️ Could not check DB for user:', err.message);
    }
    
 // In the 'register' socket event, replace the playerId generation line:

// OLD:
// const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// NEW:
const playerId = getNextPlayerId();   
    // Only jjucovy@gmail.com is the super admin
    const isSuperAdmin = username.toLowerCase() === 'jjucovy@gmail.com' || username.toLowerCase() === 'jjucovy';
    const role = isSuperAdmin ? 'superadmin' : 'player';
    const hashedPassword = hashPassword(password);
    
    // Save to memory
    globalState.users[username] = {
      password: hashedPassword,
      playerId: playerId,
      createdAt: Date.now(),
      role: role
    };
    
    socket.emit('registerResult', { 
      success: true, 
      playerId: playerId,
      username: username,
      role: role
    });
    
    saveState();
    
    // Save to MySQL database (persistent storage)
    db.createUser(username, hashedPassword, role)
      .then(result => console.log(`📊 User saved to MySQL: ${username}`))
      .catch(err => console.warn('⚠️ MySQL save failed:', err.message));
    
    console.log(`User registered: ${username} (${role})`);
  });
  
  // Login existing user
socket.on('login', async ({ username, password }) => {
  console.log('=== LOGIN REQUEST ===');
  console.log('Username:', username);
  console.log('Raw password:', password);
  
  if (!username || !password) {
    socket.emit('loginResult', { success: false, message: 'Username and password required' });
    return;
  }
  
  let user = globalState.users[username];
  
  // If not in memory, check database
  if (!user) {
    console.log('User not in memory, checking database...');
    try {
      const dbUser = await db.getUser(username);
      console.log('Database response:', dbUser);
      
      if (dbUser) {
        console.log('Found user in database:', {
          username: dbUser.username,
          user_id: dbUser.user_id,
          hasPasswordHash: !!dbUser.password_hash,
          passwordHashLength: dbUser.password_hash ? dbUser.password_hash.length : 0,
          is_teacher: dbUser.is_teacher
        });
        
        // Check if user_id exists
        if (!dbUser.user_id) {
          console.error('❌ ERROR: user_id is missing from database response!');
          socket.emit('loginResult', { 
            success: false, 
            message: 'Database error: user_id missing. Please contact administrator.' 
          });
          return;
        }
        
        // Use user_id with player_db_ prefix (consistent format)
        const playerId = `player_db_${dbUser.user_id}`;
        
        // Determine role - check for superadmin first
        let role = 'player';
        if (username.toLowerCase() === 'jjucovy@gmail.com' || username.toLowerCase() === 'jjucovy') {
          role = 'superadmin';
        } else if (dbUser.is_teacher === '1' || dbUser.is_teacher === 1 || dbUser.is_teacher === true) {
          role = 'teacher';
        }
        
        console.log(`Assigned role: ${role} (is_teacher: ${dbUser.is_teacher})`);
        
        // Load user from database into memory
        globalState.users[username] = {
          password: dbUser.password_hash,
          playerId: playerId,
          userId: dbUser.user_id,
          createdAt: dbUser.created_at ? new Date(dbUser.created_at).getTime() : Date.now(),
          role: role
        };
        user = globalState.users[username];
        
        // Cache the userId for future use
        userIdCache[username] = dbUser.user_id;
        
        console.log('User loaded from database:', username, 'playerId:', playerId, 'role:', role);
        saveState();
      } else {
        console.log('Database returned null or no user found');
      }
    } catch (err) {
      console.error('⚠️ Database error:', err.message);
      console.error('Stack trace:', err.stack);
    }
  } else {
    console.log('User found in memory:', {
      username: username,
      playerId: user.playerId,
      hasPassword: !!user.password,
      passwordLength: user.password ? user.password.length : 0,
      role: user.role
    });
    
    // Make sure userId is cached
    if (user.userId && !userIdCache[username]) {
      userIdCache[username] = user.userId;
    }
  }
  
  if (!user) {
    console.log('ERROR: User not found in database or memory');
    socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
    return;
  }
  
  console.log('User found, role:', user.role || 'undefined');
  
  // Hash the provided password and compare
  const hashedInputPassword = hashPassword(password);
  console.log('Password verification:');
  console.log('  Input password:', password);
  console.log('  Input hashed:', hashedInputPassword);
  console.log('  Stored hash:', user.password);
  console.log('  Match:', hashedInputPassword === user.password);
  
  if (!verifyPassword(password, user.password)) {
    console.log('ERROR: Password incorrect');
    socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
    return;
  }
  
  const role = user.role || 'player';
  console.log('✅ Login successful, role:', role);
  
  // Update last login time
  user.lastLogin = Date.now();
  saveState();
  
  // Check if user is already in an active game
  let activeGame = null;
  try {
    // Use the userId from the user object
    const userId = user.userId;
if (!userId && user.playerId) {
  try {
    const dbUser = await db.getUser(username);
    if (dbUser && dbUser.user_id) {
      user.userId = dbUser.user_id;
      userIdCache[username] = dbUser.user_id;
      console.log(`✅ Fetched missing userId from database: ${dbUser.user_id}`);
    }
  } catch (err) {
    console.warn('⚠️ Could not fetch userId from database');
  }
}
    if (userId) {
      activeGame = await db.getPlayerActiveGame(userId);
      if (activeGame && activeGame.game_status) {
        if (activeGame.game_status === 'phase1_active' || activeGame.game_status === 'phase2_active') {
          console.log(`📊 User ${username} has active game: ${activeGame.game_code} as ${activeGame.country_name}`);
        } else {
          console.log(`⚠️ User ${username} was in game ${activeGame.game_code} but it's no longer active (status: ${activeGame.game_status})`);
          activeGame = null;
        }
      }
    } else {
      console.log(`⚠️ No userId available for ${username} to check active games`);
    }
  } catch (err) {
    console.warn('⚠️ Could not check for active game:', err.message);
  }
  
  socket.emit('loginResult', { 
    success: true, 
    playerId: user.playerId, 
    username: username,
    role: role,
    activeGame: activeGame ? {
      gameCode: activeGame.game_code,
      country: activeGame.country_code,
      countryName: activeGame.country_name,
      status: activeGame.game_status,
      currentRound: activeGame.current_round,
      score: parseInt(activeGame.phase1_score || 0) + parseInt(activeGame.phase2_score || 0)
    } : null
  });
  
  console.log(`User logged in: ${username} (${role})${activeGame ? ` - rejoining ${activeGame.game_code}` : ''}`);
  console.log('====================');
});
  
  // Create new room
  socket.on('createRoom', ({ playerId, roomName }) => {
    // Generate gameCode in format "game1", "game2", etc.
    const gameCode = `game${++gameCodeCounter}`;
    
    // Create game object with gameCode
    const room = createNewGame(gameCode, roomName, playerId);
    room.gameCode = gameCode;  // ✅ Store gameCode in room
    globalState.rooms[gameCode] = room;
    
    socket.join(gameCode);
    socket.emit('roomCreated', { 
      success: true, 
      roomId: gameCode,  // Return gameCode as roomId
      roomName: roomName,
      gameCode: gameCode
    });
    
    broadcastRoomList();
    saveState();
    
    // Sync to MySQL
    (async () => {
      try {
        const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
        const userId = username ? await getUserId(username) : null;
        const result = await db.createNewGame(gameCode, userId || 0);
        if (result && result.game_id) {
          room.gameId = result.game_id;  // ✅ Store actual database game_id
          console.log(`📊 Game created in MySQL: gameCode=${gameCode}, game_id=${result.game_id}`);
        } else {
          console.error(`❌ Failed to create game in MySQL: ${gameCode}`, result);
        }
      } catch (err) {
        console.error(`❌ Error creating game in MySQL: ${gameCode}`, err.message);
      }
    })();
    
    console.log(`✅ Room created: ${roomName} (${gameCode}) by ${playerId}`);
  });
  
  // Join existing room
  socket.on('joinRoom', ({ roomId, playerId }) => {
    if (!globalState.rooms[roomId]) {
      socket.emit('joinRoomResult', { success: false, message: 'Room not found' });
      return;
    }
    
    socket.join(roomId);
    
    // Update socketId for the player so submitPolicy can find them
    const room = globalState.rooms[roomId];
    console.log(`🔗 joinRoom: roomId=${roomId}, playerId=${playerId}`);
    console.log(`   Players in room: ${Object.keys(room.players).map(k => `${k}(${room.players[k].playerId})`).join(', ')}`);
    
    const playerKey = Object.keys(room.players).find(key => {
      const p = room.players[key];
      return p.playerId === playerId || key === playerId;
    });
    if (playerKey && room.players[playerKey]) {
      room.players[playerKey].socketId = socket.id;
      console.log(`✅ Updated socketId for player ${playerKey} (playerId=${playerId}): ${socket.id}`);
    } else {
      console.log(`⚠️  Player not found in room. Looking for ${playerId} but room has: ${Object.keys(room.players).map(k => room.players[k].playerId).join(', ')}`);
    }
    
    socket.emit('joinRoomResult', { 
      success: true, 
      roomId: roomId 
    });
    
    // DEBUG: Log room state when player joins
    console.log(`🔍 Room state for ${roomId}:`, {
      gameStarted: room?.gameStarted,
      gamePhase: room?.gamePhase,
      currentRound: room?.currentRound,
      playersCount: room?.players ? Object.keys(room.players).length : 0,
      players: Object.keys(room.players).map(k => `${k}:${room.players[k].country}`)
    });
    
    broadcastToRoom(roomId);
    console.log(`Player joined room: ${roomId}`);
  });
  
  // Leave room
  socket.on('leaveRoom', ({ roomId }) => {
    socket.leave(roomId);
    socket.emit('leftRoom', { roomId });
    console.log(`Player left room: ${roomId}`);
  });
  
  // Delete room (host only)
  socket.on('deleteRoom', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    
    if (!room) {
      socket.emit('deleteRoomResult', { success: false, message: 'Room not found' });
      return;
    }
    
    if (room.hostId !== playerId) {
      socket.emit('deleteRoomResult', { success: false, message: 'Only host can delete room' });
      return;
    }
    
    // Notify all players in room
    io.to(roomId).emit('roomDeleted', { roomId });
    
    // Delete room
    delete globalState.rooms[roomId];
    
    socket.emit('deleteRoomResult', { success: true });
    broadcastRoomList();
    saveState();
    
    console.log(`Room deleted: ${roomId}`);
  });
  
  // Join game in room
socket.on('joinGame', async ({ roomId, playerId, country }) => {

  // Find the correct active lobby game from database
  const activeLobbyGame = await findActiveLobbyGame();
  
  if (!activeLobbyGame) {
    socket.emit('joinResult', { 
      success: false, 
      message: 'No active game available. Please wait for the teacher to start a new game.' 
    });
    return;
  }
  
  // Use the active lobby game's room ID
  const actualRoomId = 'main-game';  // ✅ Use single-room constant
  console.log(`   Using active lobby game: ${actualRoomId} (game_id: ${activeLobbyGame.gameId})`);
  
  const room = globalState.rooms[actualRoomId];
  
  if (!room) {
    console.error(`❌ Room not found in memory: ${actualRoomId}`);
    socket.emit('joinResult', { 
      success: false, 
      message: `Game not found in server memory. Please refresh and try again.` 
    });
    return;
  }
  
  // Check if game is still in lobby phase
  if (room.gamePhase !== 'lobby') {
    socket.emit('joinResult', { 
      success: false, 
      message: 'This game has already started. Please wait for the next game.' 
    });
    return;
  }
  
  // Check if game is full (max 7 players)
  const currentPlayerCount = Object.keys(room.players).length;
  if (currentPlayerCount >= 7) {
    socket.emit('joinResult', { 
      success: false, 
      message: 'This game is full (7/7 players). Please wait for the next game.' 
    });
    return;
  }
  
  // Prevent superadmin from joining as player
  const user = Object.values(globalState.users).find(u => u.playerId === playerId);
  if (user && user.role === 'superadmin') {
    socket.emit('joinResult', { 
      success: false, 
      message: 'Administrator cannot join as a player. You are an observer.' 
    });
    return;
  }
  
  // Check if country is already taken
  const taken = Object.values(room.players).some(p => p.country === country);
  
  if (taken) {
    socket.emit('joinResult', { 
      success: false, 
      message: 'Country already taken' 
    });
    return;
  }
  
  // Check if this player is already in the game with a different country
  if (room.players[playerId]) {
    socket.emit('joinResult', { 
      success: false, 
      message: `You are already in this game as ${room.players[playerId].country}. Please refresh if you want to change countries.` 
    });
    return;
  }
  
  // Generate incremental player_id for this game
  const gamePlayerId = getNextPlayerId();
  
  // Join the socket to the correct room
  socket.join(actualRoomId);
  
  room.players[playerId] = {
    id: playerId,
    gamePlayerId: gamePlayerId,
    userId: null,  // ✅ Will be set from database lookup
    country: country,
    socketId: socket.id,
    joinedAt: Date.now()
  };
  socket.emit('joinResult', { 
  success: true, 
  gamePlayerId: gamePlayerId,
  roomId: roomId,
  gameId: room.gameId  // ✅ This is correct - room.gameId is the numeric ID
});
  broadcastToRoom(actualRoomId);
  broadcastRoomList();
  saveState();
  
  // Sync to MySQL - add player with correct game_id
  (async () => {
    try {
      const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
      console.log(`🔍 Syncing player to game_id ${activeLobbyGame.gameId}: playerId=${playerId}`);
      
      if (!username) {
        console.warn(`⚠️ Could not find username for playerId ${playerId}`);
        return;
      }
      
      const userId = await getUserId(username);
      console.log(`🔍 Got userId: ${userId || 'NOT FOUND'}`);
      
      if (!userId) {
        console.warn(`⚠️ Could not get MySQL user_id for ${username}`);
        return;
      }
      
      // Get country name and code
      const countryNames = { 
        USA: 'United States', 
        UK: 'United Kingdom', 
        USSR: 'Soviet Union', 
        France: 'France', 
        China: 'China', 
        India: 'India', 
        Argentina: 'Argentina' 
      };
      
      const countryCodes = {
        'USA': 'USA',
        'UK': 'UK',
        'USSR': 'USS',
        'France': 'FRA',
        'China': 'CHN',
        'India': 'IND',
        'Argentina': 'ARG'
      };
      
      const countryName = countryNames[country] || country;
      const countryCode = countryCodes[country] || country;
      
      // Store userId in player object for later use
      room.players[playerId].userId = userId;
      
      // Add player to the correct game using gameCode
      const addPlayerResult = await db.addPlayer(actualRoomId, userId, countryCode, countryName);
      
      if (addPlayerResult && !addPlayerResult.error) {
        console.log(`✅ Player ${username} (${country}) synced to MySQL game ${actualRoomId} (game_id: ${activeLobbyGame.gameId})`);
      } else {
        console.error(`❌ Failed to add player to game:`, addPlayerResult?.error || addPlayerResult);
      }
    } catch (err) {
      console.error(`❌ Error syncing player to MySQL:`, err.message);
    }
  })();
  
  console.log(`✅ Player ${playerId} joined as ${country} in game ${activeLobbyGame.gameId} (${actualRoomId}) with player_id ${gamePlayerId}`);
});
  
  // Rejoin game after disconnect/reconnect
  socket.on('rejoinGame', ({ roomId, playerId, country }) => {
    const room = globalState.rooms[roomId];
    
    if (!room) {
      socket.emit('rejoinResult', { success: false, message: 'Room not found' });
      return;
    }
    
    // Check if player was in this game with this country
    const existingPlayer = room.players[playerId];
    
    if (existingPlayer && existingPlayer.country === country) {
      // Player is rejoining their previous slot
      console.log(`✅ Player ${playerId} rejoining as ${country} in room ${roomId}`);
      
      // Update socket ID and clear disconnected flag
      existingPlayer.socketId = socket.id;
      existingPlayer.disconnected = false;
      delete existingPlayer.disconnectedAt;
      
      socket.emit('rejoinResult', { success: true, country: country });
      broadcastToRoom(roomId);
      saveState();
      
      console.log(`Player ${playerId} reconnected to room ${roomId} as ${country}`);
    } else if (existingPlayer && existingPlayer.country !== country) {
      // Player trying to rejoin as different country
      socket.emit('rejoinResult', { 
        success: false, 
        message: `You were playing as ${existingPlayer.country}. Cannot switch countries mid-game.` 
      });
    } else {
      // Player wasn't in this game
      socket.emit('rejoinResult', { 
        success: false, 
        message: 'You were not in this game. Please select a country.' 
      });
    }
  });
  
  // Leave game in room
  socket.on('leaveGame', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    delete room.players[playerId];
    room.readyPlayers = room.readyPlayers.filter(id => id !== playerId);
    
    broadcastToRoom(roomId);
    broadcastRoomList();
    saveState();
    
    console.log(`Player ${playerId} left game in room ${roomId}`);
  });
  
  // Set ready status
  socket.on('setReady', ({ roomId, playerId, ready }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    if (ready) {
      if (!room.readyPlayers.includes(playerId)) {
        room.readyPlayers.push(playerId);
      }
    } else {
      room.readyPlayers = room.readyPlayers.filter(id => id !== playerId);
    }
    
    broadcastToRoom(roomId);
    saveState();
  });
  
  // SUPERADMIN ONLY: Start game in room
 socket.on('startGame', ({ roomId, playerId, skipPhase1 }) => {
  console.log('=== START GAME REQUEST ===');
  console.log('Room ID:', roomId);
  console.log('Player ID:', playerId);
  console.log('Skip Phase 1:', skipPhase1 || false);
  
  const room = globalState.rooms[roomId];
  if (!room) {
    console.log('ERROR: Room not found');
    socket.emit('startGameResult', { success: false, message: 'Room not found' });
    return;
  }
  
  // Verify game is in lobby
  if (room.gamePhase !== 'lobby') {
    console.log('ERROR: Game not in lobby phase');
    socket.emit('startGameResult', { 
      success: false, 
      message: `Game has already started (phase: ${room.gamePhase})` 
    });
    return;
  }
  
  const user = Object.values(globalState.users).find(u => u.playerId === playerId);
  const isSuperAdmin = user && user.role === 'superadmin';
  const isRoomHost = room.hostId === playerId;
  
  if (!isSuperAdmin && !isRoomHost) {
    console.log('ERROR: Not superadmin or room host');
    socket.emit('startGameResult', { 
      success: false, 
      message: `Only the game admin can start games. Your role: ${user ? user.role : 'not found'}` 
    });
    return;
  }
  
  const playerCount = Object.keys(room.players).length;
  console.log('Player count:', playerCount);
  
  if (playerCount < 2) {
    console.log('ERROR: Not enough players');
    socket.emit('startGameResult', { success: false, message: 'Need at least 2 players to start' });
    return;
  }
  
  // Change from LOBBY to ACTIVE
  room.gameStarted = true;
  
  if (skipPhase1) {
    console.log('🚀 Skipping Phase 1 - Starting directly in Phase 2');
    initializePhase2(roomId);
    room.currentRound = 11;
    room.gamePhase = 'phase2';
    room.gameStatus = 'phase2_active';
    console.log('✅ Phase 2 initialized - Economic management (1946-1952)');
  } else {
    room.gamePhase = 'voting';
    room.gameStatus = 'phase1_active';
    room.currentRound = 1;
    console.log('Starting Phase 1 - Bretton Woods Conference voting');
  }
  
  console.log(`✅ Game status changed: LOBBY → ${room.gameStatus}`);
  
  socket.emit('startGameResult', { success: true });
  broadcastToRoom(roomId);
  broadcastRoomList();
  saveState();
  
  // Sync game start to MySQL using gameCode
  const gameStatus = skipPhase1 ? 'phase2_active' : 'phase1_active';
  db.updateGame(room.gameCode, { status: gameStatus, startedAt: true, currentRound: skipPhase1 ? 11 : 1 }).catch(err => {
    console.error(`❌ Failed to sync game start to MySQL:`, err.message);
  });
  console.log(`📊 Game status synced to MySQL: ${gameStatus}`);
  
  console.log(`Game started in room ${roomId} by admin`);
  console.log('=========================');
});
  
  // Vote on current issue
  socket.on('vote', ({ roomId, playerId, choice }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.gameStarted) {
      console.log('Vote rejected: room not found or game not started');
      return;
    }
    
    // Check player is in game
    if (!room.players[playerId]) {
      console.log('Vote rejected: player not in game');
      return;
    }
    
    // Store vote
    room.votes[playerId] = choice;
    console.log(`Vote received: ${playerId} voted ${choice} in room ${roomId}`);
    
    // Check if all players have voted
    const playerIds = Object.keys(room.players);
    const allVoted = playerIds.every(id => room.votes[id]);
    
    if (allVoted) {
      console.log('All players voted, calculating results...');
      
      // Tally votes
      const voteTally = { a: 0, b: 0, c: 0 };
      Object.values(room.votes).forEach(vote => {
        const normalizedVote = vote.toLowerCase();
        if (voteTally[normalizedVote] !== undefined) {
          voteTally[normalizedVote]++;
        }
      });
      
      // Initialize vote attempt tracker if needed
      if (!room.voteAttempts) room.voteAttempts = {};
      const roundKey = `round_${room.currentRound}`;
      if (!room.voteAttempts[roundKey]) room.voteAttempts[roundKey] = 0;
      room.voteAttempts[roundKey]++;
      
      // Check for tie - find highest vote count
      const voteArray = Object.values(voteTally);
      const maxVotes = Math.max(...voteArray);
      const tiedOptions = Object.entries(voteTally)
        .filter(([_, count]) => count === maxVotes)
        .map(([option, _]) => option);
      
      // Handle tie votes
      if (tiedOptions.length > 1) {
        console.log(`⚠️ TIE DETECTED in round ${room.currentRound}: options ${tiedOptions.join(', ')} tied with ${maxVotes} votes each`);
        console.log(`   Vote attempt ${room.voteAttempts[roundKey]} of 3`);
        
        if (room.voteAttempts[roundKey] >= 3) {
          // After 3 attempts, declare no resolution and skip to next round
          console.log(`❌ No resolution after 3 vote attempts - skipping policy and moving to next round (NO POINTS AWARDED)`);
          room.gamePhase = 'voting';
          room.roundOutcome = `UNRESOLVED TIE - No consensus after 3 votes (${tiedOptions.map(o => voteTally[o]).join('-')}). Moving to next round.`;
          room.winningOption = null;
          room.voteTally = voteTally;
          room.roundScores = {}; // No points awarded for unresolved tie
          
          broadcastToRoom(roomId);
          saveState();
          
          // Auto-advance after showing unresolved tie message
          if (room.autoAdvance) {
            const delay = room.autoAdvanceDelay || 5000;
            setTimeout(async () => {
              room.currentRound++;
              if (room.currentRound > 10) {
                initializePhase2(roomId);
                await db.updateGame(room.gameCode, { status: 'phase2_active', currentRound: 11 }).catch(err => {
                  console.error('❌ Failed to update game to phase2:', err.message);
                });
              } else {
                room.gamePhase = 'voting';
                room.votes = {};
              }
              broadcastToRoom(roomId);
              saveState();
            }, delay);
          }
          return;
        } else {
          // Trigger revote
          console.log(`🔄 Triggering revote - clearing votes and waiting for new submissions`);
          room.gamePhase = 'revoting';
          room.votes = {}; // Clear votes for revote
          room.voteTally = voteTally;
          room.roundOutcome = `TIE! Revoting required (attempt ${room.voteAttempts[roundKey]}/3)`;
          
          broadcastToRoom(roomId);
          saveState();
          return; // Stop processing, wait for revotes
        }
      }
      
      // No tie - determine winning option (most votes)
      let winningOption = tiedOptions[0]; // Since no tie, tiedOptions has exactly 1 element
      
      room.voteTally = voteTally;
      room.roundOutcome = `Option ${winningOption.toUpperCase()} wins (${maxVotes} votes)`;
      room.winningOption = winningOption;
      
      // Get current issue from game data
      const gameDataPath = path.join(__dirname, 'game-data.json');
      let currentIssueOptions = [];
      try {
        const gameDataContent = fs.readFileSync(gameDataPath, 'utf8');
        const gameData = JSON.parse(gameDataContent);
        const currentIssue = gameData.issues[room.currentRound - 1];
        if (currentIssue && currentIssue.options) {
          currentIssueOptions = currentIssue.options;
        }
      } catch (err) {
        console.error('Error loading game data for scoring:', err);
      }
      
      // Calculate scores for this round
      const roundScores = {};
      console.log(`📝 Scoring Round ${room.currentRound}:`);
      Object.entries(room.players).forEach(([id, player]) => {
        const countryCode = player.country;
        const countryName = getCountryName(countryCode);
        const vote = room.votes[id].toLowerCase();
        
        console.log(`   Player ${id} (${player.username}): ${countryCode} (${countryName}), vote=${vote}`);
        
        let points = 0;
        
        // Base points for participation
        points += 10;
        
        // Find the option they voted for
        const optionIndex = vote === 'a' ? 0 : vote === 'b' ? 1 : 2;
        const votedOption = currentIssueOptions[optionIndex];
        
        if (votedOption) {
          // Bonus for voting for winning option
          if (vote === winningOption) {
            points += 20; // Voted with winning side
          }
          
          // Major bonus if the winning option favors your country
          const winningOptionData = currentIssueOptions[winningOption === 'a' ? 0 : winningOption === 'b' ? 1 : 2];
          if (winningOptionData && winningOptionData.favors && winningOptionData.favors.includes(countryName)) {
            points += 40; // Your country benefits from winning option
            console.log(`      → Winning option favors ${countryName}: +40 pts`);
          }
          
          // Penalty if winning option opposes your country
          if (winningOptionData && winningOptionData.opposes && winningOptionData.opposes.includes(countryName)) {
            points -= 10; // Your country hurt by winning option
            console.log(`      → Winning option opposes ${countryName}: -10 pts`);
          }
          
          // Bonus for voting for option that favors you
          if (votedOption.favors && votedOption.favors.includes(countryName)) {
            points += 15; // Strategic vote for your interests
            console.log(`      → Voted for option favoring ${countryName}: +15 pts`);
          }
        }
        
        roundScores[countryName] = points;
        room.scores[countryName] = (room.scores[countryName] || 0) + points;
        console.log(`      ✓ ${countryName} (${countryCode}): +${points} pts (total: ${room.scores[countryName]})`);
      });
      
      // Store results
      room.voteTally = voteTally;
      room.roundScores = roundScores;
      room.gamePhase = 'results';
      
      console.log(`Round ${room.currentRound} results:`, { 
        voteTally, 
        winningOption: room.roundOutcome 
      });
      
      // Save round results to MySQL
      (async () => {
        let issueTitle = '', winningOptionText = '';
        try {
          const gameDataPath = path.join(__dirname, 'game-data.json');
          const gameData = JSON.parse(fs.readFileSync(gameDataPath, 'utf8'));
          const issue = gameData.issues[room.currentRound - 1];
          if (issue) {
            issueTitle = issue.title;
            const optIdx = winningOption === 'a' ? 0 : winningOption === 'b' ? 1 : 2;
            if (issue.options[optIdx]) winningOptionText = issue.options[optIdx].text;
          }
        } catch (err) { /* ignore */ }
        
        await db.saveRoundResult(room.gameCode, room.currentRound, 1, {
          winningOptionId: winningOption,
          winningOptionText: winningOptionText,
          totalVotes: playerIds.length,
          results: { voteTally, roundScores, issueTitle }
        }).catch(err => {
          console.error('❌ Failed to save round result:', err.message);
        });
        
        // Update game state in DB
        await db.updateGame(room.gameCode, { currentRound: room.currentRound }).catch(err => {
          console.error('❌ Failed to update game:', err.message);
        });
        console.log(`📊 Round ${room.currentRound} results saved to MySQL`);
      })();
      
      // AUTO-ADVANCE: After all votes, auto-advance to next round
      if (room.autoAdvance) {
        const delay = room.autoAdvanceDelay || 5000;
        console.log(`✅ Auto-advancing to next round in ${delay}ms...`);
        
        setTimeout(async () => {
          // Re-fetch room state in case it changed
          const currentRoom = globalState.rooms[roomId];
          if (!currentRoom || currentRoom.gamePhase !== 'results') {
            console.log('Auto-advance cancelled: room state changed');
            return;
          }
          
          // Advance round
          currentRoom.currentRound++;
          console.log(`[AUTO] Advancing to round ${currentRoom.currentRound}`);
          
          // Check if Phase 1 is complete - start Phase 2
          if (currentRoom.currentRound > 10) {
            initializePhase2(roomId);
            await db.updateGame(currentRoom.gameCode, { status: 'phase2_active', currentRound: 11 }).catch(err => {
              console.error('❌ Failed to update game to phase2:', err.message);
            });
            console.log('[AUTO] Phase 1 complete! Starting Phase 2: Post-war economic management');
          } else {
            currentRoom.gamePhase = 'voting';
            currentRoom.votes = {}; // Clear votes for new round
          }
          
          // CRITICAL: Broadcast the updated state so clients see the new round
          broadcastToRoom(roomId);
          saveState();
        }, delay);
      }
    }
    
    broadcastToRoom(roomId);
    saveState();
    
    // Sync vote to MySQL with full details
    (async () => {
      const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
      const userId = username ? await getUserId(username) : null;
      const voterCountry = room.players[playerId]?.country;
      
      if (userId && voterCountry) {
        // Get issue and option details
        let issueTitle = '', optionText = '';
        try {
          const gameDataPath = path.join(__dirname, 'game-data.json');
          const gameData = JSON.parse(fs.readFileSync(gameDataPath, 'utf8'));
          const issue = gameData.issues[room.currentRound - 1];
          if (issue) {
            issueTitle = issue.title;
            const optIdx = choice.toLowerCase() === 'a' ? 0 : choice.toLowerCase() === 'b' ? 1 : 2;
            if (issue.options[optIdx]) optionText = issue.options[optIdx].text;
          }
        } catch (err) { /* ignore */ }
        
        const pointsEarned = room.roundScores?.[voterCountry] || 0;
        await db.saveVote(room.gameCode, userId, room.currentRound, 
          `issue_${room.currentRound}`, issueTitle, choice, optionText, pointsEarned).catch(err => {
            console.error('❌ Failed to save vote:', err.message);
          });
        console.log(`📊 Vote synced: ${username} (${voterCountry}) -> ${choice}`);
        
        // Also update player total points to phase1_score column
        if (room.scores?.[voterCountry]) {
          console.log(`💾 Saving Phase 1 points to DB: ${username} (${voterCountry}) -> ${room.scores[voterCountry]} points`);
          const pointsResult = await db.updatePlayerPoints(room.gameCode, userId, room.scores[voterCountry], 'phase1').catch(err => {
            console.error('❌ Failed to save points:', err.message);
          });
          if (pointsResult?.error) {
            console.error(`❌ Failed to save points to DB:`, pointsResult.error);
          } else {
            console.log(`✅ Phase 1 points saved successfully`);
          }
        } else {
          console.log(`⚠️  No Phase 1 points to save for ${voterCountry}`);
        }
      }
    })();
  });
  
  // Advance to next round (admin only)
  socket.on('advanceRound', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    const isSuperAdmin = user && user.role === 'superadmin';
    const isRoomHost = room.hostId === playerId;
    
    // Allow either superadmin OR room host to advance round
    if (!isSuperAdmin && !isRoomHost) {
      console.log('Advance round rejected:', {
        playerId,
        username: user?.username || 'unknown',
        role: user?.role || 'none',
        isSuperAdmin,
        isRoomHost,
        roomHost: room.hostId
      });
      socket.emit('advanceRoundError', { 
        message: 'Only the game admin can advance the round.' 
      });
      return;
    }
    
    // Advance round
    room.currentRound++;
    console.log(`Advancing to round ${room.currentRound}`);
    
    // Check if Phase 1 is complete - start Phase 2
    if (room.currentRound > 10) {
      initializePhase2(roomId);
      console.log('Phase 1 complete! Starting Phase 2: Post-war economic management');
    } else {
      room.gamePhase = 'voting';
      room.votes = {}; // Clear votes for new round
    }
    
    broadcastToRoom(roomId);
    saveState();
  });
  
  // PHASE 2: Submit economic policy
  socket.on('submitPolicy', ({ roomId, playerId, policy }) => {
    console.log(`🔵 submitPolicy event: roomId=${roomId}, playerId=${playerId}, policy exists=${!!policy}`);
    
    const room = globalState.rooms[roomId];
    console.log(`   room exists=${!!room}, phase2=${room?.phase2?.active}`);
    
    if (!room || !room.phase2.active) {
      console.log(`   ❌ EARLY RETURN: room=${!!room}, phase2.active=${room?.phase2?.active}`);
      return;
    }
    
    // Find player by playerId (should match database player_id)
    const playersInRoom = Object.keys(room.players).map(key => ({
      key,
      playerId: room.players[key].playerId,
      country: room.players[key].country
    }));
    console.log(`   Players in room:`, playersInRoom.map(p => `${p.key}(${p.playerId}:${p.country})`).join(', '));
    
    const playerKey = Object.keys(room.players).find(key => {
      return room.players[key].playerId === playerId || key === playerId;
    });
    const player = playerKey ? room.players[playerKey] : null;
    console.log(`   Looking for playerId=${playerId}: found=${!!player}, playerKey=${playerKey}, country=${player?.country}`);
    if (!player) {
      console.log(`   ❌ Player not found in room. Available players: ${playersInRoom.map(p => p.playerId).join(', ')}`);
      return;
    }
    
    const currentYear = room.phase2.currentYear;
    console.log(`   currentYear=${currentYear}, policies for year=${!!room.phase2.policies[currentYear]}`);
    if (!room.phase2.policies[currentYear]) {
      room.phase2.policies[currentYear] = {};
    }
    
    console.log(`   storing policy for ${player.country}, isCommand=${policy.isCommandEconomy}`);
    room.phase2.policies[currentYear][player.country] = policy.isCommandEconomy ? {
      // Command economy policy
      fiveYearPlanTarget: policy.fiveYearPlanTarget || 8,
      heavyIndustryAllocation: policy.heavyIndustryAllocation || 60,
      foreignTradeOrientation: policy.foreignTradeOrientation || 50, // 0=COMECON, 100=West
      planFulfillmentPriority: policy.planFulfillmentPriority || 70, // Gosbank credit rigor
      militarySpending: policy.militarySpending || 15,
      militarySize: policy.militarySize || 3000000,
      isCommandEconomy: true,
      submittedAt: Date.now()
    } : {
      // Market economy policy
      centralBankRate: policy.centralBankRate || 3.0,
      exchangeRate: policy.exchangeRate || 1.0,
      tariffRate: policy.tariffRate || 10,
      militarySpending: policy.militarySpending || 5,
      militarySize: policy.militarySize || 500000,
      isCommandEconomy: false,
      submittedAt: Date.now()
    };
    
    console.log(`   ✅ Policy stored for ${player.country}`);
    console.log(`Player ${playerKey} (${player.country}) submitted policy for ${currentYear}`);
    
    // Sync policy to MySQL with full details
    const submittedPolicy = room.phase2.policies[currentYear][player.country];
    console.log(`   syncing to MySQL...`);
    (async () => {
      // Use stored userId if available, otherwise look it up
      let userId = player.userId;
      if (!userId) {
        const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
        userId = username ? await getUserId(username) : null;
      }
      if (userId) {
        const phase2Round = currentYear - 1945; // 1946=round 1, 1947=round 2, etc.
        await db.savePolicy(room.gameCode, userId, phase2Round, {
          year: currentYear,
          interestRate: submittedPolicy.centralBankRate || 0,
          govtSpending: submittedPolicy.militarySpending || 0,
          tradePolicy: submittedPolicy.isCommandEconomy ? 'command' : 'market',
          currencyPolicy: `rate_${submittedPolicy.exchangeRate || 1}`,
          policyFocus: submittedPolicy.isCommandEconomy ? 'heavy_industry' : 'balanced',
          rationale: JSON.stringify(submittedPolicy)
        }).catch(err => {
          console.error('❌ Failed to save policy:', err.message);
        });
        console.log(`📊 Policy synced to MySQL: ${player.country} (${currentYear})`);
      }
    })();
    
    // Mark ready
    if (!room.readyPlayers.includes(playerKey)) {
      room.readyPlayers.push(playerKey);
    }
    console.log(`   marked ready. readyPlayers=${room.readyPlayers.length}`);
    
    // AUTO-ADVANCE: Check if all players have submitted policies
    const playerIds = Object.keys(room.players);
    const allReady = playerIds.every(id => room.readyPlayers.includes(id));
    console.log(`   checkAutoAdvance: playerIds=${playerIds.length}, ready=${room.readyPlayers.length}, allReady=${allReady}, autoAdvance=${room.autoAdvance}`);
    
    if (allReady && room.autoAdvance) {
      console.log(`[AUTO] All ${playerIds.length} players submitted policies, auto-advancing year...`);
      
      // Check if there's an active crisis that needs resolution first
      const crisisActive = room.phase2.crises?.active;
      console.log(`   crisis check: active=${crisisActive}`);
      if (crisisActive) {
        console.log('[AUTO] Cannot auto-advance - active crisis must be resolved first');
        broadcastToRoom(roomId);
        saveState();
        return;
      }
      
      // Check if we're already at the end
      console.log(`   year check: currentYear=${room.phase2.currentYear}, >= 1952=${room.phase2.currentYear >= 1952}`);
      if (room.phase2.currentYear >= 1952) {
        // Don't calculate more economics, just finalize
        console.log(`   [FINAL] calculating scores and completing...`);
        calculatePhase2Scores(roomId);
        room.gamePhase = 'complete';
        room.phase2.active = false;
        db.updateGame(room.gameCode, { status: 'completed', currentRound: 12 }).catch(err => {
          console.error('❌ Failed to update game completion:', err.message);
        });
        console.log('[AUTO] Phase 2 complete! Final scores calculated.');
        broadcastToRoom(roomId);
        saveState();
        return;
      }
      
      // Calculate this year's economics (this creates data for next year)
      console.log(`   calculating economics for ${room.phase2.currentYear}...`);
      calculateYearEconomics(roomId);
      
      // Advance year
      room.phase2.currentYear++;
      room.readyPlayers = [];
      console.log(`   advanced to year ${room.phase2.currentYear}`);
      
      // Sync to database
      const phase2Round = room.phase2.currentYear - 1945; // 1946=round 1, 1947=round 2, etc.
      db.updateGame(room.gameCode, { currentRound: 10 + phase2Round }).catch(err => {
        console.error('❌ Failed to update game round:', err.message);
      });
      console.log(`📊 Synced Phase 2 year ${room.phase2.currentYear} to MySQL (round ${10 + phase2Round})`);
      
      // Check for crisis events this year
      console.log(`   checking crises...`);
      triggerCrisisIfNeeded(roomId, room.phase2.currentYear);
      
      console.log(`[AUTO] Advanced to year ${room.phase2.currentYear}`);
      
      // Check if we've reached the final year
      if (room.phase2.currentYear >= 1952) {
        console.log('[AUTO] Reached final year 1952. Next advance will complete Phase 2.');
      }
    } else {
      console.log(`   no auto-advance: allReady=${allReady}, autoAdvance=${room.autoAdvance}`);
    }
    
    console.log(`   🎯 END OF submitPolicy - about to broadcast`);
    broadcastToRoom(roomId);
    console.log(`   ✅ broadcastToRoom completed`);
    saveState();
  });
  
  // PLAYER: Deploy troops
  socket.on('deployTroops', ({ roomId, playerId, deployment }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const player = room.players[playerId];
    if (!player) return;
    
    // Verify the deployment is for the player's own country
    if (deployment.country !== player.country) {
      console.log('Deploy troops rejected: country mismatch');
      return;
    }
    
    // Initialize deployments array if doesn't exist
    if (!room.phase2.deployments) {
      room.phase2.deployments = [];
    }
    
    // Add deployment with timestamp
    const deploymentRecord = {
      ...deployment,
      timestamp: Date.now(),
      year: room.phase2.currentYear
    };
    
    room.phase2.deployments.push(deploymentRecord);
    
    // Check for conflicts
    const conflictZones = ['Eastern Europe', 'East Asia', 'Middle East', 'Southeast Asia'];
    if (conflictZones.includes(deployment.region)) {
      // Find if another country has troops there
      const otherDeployments = room.phase2.deployments.filter(d => 
        d.region === deployment.region && 
        d.country !== deployment.country &&
        d.year === room.phase2.currentYear
      );
      console.log(otherDeployments)
      if (otherDeployments.length > 0) {
        // Create conflict alert
        if (!room.phase2.conflicts) {
          room.phase2.conflicts = [];
        }
        
        room.phase2.conflicts.push({
          region: deployment.region,
          countries: [deployment.country, ...otherDeployments.map(d => d.country)],
          year: room.phase2.currentYear,
          timestamp: Date.now()
        });
        
        console.log(`⚠️ CONFLICT ALERT: ${deployment.country} deployed to ${deployment.region} - conflict with ${otherDeployments.map(d => d.country).join(', ')}`);
      }
    }
    
    console.log(`${player.country} deployed ${deployment.troops} troops to ${deployment.region} in ${room.gameCode}`);
    
    // Sync deployment to MySQL
    (async () => {
      // Use stored userId if available
      let userId = player.userId;
      if (!userId) {
        const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
        userId = username ? await getUserId(username) : null;
      }
      console.log(`🔍 Deployment sync debug: userId=${userId}, playerId=${playerId}, gameCode=${room.gameCode}`);
      if (userId) {
        const deploymentData = {
          country: deployment.country,
          region: deployment.region,
          troops: deployment.troops,
          branch: deployment.branch || 'army',
          year: room.phase2.currentYear,
          deploymentInfluence: 0
        };
        console.log(`🔍 Deployment data:`, JSON.stringify(deploymentData));
        await db.saveDeployment(room.gameCode, userId, deploymentData).catch(err => {
          console.error('❌ Failed to save deployment:', err.message);
        });
        console.log(`📊 Deployment synced to MySQL: ${deployment.country} (${deployment.region})`)
      } else {
        console.error(`❌ Cannot sync deployment: userId is null for playerId ${playerId}`);
      }
    })();
    
    // BATTLE SYSTEM: Detect and emit conflicts after deployment saves
    if (room.phase2.conflicts && room.phase2.conflicts.length > 0) {
      const latestConflict = room.phase2.conflicts[room.phase2.conflicts.length - 1];
      console.log(`🎖️ Battle System Triggered: Conflict in ${latestConflict.region}`);
    
// AFTER:
// Only emit to players, not admin
Object.values(room.players).forEach(player => {
  if (player.role !== 'superadmin' && latestConflict.countries.includes(player.country)) {
    io.to(player.socketId).emit('militaryConflict', {
      region: latestConflict.region,
      countries: latestConflict.countries,
      year: room.phase2.currentYear,
      message: `Military conflict detected in ${latestConflict.region}!`
    });
  }
});
      
      // Also trigger database battle detection asynchronously
      (async () => {
        try {
          const result = await db.callAPI('detectBattles', {
            gameCode: room.gameCode || roomId,
            region: latestConflict.region,
            countries: latestConflict.countries,
            year: room.phase2.currentYear
          });
          console.log(`✅ Database battle detection completed:`, result);
        } catch (err) {
          console.error(`❌ Database battle detection error: ${err.message}`);
        }
      })();
    }
    
    broadcastToRoom(roomId);
    saveState();
  });

  // PLAYER: Submit battle decision
socket.on('socket.on('submitBattleDecision', async (data) => {
    const { battleId, region, decision, country, year } = data;
    const roomId = SINGLE_ROOM_ID; // Single room mode
    const room = globalState.rooms[roomId];
    
    if (!room) {
      console.error('❌ [Battle Decision] Room not found:', roomId);
      return;
    }
    
    console.log(`🎖️ [Battle Decision] ${country} chose ${decision} in ${region} (Year ${year})`);
    
    // Store battle decision in room state (for future battle resolution)
    if (!room.phase2.battleDecisions) {
      room.phase2.battleDecisions = [];
    }
    
    room.phase2.battleDecisions.push({
      battleId: battleId || `${region}-${year}`,
      region,
      country,
      decision,
      year,
      timestamp: new Date().toISOString()
    });
    
    // Sync to database
    (async () => {
      try {
        const result = await db.callAPI('recordBattleDecision', {
          gameCode: room.gameCode || roomId,
          battleId: battleId || `${region}-${year}`,
          country,
          decision,
          region,
          year
        });
        console.log(`📊 Battle decision synced to MySQL: ${country} - ${decision}`);
      } catch (err) {
        console.error(`❌ Failed to sync battle decision: ${err.message}`);
      }
    })();
    
    // Broadcast updated state to room
    broadcastToRoom(roomId);
    saveState();
  });

  // CRISIS: Submit response to active crisis
  socket.on('submitCrisisResponse', ({ roomId, playerId, choiceId }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.phase2.active) return;
    
    const player = room.players[playerId];
    if (!player) return;
    
    const crisis = room.phase2.crises.active;
    if (!crisis) {
      console.log('No active crisis');
      return;
    }
    
    const country = player.country;
    
    // Check if this country is affected by the crisis
    if (!crisis.affectedCountries.includes(country)) {
      console.log(`${country} not affected by this crisis`);
      return;
    }
    
    // Get the choice
    const countryOptions = crisis.options[country];
    if (!countryOptions) {
      console.log(`No options for ${country} in this crisis`);
      return;
    }
    
    const choice = countryOptions.find(opt => opt.id === choiceId);
    if (!choice) {
      console.log(`Invalid choice ID: ${choiceId}`);
      return;
    }
    
    // Validate military requirements
    const currentYear = room.phase2.currentYear;
    const yearData = room.phase2.yearlyData[currentYear]?.[country];
    
    if (choice.militaryRequired && yearData) {
      const hasArmy = !choice.militaryRequired.army || yearData.military.army >= choice.militaryRequired.army;
      const hasNavy = !choice.militaryRequired.navy || yearData.military.navy >= choice.militaryRequired.navy;
      const hasAir = !choice.militaryRequired.airForce || yearData.military.airForce >= choice.militaryRequired.airForce;
      
      if (!hasArmy || !hasNavy || !hasAir) {
        socket.emit('crisisResponseError', {
          message: 'Insufficient military forces for this option'
        });
        console.log(`${country} lacks required military for choice ${choiceId}`);
        return;
      }
    }
    
    // Store the response
    room.phase2.crises.responses[country] = {
      playerId,
      choiceId,
      choice,
      timestamp: Date.now()
    };
    
    console.log(`${country} submitted crisis response: ${choice.text}`);
    
    // Sync crisis response to MySQL
    (async () => {
      // Use stored userId if available
      let userId = player.userId;
      if (!userId) {
        const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
        userId = username ? await getUserId(username) : null;
      }
      if (userId) {
        await db.saveCrisisResponse(room.gameCode, userId, crisis.id, choiceId, room.phase2.currentYear).catch(err => {
          console.error('❌ Failed to sync crisis response:', err.message);
        });
        console.log(`📊 Crisis response synced to MySQL: ${country}`);
      }
    })();
    
    // Check if all affected countries with active players have responded
    const affectedCountriesWithPlayers = crisis.affectedCountries.filter(c => {
      return Object.values(room.players).some(p => p.country === c);
    });
    
    const allResponded = affectedCountriesWithPlayers.every(c => 
      room.phase2.crises.responses[c]
    );
    
    console.log(`Crisis responses: ${Object.keys(room.phase2.crises.responses).length}/${affectedCountriesWithPlayers.length}`);
    
    if (allResponded) {
      console.log('✅ All affected countries responded - auto-resolving crisis');
      resolveCrisisEffects(roomId);
    }
    
    broadcastToRoom(roomId);
    saveState();
  });

  // CRISIS: Admin manually resolves crisis (for cases where not all countries responded)
  socket.on('resolveCrisis', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    const isSuperAdmin = user && user.role === 'superadmin';
    const isRoomHost = room.hostId === playerId;
    
    if (!isSuperAdmin && !isRoomHost) {
      socket.emit('resolveCrisisError', {
        message: 'Only the game admin can manually resolve crises'
      });
      return;
    }
    
    const crisis = room.phase2.crises.active;
    if (!crisis) {
      console.log('No active crisis to resolve');
      return;
    }
    
    console.log(`Admin manually resolving crisis: ${crisis.title}`);
    
    const success = resolveCrisisEffects(roomId);
    if (success) {
      broadcastToRoom(roomId);
    }
  });

  socket.on('advanceYear', ({ roomId, playerId }) => {
    console.log('=== ADVANCE YEAR REQUEST ===');
    console.log('Room ID:', roomId);
    console.log('Player ID:', playerId);
    
    const room = globalState.rooms[roomId];
    if (!room) {
      console.log('ERROR: Room not found');
      return;
    }
    
    console.log('Room found:', room.roomName);
    console.log('Room host:', room.hostId);
    console.log('Phase 2 active:', room.phase2.active);
    console.log('Current year:', room.phase2.currentYear);
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    console.log('User found:', user ? 'YES' : 'NO');
    if (user) {
      console.log('User details:', { playerId: user.playerId, role: user.role });
    }
    
    // AUTO-FIX: If room has no host, set to current user (if they're in the game)
    if (!room.hostId && room.players[playerId]) {
      console.log('⚠️ Room has no host ID, setting to current player:', playerId);
      room.hostId = playerId;
      saveState();
    }
    
    // AUTO-FIX: If room host is not in the players list, reassign to first player
    if (room.hostId && !room.players[room.hostId]) {
      const playerIds = Object.keys(room.players);
      if (playerIds.length > 0) {
        const newHostId = playerIds[0];
        console.log('⚠️ Room host not in game, reassigning from', room.hostId, 'to', newHostId);
        room.hostId = newHostId;
        saveState();
      }
    }
    
    const isSuperAdmin = user && user.role === 'superadmin';
    const isRoomHost = room.hostId === playerId;
    
    console.log('=== DETAILED PERMISSION CHECK ===');
    console.log('Player ID from request:', playerId);
    console.log('Room host ID:', room.hostId);
    console.log('IDs match:', room.hostId === playerId);
    console.log('Player ID type:', typeof playerId);
    console.log('Room host ID type:', typeof room.hostId);
    console.log('User object:', user);
    console.log('Is superadmin:', isSuperAdmin);
    console.log('Is room host:', isRoomHost);
    console.log('Permission check result:', { isSuperAdmin, isRoomHost });
    
    // Allow either superadmin OR room host to advance year
    if (!isSuperAdmin && !isRoomHost) {
      console.log('❌ Advance year rejected:', {
        playerId,
        username: user?.username || 'unknown',
        role: user?.role || 'none',
        isSuperAdmin,
        isRoomHost,
        roomHost: room.hostId,
        reason: 'Player is neither superadmin nor room host'
      });
      socket.emit('advanceYearError', { 
        message: 'Only the game admin can advance the year.' 
      });
      return;
    }
    
    console.log('✅ Permission granted');
    
    if (!room.phase2.active) {
      console.log('ERROR: Phase 2 not active');
      return;
    }
    
    // Check if there's an active crisis that needs resolution
    if (room.phase2.crises.active) {
      console.log('⚠️ Cannot advance year - active crisis must be resolved first');
      socket.emit('advanceYearError', {
        message: `Crisis in progress: ${room.phase2.crises.active.title}. Resolve the crisis before advancing.`
      });
      return;
    }
    
    // Check if we're already at the end
    if (room.phase2.currentYear >= 1952) {
      // Don't calculate more economics, just finalize
      calculatePhase2Scores(roomId);
      room.gamePhase = 'complete';
      room.phase2.active = false;
      db.updateGame(room.gameCode, { status: 'completed', currentRound: 12 }).catch(err => {
        console.error('❌ Failed to update game completion:', err.message);
      });
      console.log('Phase 2 complete! Final scores calculated.');
      broadcastToRoom(roomId);
      saveState();
      return;
    }
    
    // Calculate this year's economics (this creates data for next year)
    calculateYearEconomics(roomId);
    
    // Advance year
    room.phase2.currentYear++;
    room.readyPlayers = [];
    
    // Check for crisis events this year
    triggerCrisisIfNeeded(roomId, room.phase2.currentYear);
    
    console.log(`✅ Advanced to year ${room.phase2.currentYear}`);
    
    // Check if we've reached the final year
    if (room.phase2.currentYear >= 1952) {
      console.log('Reached final year 1952. Next advance will complete Phase 2.');
    }
    
    console.log('Broadcasting updated game state...');
    broadcastToRoom(roomId);
    saveState();
    console.log('✅ Year advancement complete');
  });
  
  // ADMIN: Reset room (room host or superadmin)
  socket.on('resetRoom', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    const isSuperAdmin = user && user.role === 'superadmin';
    const isRoomHost = room.hostId === playerId;
    
    if (!isSuperAdmin && !isRoomHost) {
      socket.emit('resetRoomResult', { success: false, message: 'Only the game admin can reset games' });
      return;
    }
    
    // Reset game state but keep players
    room.gameStarted = false;
    room.currentRound = 0;
    room.gamePhase = 'lobby';
    room.votes = {};
    room.scores = { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 };
    room.roundHistory = [];
    room.readyPlayers = [];
    room.phase2 = {
      active: false,
      currentYear: 1946,
      maxYears: 7,
      policies: {},
      yearlyData: {},
      achievements: {},
      deployments: [],
      conflicts: [],
      battleDecisions: [],
      crises: {
        active: null,
        history: [],
        responses: {}
      }
    };
    
    socket.emit('resetRoomResult', { success: true });
    db.updateGame(room.gameCode, { status: 'lobby', currentRound: 0 }).catch(err => {
      console.error('❌ Failed to update game reset:', err.message);
    });
    broadcastToRoom(roomId);
    broadcastRoomList();
    saveState();
    
    console.log(`Room ${roomId} reset by superadmin`);
  });
  
 
  // ADMIN: Start new game (resets current game and releases all players)
 socket.on('startNewGame', async ({ roomId, playerId }) => {
  console.log('=== START NEW GAME REQUEST ===');
  console.log('Room ID:', roomId);
  console.log('Player ID:', playerId);
  console.log('Current highestGameId:', highestGameId);
    console.log(`🎮 Join game request: roomId=${roomId}, playerId=${playerId}}`);


  const room = globalState.rooms[roomId];
  if (!room) {
    console.log('ERROR: Room not found');
    socket.emit('startNewGameResult', { success: false, message: 'Room not found' });
    return;
  }
  
  const user = Object.values(globalState.users).find(u => u.playerId === playerId);
  
  // DEBUG: Show authorization details
  console.log('=== AUTHORIZATION DEBUG ===');
  console.log('User found:', user ? 'YES' : 'NO');
  if (user) {
    console.log('User role:', user.role);
    console.log('User playerId:', user.playerId);
  }
  console.log('Room hostId:', room.hostId);
  console.log('Room hostId type:', typeof room.hostId);
  console.log('PlayerId type:', typeof playerId);
  console.log('IDs match:', room.hostId === playerId);
  console.log('All users:', Object.keys(globalState.users));
  console.log('========================');
  
  const isSuperAdmin = user && user.role === 'superadmin';
  const isRoomHost = room.hostId === playerId;
  
  console.log('Is SuperAdmin:', isSuperAdmin);
  console.log('Is Room Host:', isRoomHost);
  
  if (!isSuperAdmin && !isRoomHost) {
    console.log('ERROR: Not authorized');
    socket.emit('startNewGameResult', { success: false, message: 'Only the game admin can start a new game' });
    return;
  }
  
  // ... rest of the code  
  const oldGameCode = room.gameCode;
  console.log('Old game code:', oldGameCode);
  
  try {
    // Step 1: Mark old game as completed in database
    if (oldGameCode) {
      try {
        console.log('Step 1: Marking old game as completed...');
        const updateResult = await db.callAPI('updateGameStatus', { 
          gameCode: oldGameCode, 
          game_status: 'completed' 
        });
        console.log('updateGameStatus result:', updateResult);
        console.log(`✅ Old game ${oldGameCode} marked as completed`);
      } catch (err) {
        console.error('❌ Failed to mark old game as completed:', err.message);
        console.error('Error stack:', err.stack);
      }
    }
    
    // Step 2: Release all players from the old game in database
    if (oldGameCode) {
      try {
        console.log('Step 2: Releasing players from old game...');
        const releaseResult = await db.callAPI('releasePlayersFromGame', { 
          gameCode: oldGameCode 
        });
        console.log('releasePlayersFromGame result:', releaseResult);
        console.log(`✅ Released all players from old game ${oldGameCode}`);
      } catch (err) {
        console.error('❌ Failed to release players:', err.message);
        console.error('Error stack:', err.stack);
      }
    }
    
    // Step 3: Generate new game ID and code
    console.log('Step 3: Generating new game ID...');
    const newGameId = getNextGameId();
    const newGameCode = `game_${newGameId}`;
    console.log(`📝 Creating new game: game_id=${newGameId}, gameCode=${newGameCode}`);
    
    // Step 4: Create new game in database with LOBBY status and current_round = 0
    try {
      console.log('Step 4: Creating new game in database...');
      console.log('Calling createGameInLobby with:', {
        gameCode: newGameCode,
        gameId: newGameId,
        createdBy: playerId
      });
      
      const createResult = await db.callAPI('createGameInLobby', {
        gameCode: newGameCode,
        gameId: newGameId,
        createdBy: playerId
      });
      
      console.log('createGameInLobby raw result:', JSON.stringify(createResult, null, 2));
      
      console.log(`✅ New game created in database: ${newGameCode}`);
    } catch (err) {
      console.error('❌ Error creating new game:', err.message);
      console.error('Error stack:', err.stack);
      socket.emit('startNewGameResult', { 
        success: false, 
        message: 'Error creating new game: ' + err.message 
      });
      return;
    }
    // Step 5: Reset room state in memory
console.log('Step 5: Resetting room state...');
const oldGameId = room.gameId;
room.gameId = newGameId;
room.gameCode = newGameCode;
room.gameStarted = false;
room.currentRound = 0;
room.gamePhase = 'lobby';
room.gameStatus = 'lobby';
// ... rest of reset code

    
    room.votes = {};
    room.scores = { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 };
    room.roundHistory = [];
    room.readyPlayers = [];
    room.players = {}; // Clear all players - they must rejoin
    room.phase2 = {
      active: false,
      currentYear: 1946,
      maxYears: 7,
      policies: {},
      yearlyData: {},
      achievements: {},
      deployments: [],
      conflicts: [],
      battleDecisions: [],
      crises: {
        active: null,
        history: [],
        responses: {}
      }
    };
    
    console.log(`✅ Room state reset: game_id ${oldGameId} → ${newGameId}`);
    
// Step 6: Broadcast updates
console.log('Step 6: Broadcasting updates...');
socket.emit('startNewGameResult', { 
  success: true, 
  gameId: newGameId,
  gameCode: newGameCode
});

broadcastToRoom(roomId);  // ← Use newGameCode, not roomId
broadcastRoomList();
saveState();
      // At the end of the startNewGame handler, right before the final console.log
console.log('=== ROOM STATE AFTER RESET ===');
console.log('room.roomId:', room.roomId);
console.log('room.gameId:', room.gameId, 'type:', typeof room.gameId);
console.log('room.gameCode:', room.gameCode, 'type:', typeof room.gameCode);
console.log('room.gamePhase:', room.gamePhase);
console.log('room.gameStatus:', room.gameStatus);
console.log('==============================');

    console.log(`✅ New game ${newGameId} created successfully`);
    console.log('========================');
  } catch (error) {
    console.error(`❌ FATAL Error in startNewGame:`, error.message);
    console.error('Error stack:', error.stack);
    socket.emit('startNewGameResult', { 
      success: false, 
      message: `Failed to start new game: ${error.message}` 
    });
  }
});
  
  // ADMIN: Toggle auto-advance setting
  socket.on('toggleAutoAdvance', ({ roomId, playerId, enabled, delay }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    const isSuperAdmin = user && user.role === 'superadmin';
    const isRoomHost = room.hostId === playerId;
    
    if (!isSuperAdmin && !isRoomHost) {
      socket.emit('toggleAutoAdvanceResult', { success: false, message: 'Only the game admin can toggle auto-advance' });
      return;
    }
    
    room.autoAdvance = enabled !== undefined ? enabled : !room.autoAdvance;
    if (delay !== undefined && delay >= 1000 && delay <= 30000) {
      room.autoAdvanceDelay = delay;
    }
    
    console.log(`Auto-advance ${room.autoAdvance ? 'enabled' : 'disabled'} for room ${roomId} (delay: ${room.autoAdvanceDelay}ms)`);
    
    socket.emit('toggleAutoAdvanceResult', { 
      success: true, 
      autoAdvance: room.autoAdvance,
      autoAdvanceDelay: room.autoAdvanceDelay
    });
    broadcastToRoom(roomId);
    saveState();
  });
  
  // SUPERADMIN ONLY: Clear all data
  socket.on('clearAllData', ({ playerId, confirmCode }) => {
    console.log('clearAllData called:', { playerId, confirmCode });
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    console.log('User found:', user ? `${user.role}` : 'not found');
    console.log('All users:', Object.keys(globalState.users));
    
    if (!user) {
      socket.emit('clearDataResult', { success: false, message: 'User not found. Please try logging out and back in.' });
      return;
    }
    
    if (user.role !== 'superadmin') {
      socket.emit('clearDataResult', { success: false, message: `Access denied. Your role is: ${user.role}. Only superadmin can clear data.` });
      return;
    }
    
    if (confirmCode !== 'CLEAR_ALL_DATA') {
      socket.emit('clearDataResult', { success: false, message: 'Invalid confirmation code. Type exactly: CLEAR_ALL_DATA' });
      return;
    }
    
    // Clear all rooms but keep superadmin user
    globalState.rooms = {};
    globalState.roomList = [];
    
    // Keep only superadmin user
    const superAdminUser = {};
    Object.entries(globalState.users).forEach(([username, userData]) => {
      if (userData.role === 'superadmin') {
        superAdminUser[username] = userData;
      }
    });
    globalState.users = superAdminUser;
    
    broadcastRoomList();
    saveState();
    
    socket.emit('clearDataResult', { success: true, message: 'All data cleared except administrator account' });
    console.log(`All data cleared by superadmin: ${user.playerId}`);
  });
  
  // SUPERADMIN ONLY: Delete any room
  socket.on('adminDeleteRoom', ({ roomId, playerId }) => {
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    
    if (!user || user.role !== 'superadmin') {
      socket.emit('deleteRoomResult', { success: false, message: 'Administrator access required' });
      return;
    }
    
    if (!globalState.rooms[roomId]) {
      socket.emit('deleteRoomResult', { success: false, message: 'Room not found' });
      return;
    }
    
    // Notify all players in room
    io.to(roomId).emit('roomDeleted', { roomId });
    
    // Delete room
    delete globalState.rooms[roomId];
    
    socket.emit('deleteRoomResult', { success: true });
    broadcastRoomList();
    saveState();
    
    console.log(`Room ${roomId} deleted by superadmin`);
  });
  
  // Remove promote function - no one can be promoted
  
  // Disconnect
  socket.on('disconnect', () => {
    // Find rooms where this socket is a player
    Object.keys(globalState.rooms).forEach(roomId => {
      const room = globalState.rooms[roomId];
      const playerId = Object.keys(room.players).find(
        id => room.players[id].socketId === socket.id
      );
      
      if (playerId) {
        room.players[playerId].disconnected = true;
        room.players[playerId].disconnectedAt = Date.now();
        room.readyPlayers = room.readyPlayers.filter(id => id !== playerId);
        
        broadcastToRoom(roomId);
        saveState();
        
        console.log(`Player ${playerId} disconnected from room ${roomId} - keeping in game`);
      }
    });
    
    console.log(`Client disconnected: ${socket.id}`);
  });

// Start server with database connection
async function startServer() {
  // Test database connection
  const dbConnected = await db.test();
   // Initialize ID counters from database FIRST
  if (dbConnected) {
    await initializeIdCounters(); // ← ADD THIS LINE
  }  
  // Ensure database schema exists
  if (dbConnected) {
    try {
      await db.setupSchema();
      console.log('✅ Database schema verified');
      
      // Ensure score columns exist on players table
      try {
        await db.ensureScoreColumns();
        console.log('✅ Score columns verified on players table');
      } catch (err) {
        console.warn('⚠️ Score columns warning:', err.message);
      }
    } catch (err) {
      console.warn('⚠️ Schema setup warning:', err.message);
    }
  }
  
  server.listen(PORT, () => {
    console.log('🌍 Bretton Woods Multi-Room Server');
    console.log('===================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📂 State file: ${STATE_FILE}`);
    console.log(`💾 Database: ${dbConnected ? 'Connected ✓' : 'Not connected ✗'}`);
    console.log(`👥 Users: ${Object.keys(globalState.users).length}`);
    console.log(`🏠 Rooms: ${Object.keys(globalState.rooms).length}`);
    console.log('===================================');
  });
}

startServer();
