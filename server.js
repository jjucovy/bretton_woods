// server-multiroom.js - Bretton Woods Multi-Room Server
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Database module for MySQL persistence
const db = require('./db');

// Deployment system for military strategic positioning
const deploymentSystem = require('./deployment-impacts');

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

// Deployment Map API - returns current military deployments
app.get('/api/deployment-map/:roomId', (req, res) => {
  const room = globalState.rooms[req.params.roomId];
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  if (!room.phase2.active) {
    return res.json({ message: 'Phase 2 not active', deployments: [] });
  }
  
  res.json({
    roomId: room.roomId,
    year: room.phase2.currentYear,
    deployments: room.phase2.deployments || [],
    conflicts: room.phase2.conflicts || [],
    regionalControl: room.phase2.regionalControl || {},
    crisisDeploymentBonuses: room.phase2.crisisDeploymentBonuses || {}
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
function createGameState(roomId, roomName, hostId) {
  return {
    roomId: roomId,
    gameCode: roomId, // CRITICAL: gameCode must be set to roomId for API to work
    roomName: roomName,
    hostId: hostId,
    gameId: Date.now(),
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
      },
      // Military deployment system
      deployments: [],           // Array of all military deployments
      conflicts: [],             // Array of detected conflicts between countries
      regionalControl: {},       // Track which country controls each region
      crisisDeploymentBonuses: {} // Bonuses earned from crisis-related deployments
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
      
      // CRITICAL: Ensure all loaded rooms have gameCode set and phase2.crises initialized
      Object.keys(globalState.rooms).forEach(roomId => {
        const room = globalState.rooms[roomId];
        
        if (!room.gameCode) {
          room.gameCode = roomId;
          console.log(`⚠️ Added missing gameCode to room ${roomId}`);
        }
        
        // Ensure phase2.crises structure exists for old saved states
        if (!room.phase2) {
          room.phase2 = {
            active: false,
            currentYear: 1946,
            maxYears: 7,
            policies: {},
            yearlyData: {},
            achievements: {},
            crises: {
              active: null,
              history: [],
              responses: {}
            }
          };
        }
        if (!room.phase2.crises) {
          room.phase2.crises = {
            active: null,
            history: [],
            responses: {}
          };
        }
        if (!room.phase2.crises.history) {
          room.phase2.crises.history = [];
        }
        
        // CRITICAL: Ensure scores are initialized
        if (!room.scores) {
          room.scores = { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 };
          console.log(`⚠️ Initialized missing scores for room ${roomId}`);
        }
        
        // CRITICAL: Ensure players object exists (recover if empty from completed game)
        if (!room.players) {
          room.players = {};
          console.log(`⚠️ Initialized missing players object for room ${roomId}`);
        }
        if (Object.keys(room.players).length === 0 && room.gamePhase === 'complete') {
          console.log(`⚠️ Room ${roomId} is marked complete but has no players - likely recovered from crash. Will rebuild from database on next request.`);
        }
      });
      
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
    console.log('💾 Multi-room state saved');
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
    
    // CRITICAL: Ensure imported room has gameCode set
    if (!globalState.rooms[roomId].gameCode) {
      globalState.rooms[roomId].gameCode = roomId;
    }
    
    // Ensure phase2.crises structure exists for imported states
    if (!globalState.rooms[roomId].phase2) {
      globalState.rooms[roomId].phase2 = {
        active: false,
        currentYear: 1946,
        maxYears: 7,
        policies: {},
        yearlyData: {},
        achievements: {},
        crises: {
          active: null,
          history: [],
          responses: {}
        }
      };
    }
    if (!globalState.rooms[roomId].phase2.crises) {
      globalState.rooms[roomId].phase2.crises = {
        active: null,
        history: [],
        responses: {}
      };
    }
    if (!globalState.rooms[roomId].phase2.crises.history) {
      globalState.rooms[roomId].phase2.crises.history = [];
    }
    
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
      // Get the LATEST game for this room (handles timestamped gameCodes)
      const gameData = await db.getLatestGameForRoom(SINGLE_ROOM_ID);
      
      if (gameData) {
        console.log('✅ Found existing game in database, restoring state...');
        console.log(`   Game Code: ${gameData.game_code}`);
        console.log(`   Game ID: ${gameData.game_id}`);
        console.log(`   Status: ${gameData.game_status}`);
        
        // Create room structure from DB data
        globalState.rooms[SINGLE_ROOM_ID] = createGameState(SINGLE_ROOM_ID, 'Bretton Woods 1944', null);
        
        // CRITICAL: Use the actual gameCode from database, not SINGLE_ROOM_ID
        globalState.rooms[SINGLE_ROOM_ID].gameCode = gameData.game_code;
        globalState.rooms[SINGLE_ROOM_ID].gameId = gameData.game_id;
        
        // Restore game status and round
        globalState.rooms[SINGLE_ROOM_ID].gameStatus = gameData.game_status;
        globalState.rooms[SINGLE_ROOM_ID].currentRound = parseInt(gameData.current_round) || 1;
        globalState.rooms[SINGLE_ROOM_ID].gameStarted = gameData.game_status !== 'lobby';
        
        console.log(`✅ Setting gameStarted = ${globalState.rooms[SINGLE_ROOM_ID].gameStarted}, gameStatus = ${gameData.game_status}`);
        
        // Set correct gamePhase based on game status
        if (gameData.game_status === 'phase2_active') {
          globalState.rooms[SINGLE_ROOM_ID].gamePhase = 'phase2';
          // Calculate correct year from current round (round 11 = 1946, round 13 = 1948, etc.)
          const currentYear = parseInt(gameData.current_round) + 1935;
          globalState.rooms[SINGLE_ROOM_ID].phase2 = { 
            active: true, 
            currentYear: currentYear, 
            policies: {}, 
            yearlyData: {},
            crises: {
              active: null,
              history: [],
              responses: {}
            }
          };
          console.log(`✅ Set gamePhase = 'phase2', currentYear = ${currentYear} (from round ${gameData.current_round})`);
        } else if (gameData.game_status === 'phase1_active') {
          globalState.rooms[SINGLE_ROOM_ID].gamePhase = 'voting'; // Phase 1 is voting
          console.log(`✅ Set gamePhase = 'voting'`);
        } else if (gameData.game_status === 'complete' || gameData.game_status === 'completed') {
          // Handle both 'complete' (correct) and 'completed' (legacy)
          globalState.rooms[SINGLE_ROOM_ID].gamePhase = 'complete';
          console.log(`✅ Set gamePhase = 'complete' (from database status: ${gameData.game_status})`);
        } else if (gameData.game_status === 'lobby') {
          globalState.rooms[SINGLE_ROOM_ID].gamePhase = 'lobby';
          console.log(`✅ Set gamePhase = 'lobby'`);
        } else {
          // Unknown status - log warning but keep default 'lobby'
          console.log(`⚠️  Unknown game_status: ${gameData.game_status}, defaulting to 'lobby'`);
        }
        
        // Restore players from database using the actual gameCode
        try {
          const players = await db.getPlayers(gameData.game_code);
          console.log('   📋 Restored', players.length, 'players from database');
          if (players.length > 0) {
            console.log('   🔍 First player object keys:', Object.keys(players[0]));
            console.log('   🔍 First player object:', JSON.stringify(players[0], null, 2).substring(0, 500));
          }
          for (const p of players) {
            // Use user_id with player_db_ prefix (consistent format)
            const playerId = `player_db_${p.user_id}`;
            const countryName = getCountryName(p.country_code);  // Convert code to name
            globalState.rooms[SINGLE_ROOM_ID].players[playerId] = {
              playerId: playerId,
              userId: p.user_id,
              username: p.username,
              country: countryName,  // Store as NAME for consistency with new players
              countryCode: p.country_code,  // Keep code as reference
              countryId: p.country_id
            };
            // Restore player's accumulated points - check ALL possible field names
            let pointsValue = p.total_points || p.totalPoints || p.points || p.phase1_score || 0;
            console.log(`   Player ${p.username}: total_points=${p.total_points}, totalPoints=${p.totalPoints}, points=${p.points}, phase1_score=${p.phase1_score}, phase2_score=${p.phase2_score}`);
            
            if (pointsValue && !isNaN(parseInt(pointsValue))) {
              globalState.rooms[SINGLE_ROOM_ID].scores[countryName] = parseInt(pointsValue);
              console.log(`   ✅ Player ${playerId}: ${p.username} → ${p.country_code} (${countryName}) - Points restored: ${pointsValue}`);
            } else {
              console.log(`   ⚠️  Player ${playerId}: ${p.username} → ${p.country_code} (${countryName}) - No points found`);
            }
          }
        } catch (err) {
          console.log('   Warning: Could not restore players:', err.message);
        }
        
        updateRoomList();
        console.log('🎮 Game restored. Status:', gameData.game_status, 'Round:', gameData.current_round);
      } else {
        console.log('📝 No game found in database, creating new room...');
        globalState.rooms[SINGLE_ROOM_ID] = createGameState(SINGLE_ROOM_ID, 'Bretton Woods 1944', null);
        
        // Create initial game with timestamp+random-based gameCode for uniqueness
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const initialGameCode = `${SINGLE_ROOM_ID}-${timestamp}-${random}`;
        console.log(`   Creating initial game with code: ${initialGameCode}`);
        
        updateRoomList();
        saveState();
        
        const result = await db.createGame(initialGameCode, null);
        if (result && result.game_id) {
          globalState.rooms[SINGLE_ROOM_ID].gameCode = initialGameCode;
          globalState.rooms[SINGLE_ROOM_ID].gameId = result.game_id;
          console.log(`✅ New main game room created: game_id=${result.game_id}, gameCode=${initialGameCode}`);
        }
      }
    } catch (err) {
      console.error('❌ Error loading game on startup:', err.message);
      console.log('📝 Creating fresh game room...');
      globalState.rooms[SINGLE_ROOM_ID] = createGameState(SINGLE_ROOM_ID, 'Bretton Woods 1944', null);
      updateRoomList();
      saveState();
    }
  })();
} else {
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
  // Build broadcast state
  let broadcastState = {
    gameStarted: room.gameStarted,
    gamePhase: room.gamePhase,
    playersCount: Object.keys(room.players).length,
    scores: room.scores
  };
  
  // Add phase-specific info
  if (room.gamePhase === 'phase1') {
    broadcastState.currentRound = room.currentRound;
    broadcastState.readyPlayersCount = room.readyPlayers?.length;
    broadcastState.roundScores = room.roundScores;
  } else if (room.gamePhase === 'phase2') {
    broadcastState.phase2Active = room.phase2?.active;
    broadcastState.phase2Year = room.phase2?.currentYear;
    broadcastState.currentCrisis = room.phase2?.crises?.current ? {
      id: room.phase2.crises.current.id,
      title: room.phase2.crises.current.title,
      affectedCountries: room.phase2.crises.current.affectedCountries
    } : null;
    broadcastState.crisisResponses = room.phase2?.crises?.responses || {};
    broadcastState.submissions = room.readyPlayers?.length || 0;
  }
  
  console.log(`📡 Broadcasting stateUpdate for ${roomId}:`, broadcastState);
  
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
  
  // Trigger the FIRST crisis immediately when Phase 2 starts (1946)
  console.log(`🚨 Triggering initial crisis for year 1946...`);
  triggerCrisisIfNeeded(roomId, 1946);
  
  if (room.phase2.crises?.active) {
    console.log(`⚠️  Initial crisis triggered: ${room.phase2.crises.active.title}`);
    console.log(`   Players must respond BEFORE submitting first policies`);
  }
}

function calculateAgreementBonus(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return {};
  
  const bonus = {};
  const roundHistory = room.roundHistory || [];
  
  // Track what was actually adopted in Phase 1
  const adoptedPolicies = {
    currencySystem: null,
    tradePolicy: null,
    capitalControls: null,
    exchangeRates: null,
    imfPowers: null,
    debtRelief: null,
    goldStandard: null,
    worldBankFocus: null,
    tariffReductions: null,
    developmentAid: null
  };
  
  // Extract adopted policies from round history
  roundHistory.forEach((round, idx) => {
    const issue = round.issueTitle || '';
    const winner = round.winningOptionText || '';
    
    // Categorize each round's decision
    if (issue.includes('currency') || issue.includes('monetary')) {
      adoptedPolicies.currencySystem = winner;
    } else if (issue.includes('trade') || issue.includes('tariff')) {
      adoptedPolicies.tradePolicy = winner;
    } else if (issue.includes('capital') || issue.includes('flow')) {
      adoptedPolicies.capitalControls = winner;
    } else if (issue.includes('exchange rate')) {
      adoptedPolicies.exchangeRates = winner;
    } else if (issue.includes('IMF')) {
      adoptedPolicies.imfPowers = winner;
    } else if (issue.includes('debt')) {
      adoptedPolicies.debtRelief = winner;
    } else if (issue.includes('gold')) {
      adoptedPolicies.goldStandard = winner;
    } else if (issue.includes('World Bank') || issue.includes('development')) {
      adoptedPolicies.worldBankFocus = winner;
    }
  });
  
  console.log('📜 Bretton Woods Adopted Policies:', adoptedPolicies);
  
  // Calculate effects for each country based on WHAT WAS ADOPTED
  Object.values(room.players).forEach(player => {
    const country = player.country;
    let gdpBonus = 0;
    let tradeBonus = 0;
    let inflationMod = 0;
    let stabilityBonus = 0;
    const details = [];
    
    // === CURRENCY SYSTEM EFFECTS ===
    if (adoptedPolicies.currencySystem) {
      const policy = adoptedPolicies.currencySystem.toLowerCase();
      
      if (policy.includes('gold standard')) {
        // Gold Standard: Stable but inflexible
        inflationMod -= 0.5;      // Lower inflation
        gdpBonus -= 0.3;          // Less flexible monetary policy
        stabilityBonus += 0.8;    // Very stable
        tradeBonus -= 200;        // Harder to adjust to shocks
        details.push('Gold Standard: Low inflation, high stability, less flexibility');
        
      } else if (policy.includes('dollar') || policy.includes('usd')) {
        // Dollar Standard: Benefits USA most
        if (country === 'USA') {
          gdpBonus += 1.5;
          tradeBonus += 1000;
          details.push('Dollar Standard: MAJOR benefit for USA (reserve currency)');
        } else {
          gdpBonus += 0.3;
          tradeBonus += 200;
          details.push('Dollar Standard: Moderate benefit (stable system)');
        }
        inflationMod += 0.2;      // Slightly more inflation
        stabilityBonus += 0.5;
        
      } else if (policy.includes('floating') || policy.includes('flexible')) {
        // Floating Rates: Very flexible but volatile
        gdpBonus += 0.5;          // Can adjust to conditions
        tradeBonus += 400;        // Easy to stay competitive
        inflationMod += 0.8;      // Risk of inflation
        stabilityBonus -= 0.5;    // Less stable
        details.push('Floating Rates: High flexibility, moderate instability');
        
      } else if (policy.includes('fixed') || policy.includes('peg')) {
        // Fixed Exchange Rates: Balanced
        gdpBonus += 0.2;
        tradeBonus += 300;
        inflationMod -= 0.2;
        stabilityBonus += 0.6;
        details.push('Fixed Rates: Balanced approach');
      }
    }
    
    // === TRADE POLICY EFFECTS ===
    if (adoptedPolicies.tradePolicy) {
      const policy = adoptedPolicies.tradePolicy.toLowerCase();
      
      if (policy.includes('free trade') || policy.includes('low tariff')) {
        // Free Trade: Benefits export-oriented economies
        const exporters = ['USA', 'UK', 'France', 'Argentina'];
        if (exporters.includes(country)) {
          gdpBonus += 1.2;
          tradeBonus += 800;
          details.push('Free Trade: MAJOR benefit for exporters');
        } else {
          gdpBonus += 0.3;
          tradeBonus += 200;
          details.push('Free Trade: Moderate benefit');
        }
        
      } else if (policy.includes('protect') || policy.includes('high tariff')) {
        // Protectionism: Benefits developing economies
        const developers = ['China', 'India', 'USSR'];
        if (developers.includes(country)) {
          gdpBonus += 0.8;
          tradeBonus -= 200;
          details.push('Protectionism: Benefits developing industry');
        } else {
          gdpBonus -= 0.5;
          tradeBonus -= 500;
          details.push('Protectionism: Hurts established exporters');
        }
        
      } else if (policy.includes('gradual') || policy.includes('moderate')) {
        // Moderate Tariffs: Balanced
        gdpBonus += 0.4;
        tradeBonus += 300;
        details.push('Moderate Trade: Balanced approach');
      }
    }
    
    // === CAPITAL CONTROLS EFFECTS ===
    if (adoptedPolicies.capitalControls) {
      const policy = adoptedPolicies.capitalControls.toLowerCase();
      
      if (policy.includes('free') || policy.includes('open')) {
        // Free Capital Flows: Benefits capital-rich countries
        const capitalRich = ['USA', 'UK'];
        if (capitalRich.includes(country)) {
          gdpBonus += 0.8;
          tradeBonus += 400;
          details.push('Free Capital: Major benefit for capital exporters');
        } else {
          gdpBonus -= 0.3;
          details.push('Free Capital: Risk of capital flight');
        }
        
      } else if (policy.includes('restrict') || policy.includes('control')) {
        // Capital Controls: Protects developing economies
        const developing = ['China', 'India', 'Argentina'];
        if (developing.includes(country)) {
          gdpBonus += 0.5;
          stabilityBonus += 0.4;
          details.push('Capital Controls: Protects from speculation');
        } else {
          gdpBonus -= 0.2;
          details.push('Capital Controls: Limits investment opportunities');
        }
      }
    }
    
    // === IMF POWERS EFFECTS ===
    if (adoptedPolicies.imfPowers) {
      const policy = adoptedPolicies.imfPowers.toLowerCase();
      
      if (policy.includes('strong') || policy.includes('enforce')) {
        // Strong IMF: Helps countries in crisis
        stabilityBonus += 0.6;
        details.push('Strong IMF: Better crisis response');
        
        // Major powers get more voting weight
        if (['USA', 'UK', 'France'].includes(country)) {
          gdpBonus += 0.4;
          details.push('Strong IMF: Influential voting power');
        }
        
      } else if (policy.includes('weak') || policy.includes('limited')) {
        // Weak IMF: Countries more independent
        stabilityBonus -= 0.3;
        details.push('Weak IMF: Less crisis support');
      }
    }
    
    // === WORLD BANK / DEVELOPMENT AID EFFECTS ===
    if (adoptedPolicies.worldBankFocus) {
      const policy = adoptedPolicies.worldBankFocus.toLowerCase();
      
      if (policy.includes('infrastructure') || policy.includes('development')) {
        // Development Aid: Benefits developing countries
        const developing = ['China', 'India', 'Argentina'];
        if (developing.includes(country)) {
          gdpBonus += 1.0;
          tradeBonus += 500;
          details.push('Development Aid: Major reconstruction benefit');
        }
        
      } else if (policy.includes('stabilization') || policy.includes('emergency')) {
        // Emergency Aid: Benefits all
        gdpBonus += 0.3;
        stabilityBonus += 0.4;
        details.push('Emergency Aid: Crisis prevention benefit');
      }
    }
    
    // === COOPERATION BONUS ===
    // Countries that voted with majority on most issues
    let cooperationScore = 0;
    roundHistory.forEach(round => {
      const playerVote = Object.keys(room.players).find(key => 
        room.players[key].country === country
      );
      if (playerVote && room.votes[playerVote] === round.winningOptionId) {
        cooperationScore++;
      }
    });
    
    const cooperationRate = cooperationScore / Math.max(roundHistory.length, 1);
    if (cooperationRate > 0.7) {
      gdpBonus += 0.5;
      tradeBonus += 300;
      details.push(`High cooperation (${Math.round(cooperationRate * 100)}%): Diplomatic benefits`);
    } else if (cooperationRate < 0.3) {
      gdpBonus -= 0.3;
      tradeBonus -= 200;
      details.push(`Low cooperation (${Math.round(cooperationRate * 100)}%): Isolated`);
    }
    
    // Store bonuses
    bonus[country] = {
      gdpBonus,
      tradeBonus,
      inflationMod,
      stabilityBonus,
      adoptedPolicies,
      details
    };
    
    console.log(`  ${country} Bretton Woods effects:`, {
      gdp: gdpBonus > 0 ? `+${gdpBonus.toFixed(1)}%` : `${gdpBonus.toFixed(1)}%`,
      trade: tradeBonus > 0 ? `+$${tradeBonus}M` : `$${tradeBonus}M`,
      inflation: inflationMod > 0 ? `+${inflationMod.toFixed(1)}%` : `${inflationMod.toFixed(1)}%`
    });
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
  
  // Only check for crises if phase 2 is active
  if (!room.phase2 || !room.phase2.active) return;
  
  // Check if there's already an active crisis
  if (room.phase2.crises && room.phase2.crises.active) {
    console.log(`Crisis already active, skipping trigger for year ${year}`);
    return;
  }
  
  // Ensure crises object is properly initialized with history array
  if (!room.phase2.crises) {
    room.phase2.crises = {
      active: null,
      history: [],
      responses: {}
    };
  }
  if (!room.phase2.crises.history) {
    room.phase2.crises.history = [];
  }
  
  // CRITICAL: Map Phase 2 years (1946-1952) to crisis indices (0-6)
  // This ensures ALL 7 crises trigger, one per year
  const yearIndex = year - 1946; // 1946=0, 1947=1, ..., 1952=6
  
  console.log(`📅 Year ${year} → Crisis Index ${yearIndex}`);
  
  // Find ALL crisis events for this year that haven't been triggered yet
  const availableCrises = crisisEventsData.crisisEvents.filter(event => 
    event.year === year && 
    !room.phase2.crises.history.find(h => h.id === event.id)
  );
  
  console.log(`   Found ${availableCrises.length} available crises for year ${year}`);
  
  if (availableCrises.length === 0) {
    console.log(`⚠️  WARNING: No crises found for year ${year}`);
    console.log(`   Total crises in database: ${crisisEventsData.crisisEvents.length}`);
    console.log(`   Years covered: ${crisisEventsData.crisisEvents.map(c => c.year).join(', ')}`);
    
    // FALLBACK: If no crisis for this specific year, select from ANY unused crisis
    const anyUnusedCrisis = crisisEventsData.crisisEvents.find(event =>
      !room.phase2.crises.history.find(h => h.id === event.id)
    );
    
    if (anyUnusedCrisis) {
      console.log(`   Using fallback crisis: ${anyUnusedCrisis.title} (original year: ${anyUnusedCrisis.year})`);
      availableCrises.push(anyUnusedCrisis);
    } else {
      console.log(`   No unused crises available`);
      return;
    }
  }
  
  // Select one crisis (randomly if multiple available)
  const selectedCrisis = availableCrises.length > 1 
    ? availableCrises[Math.floor(Math.random() * availableCrises.length)]
    : availableCrises[0];
  
  if (selectedCrisis) {
    // Get the list of countries that are actually playing (as names)
    const playingCountryNames = Object.values(room.players).map(p => p.country);
    
    console.log(`🚨 CRISIS TRIGGERED: ${selectedCrisis.title}`);
    console.log(`   Year: ${year}`);
    console.log(`   ID: ${selectedCrisis.id}`);
    console.log(`   Playing countries:`, playingCountryNames);
    
    const transformedCrisis = transformCrisisOptions(selectedCrisis, playingCountryNames);
    room.phase2.crises.active = {
      ...transformedCrisis,
      triggeredAt: Date.now(),
      resolved: false,
      year: year // Store which year this crisis is for
    };
    room.phase2.crises.responses = {};
    
    console.log(`✋ Crisis active - waiting for player responses`);
    console.log(`   Affected countries (filtered):`, transformedCrisis.affectedCountries);
    console.log(`   Available options: ${Object.keys(room.phase2.crises.active.options).length}`);
    
    // Log crisis count
    const triggeredCount = room.phase2.crises.history.length + 1; // +1 for active
    const totalYears = 7; // 1946-1952
    console.log(`   Progress: ${triggeredCount}/${totalYears} crises triggered`);
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
    const bwBonus = agreementBonuses[country] || { 
      gdpBonus: 0, 
      tradeBonus: 0, 
      inflationMod: 0, 
      stabilityBonus: 0 
    };
    gdpGrowth += bwBonus.gdpBonus;
    tradeBalance += bwBonus.tradeBonus;
    // inflation will be defined later, store mod for now
    const inflationFromBW = bwBonus.inflationMod || 0;
    const stabilityFromBW = bwBonus.stabilityBonus || 0;
    
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
    
    // Apply Bretton Woods inflation modifier
    inflation += inflationFromBW;
    
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
    
    // Calculate stability (0-100 scale)
    // Lower inflation, unemployment, and higher GDP growth = more stable
    let stability = 50; // Base stability
    
    // Inflation impact on stability
    if (inflation < 3) {
      stability += 20;
    } else if (inflation < 5) {
      stability += 10;
    } else if (inflation > 10) {
      stability -= 20;
    } else if (inflation > 15) {
      stability -= 30;
    }
    
    // GDP growth impact
    if (gdpGrowth > 4) {
      stability += 10;
    } else if (gdpGrowth < 0) {
      stability -= 20;
    }
    
    // Unemployment impact
    if (unemployment < 4) {
      stability += 10;
    } else if (unemployment > 8) {
      stability -= 15;
    }
    
    // Apply Bretton Woods stability bonus
    stability += (stabilityFromBW || 0) * 10; // Scale to 0-100
    
    // === DEPLOYMENT CONFLICT EFFECTS ===
    // Check if this country is involved in any military conflicts
    const conflicts = room.phase2.conflicts || [];
    const regionalControl = room.phase2.regionalControl || {};
    
    const countryConflicts = conflicts.filter(c => c.countries.includes(country));
    
    if (countryConflicts.length > 0) {
      console.log(`⚔️  ${country} involved in ${countryConflicts.length} conflict(s):`);
      
      countryConflicts.forEach(conflict => {
        // Apply economic penalties based on conflict severity
        let gdpPenalty = 0;
        let stabilityPenalty = 0;
        let tradePenalty = 0;
        
        if (conflict.level === 'high') {
          gdpPenalty = 1.5;        // 1.5% GDP loss
          stabilityPenalty = 20;   // Major instability
          tradePenalty = 500;      // $500M trade disruption
          console.log(`   🔴 HIGH conflict in ${conflict.region}: Major economic impact`);
        } else if (conflict.level === 'medium') {
          gdpPenalty = 0.8;        // 0.8% GDP loss
          stabilityPenalty = 12;   // Moderate instability
          tradePenalty = 300;      // $300M trade disruption
          console.log(`   🟡 MEDIUM conflict in ${conflict.region}: Moderate impact`);
        } else {
          gdpPenalty = 0.3;        // 0.3% GDP loss
          stabilityPenalty = 5;    // Minor instability
          tradePenalty = 100;      // $100M trade disruption
          console.log(`   🟢 LOW conflict in ${conflict.region}: Minor impact`);
        }
        
        // Apply penalties
        gdpGrowth -= gdpPenalty;
        stability -= stabilityPenalty;
        tradeBalance -= tradePenalty;
        
        console.log(`      GDP: -${gdpPenalty}% | Stability: -${stabilityPenalty} | Trade: -$${tradePenalty}M`);
      });
    }
    
    // === REGIONAL CONTROL BONUSES ===
    // Countries that control regions get economic benefits
    let regionalBonuses = {
      gdp: 0,
      trade: 0,
      details: []
    };
    
    Object.entries(regionalControl).forEach(([region, control]) => {
      if (control.controller === country) {
        const regionData = deploymentSystem.REGIONS[region];
        
        if (regionData) {
          // Apply control bonuses from region
          const gdpBonus = regionData.controlBonus.gdp || 0;
          const tradeBonus = regionData.controlBonus.tradeBonus || regionData.tradeValue * 0.1;
          
          regionalBonuses.gdp += gdpBonus;
          regionalBonuses.trade += tradeBonus;
          regionalBonuses.details.push(`${region}: +${gdpBonus}% GDP, +$${Math.round(tradeBonus)}M trade`);
          
          // Contested regions give reduced benefits
          if (control.contested) {
            regionalBonuses.gdp *= 0.5;
            regionalBonuses.trade *= 0.5;
            regionalBonuses.details.push(`  (contested - benefits halved)`);
          }
        }
      }
    });
    
    if (regionalBonuses.gdp > 0 || regionalBonuses.trade > 0) {
      console.log(`🏆 ${country} regional control bonuses:`);
      regionalBonuses.details.forEach(d => console.log(`   ${d}`));
      
      gdpGrowth += regionalBonuses.gdp;
      tradeBalance += regionalBonuses.trade;
    }
    
    // Clamp to 0-100
    stability = Math.max(0, Math.min(100, stability));
    
    // Store results
    tempResults[country] = {
      gdpGrowth: Math.round(gdpGrowth * 10) / 10,
      goldReserves: Math.round(goldReserves),
      unemployment: Math.round(unemployment * 10) / 10,
      tradeBalance: Math.round(tradeBalance),
      inflation: Math.round(inflation * 10) / 10,
      industrialOutput: Math.round(industrialOutput),
      militarySpending: milSpending,
      stability: Math.round(stability),
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
      
      // Military deployment influence bonus
      try {
        const deploymentBonusPoints = deploymentSystem.calculateDeploymentInfluence(
          room.phase2.deployments,
          country,
          room.phase2.crisisDeploymentBonuses[country] || {}
        );
        
        if (deploymentBonusPoints > 0) {
          breakdown.deploymentInfluence = Math.round(deploymentBonusPoints);
          score += breakdown.deploymentInfluence;
          console.log(`🎖️ ${country} earned ${breakdown.deploymentInfluence} pts from military deployments`);
        }
      } catch (err) {
        console.error('Error calculating deployment influence:', err.message);
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
  
  // Sync Phase 2 scores to players table AND game_results table
  (async () => {
    for (const [country, score] of Object.entries(phase2Scores)) {
      try {
        // Save to game_results table
        await db.saveGameResult(room.gameCode, country, score, scoreBreakdowns[country]);
        console.log(`📊 Final result synced to MySQL: ${country} -> ${score}`);
        
        // Update player's phase2_score column
        const player = Object.values(room.players).find(p => p.country === country);
        if (player) {
          const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === player.playerId);
          if (username) {
            const userId = await getUserId(username);
            if (userId) {
              await db.updatePlayerPoints(room.gameCode, userId, score, 2); // phase=2
              console.log(`✅ Phase 2 score saved to players table: ${country} (${username}) -> ${score} points`);
            }
          }
        }
      } catch (err) {
        console.error(`❌ Error syncing scores for ${country}:`, err.message);
      }
    }
  })();
  
  return phase2Scores;
}

// Helper function to resolve crisis and apply effects
function resolveCrisisEffects(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return false;
  
  // Ensure phase2.crises is initialized
  if (!room.phase2.crises) {
    room.phase2.crises = {
      active: null,
      history: [],
      responses: {}
    };
  }
  
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
    resolved: true,
    autoResolved: true
  });
  
  // Mark crisis as resolved before clearing
  if (room.phase2.crises.active) {
    room.phase2.crises.active.resolved = true;
  }
  
  // Clear active crisis to allow policy submissions
  room.phase2.crises.active = null;
  room.phase2.crises.responses = {};
  
  console.log(`✅ Crisis resolved - players can now submit policies for year ${currentYear}`);
  
  // Broadcast that crisis is resolved and policy submission is now enabled
  io.to(roomId).emit('crisisResolved', {
    message: 'Crisis has been resolved. You may now submit your economic policies.',
    year: currentYear
  });
  
  // UPDATE SCORES IMMEDIATELY: Award diplomatic points as crisis scores
  Object.entries(responses).forEach(([country, response]) => {
    const choice = response.choice;
    const effects = choice.effects || {};
    
    // Award diplomatic points immediately as crisis points
    if (effects.diplomaticPoints) {
      const crisisPointsAwarded = effects.diplomaticPoints * 2; // 2 pts per diplomatic point
      room.scores[country] = (room.scores[country] || 0) + crisisPointsAwarded;
      console.log(`📊 ${country}: +${crisisPointsAwarded} crisis points (diplomatic: ${effects.diplomaticPoints})`);
    }
  });
  
  console.log(`✅ Crisis auto-resolved - ${Object.keys(responses).length} countries responded`);
  console.log(`Updated scores after crisis:`, room.scores);
  
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
    
    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
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
        if (dbUser) {
          // Use user_id with player_db_ prefix (consistent format)
          const playerId = `player_db_${dbUser.user_id}`;
          
          // Load user from database into memory
          globalState.users[username] = {
            password: dbUser.password_hash,
            playerId: playerId,
            userId: dbUser.user_id,
            createdAt: Date.now(),
            role: dbUser.is_teacher === '1' || dbUser.is_teacher === 1 ? 'superadmin' : 'player'
          };
          user = globalState.users[username];
          console.log('User loaded from database:', username, 'playerId:', playerId, 'role:', globalState.users[username].role);
          saveState();
        }
      } catch (err) {
        console.warn('⚠️ Could not check DB for user:', err.message);
      }
    }
    
    if (!user) {
      console.log('ERROR: User not found');
      socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
      return;
    }
    
    console.log('User found, role:', user.role || 'undefined');
    
    if (!verifyPassword(password, user.password)) {
      console.log('ERROR: Password incorrect');
      socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
      return;
    }
    
    const role = user.role || 'player';
    console.log('Login successful, sending role:', role);
    
    // Update last login time
    user.lastLogin = Date.now();
    saveState();
    
    // Check if user is already in an active game
    let activeGame = null;
    try {
      const userId = await getUserId(username);
      if (userId) {
        activeGame = await db.getPlayerActiveGame(userId);
        // Only return the game if it's actually in progress (not just in lobby)
        if (activeGame && activeGame.game_status) {
          // Only restore to games that are actually playing (not lobby or completed)
          if (activeGame.game_status === 'phase1_active' || activeGame.game_status === 'phase2_active') {
            console.log(`📊 User ${username} has active game: ${activeGame.game_code} as ${activeGame.country_name}`);
          } else if (activeGame.game_status === 'lobby') {
            console.log(`⚠️ User ${username} was in game ${activeGame.game_code} but it's in lobby - not restoring`);
            activeGame = null; // Don't restore - let them choose country again
          } else {
            console.log(`⚠️ User ${username} was in game ${activeGame.game_code} but it's no longer active (status: ${activeGame.game_status})`);
            activeGame = null; // Don't restore - game is completed or inactive
          }
        }
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
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    globalState.rooms[roomId] = createGameState(roomId, roomName, playerId);
    
    socket.join(roomId);
    socket.emit('roomCreated', { 
      success: true, 
      roomId: roomId,
      roomName: roomName
    });
    
    broadcastRoomList();
    saveState();
    
    // Sync to MySQL - capture the actual game_id returned
    (async () => {
      const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
      const userId = username ? await getUserId(username) : null;
      
      try {
        // Create game and get back the database game_id
        const result = await db.callAPI('createGame', { gameCode: roomId, createdBy: userId });
        if (result && result.game_id) {
          globalState.rooms[roomId].gameId = result.game_id;
          console.log(`📊 Game created in MySQL: ${roomId} -> database game_id ${result.game_id}`);
        } else {
          console.log(`⚠️ Game created in MySQL but no game_id returned for: ${roomId}`);
        }
      } catch (error) {
        console.error(`❌ Failed to create game in MySQL for ${roomId}:`, error);
      }
    })();
    
    console.log(`Room created: ${roomName} (${roomId}) by ${playerId}`);
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
  socket.on('joinGame', ({ roomId, playerId, country }) => {
    console.log(`🎮 Join game request: roomId=${roomId}, playerId=${playerId}, country=${country}`);
    console.log(`   Available rooms:`, Object.keys(globalState.rooms));
    
    const room = globalState.rooms[roomId];
    
    if (!room) {
      console.error(`❌ Room not found: ${roomId}`);
      console.error(`   Available rooms:`, Object.keys(globalState.rooms));
      socket.emit('joinResult', { 
        success: false, 
        message: `Room not found: ${roomId}. Available rooms: ${Object.keys(globalState.rooms).join(', ') || 'none'}` 
      });
      return;
    }
    
    // Prevent superadmin from joining as player
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    if (user && user.role === 'superadmin') {
      socket.emit('joinResult', { success: false, message: 'Administrator cannot join as a player. You are an observer.' });
      return;
    }
    
    const taken = Object.values(room.players).some(p => p.country === country);
    
    if (taken) {
      socket.emit('joinResult', { success: false, message: 'Country already taken' });
    } else {
      room.players[playerId] = {
        id: playerId,
        country: country,
        socketId: socket.id,
        joinedAt: Date.now()
      };
      
      socket.emit('joinResult', { success: true });
      broadcastToRoom(roomId);
      broadcastRoomList();
      saveState();
      
      // Sync to MySQL - add player with country assignment
      (async () => {
        try {
          // Debug: log the lookup
          console.log(`🔍 Looking for username with playerId: ${playerId}`);
          console.log(`🔍 globalState.users keys:`, Object.keys(globalState.users));
          
          const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
          console.log(`🔍 Found username: ${username || 'NOT FOUND'}`);
          
          if (!username) {
            console.warn(`⚠️ Could not find username for playerId ${playerId} - player not synced to MySQL`);
            return;
          }
          
          const userId = await getUserId(username);
          console.log(`🔍 Got userId: ${userId || 'NOT FOUND'}`);
          
          if (!userId) {
            console.warn(`⚠️ Could not get MySQL user_id for ${username} - player not synced to MySQL`);
            return;
          }
          
          // Get country name from countries list
          const countryNames = { USA: 'United States', UK: 'United Kingdom', USSR: 'Soviet Union', France: 'France', China: 'China', India: 'India', Argentina: 'Argentina' };
          await dbSync(db.addPlayer, room.gameCode, userId, country, countryNames[country] || country);
          console.log(`📊 Player ${username} (${country}) synced to MySQL`);
        } catch (err) {
          console.error(`❌ Error syncing player to MySQL:`, err.message);
        }
      })();
      
      console.log(`Player ${playerId} joined as ${country} in room ${roomId}`);
    }
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
    console.log('Total users in system:', Object.keys(globalState.users).length);
    console.log('All users:', Object.keys(globalState.users));
    
    const room = globalState.rooms[roomId];
    if (!room) {
      console.log('ERROR: Room not found');
      socket.emit('startGameResult', { success: false, message: 'Room not found' });
      return;
    }
    
    // Check if user is superadmin - search by playerId
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    console.log('User search by playerId:', playerId);
    console.log('User found:', user ? 'YES' : 'NO');
    
    if (user) {
      console.log('User details:', {
        playerId: user.playerId,
        role: user.role,
        createdAt: user.createdAt
      });
    } else {
      console.log('DEBUG: Searching all users for this playerId...');
      Object.entries(globalState.users).forEach(([username, userData]) => {
        console.log(`  - ${username}: playerId=${userData.playerId}, role=${userData.role}`);
      });
    }
    
    const isSuperAdmin = user && user.role === 'superadmin';
    const isRoomHost = room.hostId === playerId;
    console.log('Is superadmin:', isSuperAdmin);
    console.log('Is room host:', isRoomHost);
    
    if (!isSuperAdmin && !isRoomHost) {
      console.log('ERROR: Not superadmin or room host');
      socket.emit('startGameResult', { 
        success: false, 
        message: `Only the game admin can start games. Your role: ${user ? user.role : 'not found'}` 
      });
      return;
    }
    
    // Check if enough players
    const playerCount = Object.keys(room.players).length;
    console.log('Player count:', playerCount);
    
    if (playerCount < 2) {
      console.log('ERROR: Not enough players');
      socket.emit('startGameResult', { success: false, message: 'Need at least 2 players to start' });
      return;
    }
    
    room.gameStarted = true;
    room.isRevoting = false;
    
    // Check if skipping Phase 1
    if (skipPhase1) {
      console.log('🚀 Skipping Phase 1 - Starting directly in Phase 2');
      initializePhase2(roomId);
      room.currentRound = 11; // Mark Phase 1 as "complete"
      console.log('✅ Phase 2 initialized - Economic management (1946-1952)');
    } else {
      room.gamePhase = 'voting';
      room.currentRound = 1;
      console.log('Starting Phase 1 - Bretton Woods Conference voting');
    }
    
    console.log('SUCCESS: Game started!');
    socket.emit('startGameResult', { success: true });
    broadcastToRoom(roomId);
    broadcastRoomList();
    saveState();
    
    // Sync game start to MySQL using the game code
    const gameStatus = skipPhase1 ? 'phase2_active' : 'phase1_active';
    dbSync(db.updateGame, room.gameCode, { status: gameStatus, startedAt: true, currentRound: skipPhase1 ? 11 : 1 });
    console.log(`📊 Game ${room.gameCode} started in room ${roomId} synced to MySQL (status: ${gameStatus})`);
    
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
    
    // Send confirmation back to the voter
    socket.emit('voteConfirmed', {
      success: true,
      choice: choice,
      playerId: playerId
    });
    
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
        const alert = (message) => {
  console.log(`ALERT: ${message}`);
};

alert(⚠️ TIE DETECTED in round ${room.currentRound}: options ${tiedOptions.join(', ')} tied with ${maxVotes} votes each);
        
        console.log(`⚠️ TIE DETECTED in round ${room.currentRound}: options ${tiedOptions.join(', ')} tied with ${maxVotes} votes each`);
        console.log(`   Vote attempt ${room.voteAttempts[roundKey]} of 3`);
        
        if (room.voteAttempts[roundKey] >= 3) {
          // After 3 attempts, declare no resolution and skip to next round
          console.log(`❌ No resolution after 3 vote attempts - skipping policy and moving to next round (NO POINTS AWARDED)`);
          room.isRevoting = false; // Clear revote flag
          room.gamePhase = 'voting';
          room.roundOutcome = `UNRESOLVED TIE - No consensus after 3 votes (${tiedOptions.map(o => voteTally[o]).join('-')}). Moving to next round.`;
          room.winningOption = null;
          room.voteTally = voteTally;
          room.roundScores = {}; // No points awarded for unresolved tie
          
          // BROADCAST TIE ANNOUNCEMENT
          io.to(roomId).emit('tieVoteUnresolved', {
            message: `🚫 UNRESOLVED TIE - No consensus reached after 3 voting attempts`,
            details: `Options ${tiedOptions.map(o => o.toUpperCase()).join(' and ')} each received ${maxVotes} votes`,
            tiedOptions: tiedOptions.map(o => o.toUpperCase()),
            voteCounts: voteTally,
            attempts: 3,
            outcome: 'No points awarded. Moving to next round.'
          });
          
          broadcastToRoom(roomId);
          saveState();
          
          // Auto-advance after showing unresolved tie message
          if (room.autoAdvance) {
            const delay = room.autoAdvanceDelay || 5000;
            setTimeout(async () => {
              room.currentRound++;
              if (room.currentRound > 10) {
                initializePhase2(roomId);
                await dbSync(db.updateGame, room.gameCode, { status: 'phase2_active', currentRound: 11 });
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
          // Trigger revote (stay in same phase, just clear votes)
          console.log(`🔄 Triggering revote - clearing votes and waiting for new submissions`);
          room.votes = {}; // Clear votes for revote
          room.voteTally = voteTally;
          room.roundOutcome = `TIE! Revoting required (attempt ${room.voteAttempts[roundKey]}/3)`;
          room.isRevoting = true; // Flag to show revote state
          
          // BROADCAST TIE ANNOUNCEMENT FOR REVOTE
          io.to(roomId).emit('tieVoteRevote', {
            message: `⚖️ TIE VOTE! Revoting Required`,
            details: `Options ${tiedOptions.map(o => o.toUpperCase()).join(' and ')} each received ${maxVotes} votes`,
            tiedOptions: tiedOptions.map(o => o.toUpperCase()),
            voteCounts: voteTally,
            attempt: room.voteAttempts[roundKey],
            maxAttempts: 3,
            instruction: 'Please vote again to break the tie'
          });
          
          broadcastToRoom(roomId);
          saveState();
          return; // Stop processing, wait for revotes
        }
      }
      
      // No tie - determine winning option (most votes)
      let winningOption = tiedOptions[0]; // Since no tie, tiedOptions has exactly 1 element
      
      room.isRevoting = false; // Clear revote flag on successful vote
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
        
        await dbSync(db.saveRoundResult, room.gameCode, room.currentRound, 1, {
          winningOptionId: winningOption,
          winningOptionText: winningOptionText,
          totalVotes: playerIds.length,
          results: { voteTally, roundScores, issueTitle }
        });
        
        // Update game state in DB
        await dbSync(db.updateGame, room.gameCode, { currentRound: room.currentRound });
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
            await dbSync(db.updateGame, currentRoom.gameCode, { status: 'phase2_active', currentRound: 11 });
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
        await dbSync(db.saveVote, room.gameCode, userId, room.currentRound, 
          `issue_${room.currentRound}`, issueTitle, choice, optionText, pointsEarned);
        console.log(`📊 Vote synced: ${username} (${voterCountry}) -> ${choice}`);
        
        // Also update player total points to phase1_score column
        if (room.scores?.[voterCountry]) {
          console.log(`💾 Saving Phase 1 points to DB: ${username} (${voterCountry}) -> ${room.scores[voterCountry]} points`);
          const pointsResult = await dbSync(db.updatePlayerPoints, room.gameCode, userId, room.scores[voterCountry], 'phase1');
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
      room.isRevoting = false; // Clear revote flag
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
    
    // Check if there's an active crisis that must be resolved first
    if (room.phase2.crises?.active && !room.phase2.crises.active.resolved) {
      console.log(`   ❌ POLICY BLOCKED: Active crisis must be resolved first`);
      socket.emit('policyRejected', {
        reason: 'You must respond to the active crisis before submitting policies',
        crisis: room.phase2.crises.active
      });
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
    
    // Send confirmation back to the submitter
    socket.emit('policyConfirmed', {
      success: true,
      country: player.country,
      year: currentYear,
      policy: room.phase2.policies[currentYear][player.country]
    });
    
    // Sync policy to MySQL with full details
    const submittedPolicy = room.phase2.policies[currentYear][player.country];
    console.log(`   syncing to MySQL...`);
    (async () => {
      const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
      const userId = username ? await getUserId(username) : null;
      if (userId) {
        const phase2Round = currentYear - 1945; // 1946=round 1, 1947=round 2, etc.
        await dbSync(db.savePolicy, room.gameCode, userId, phase2Round, {
          year: currentYear,
          interestRate: submittedPolicy.centralBankRate || 0,
          govtSpending: submittedPolicy.militarySpending || 0,
          tradePolicy: submittedPolicy.isCommandEconomy ? 'command' : 'market',
          currencyPolicy: `rate_${submittedPolicy.exchangeRate || 1}`,
          policyFocus: submittedPolicy.isCommandEconomy ? 'heavy_industry' : 'balanced',
          rationale: JSON.stringify(submittedPolicy)
        });
        console.log(`📊 Policy synced to MySQL: ${username} (${currentYear})`);
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
      
      // Calculate this year's economics (this creates data for next year)
      console.log(`   calculating economics for ${room.phase2.currentYear}...`);
      calculateYearEconomics(roomId);
      
      // Advance year
      room.phase2.currentYear++;
      room.readyPlayers = [];
      console.log(`   advanced to year ${room.phase2.currentYear}`);
      
      // Check if we've completed all years (after advancing past 1952)
      if (room.phase2.currentYear > 1952) {
        // Game is complete - finalize
        console.log(`   [FINAL] Year is now ${room.phase2.currentYear}, game completing...`);
        calculatePhase2Scores(roomId);
        room.gamePhase = 'complete';
        room.phase2.active = false;
        // Async operations wrapped in IIFE
        (async () => {
          await dbSync(db.updateGame, room.gameCode, { status: 'completed', currentRound: 12 });
          // Release all players when game completes
          await dbSync(db.releaseAllPlayers, room.gameCode);
        })();
        console.log('[AUTO] Phase 2 complete! Final scores calculated. Players released.');
        broadcastToRoom(roomId);
        saveState();
        return;
      }
      
      // Sync to database
      const phase2Round = room.phase2.currentYear - 1945; // 1946=round 1, 1947=round 2, etc.
      dbSync(db.updateGame, room.gameCode, { currentRound: 10 + phase2Round });
      console.log(`📊 Synced Phase 2 year ${room.phase2.currentYear} to MySQL (round ${10 + phase2Round})`);
      
      // ===== TRIGGER CRISIS IMMEDIATELY AT START OF NEW YEAR =====
      console.log(`🚨 Checking for crisis at START of year ${room.phase2.currentYear}...`);
      triggerCrisisIfNeeded(roomId, room.phase2.currentYear);
      
      // If crisis was triggered, broadcast it and STOP (wait for responses)
      if (room.phase2.crises?.active) {
        console.log(`⚠️  CRISIS ACTIVE: ${room.phase2.crises.active.title}`);
        console.log(`   Players must respond BEFORE submitting policies`);
        
        // Broadcast crisis to all players
        io.to(roomId).emit('crisisTriggered', {
          crisis: room.phase2.crises.active,
          year: room.phase2.currentYear,
          message: 'CRISIS! You must respond before submitting economic policies.'
        });
        
        broadcastToRoom(roomId);
        saveState();
        
        // DO NOT allow policy submissions yet - crisis must be resolved first
        console.log(`[AUTO] Year advanced to ${room.phase2.currentYear}, but PAUSED for crisis resolution`);
        return;
      }
      
      console.log(`[AUTO] Advanced to year ${room.phase2.currentYear}`);
      
      // Check if we've reached the final year
      if (room.phase2.currentYear === 1952) {
        console.log('[AUTO] Now at final year 1952. After this year completes, Phase 2 will end.');
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
    
    console.log(`${player.country} deployed ${deployment.troops} ${deployment.branch || 'troops'} to ${deployment.region}`);
    
    // Use sophisticated conflict detection from deployment-impacts.js
    const conflicts = deploymentSystem.detectDeploymentConflicts(
      room.phase2.deployments, 
      room.phase2.currentYear
    );
    
    // Store conflicts
    room.phase2.conflicts = conflicts;
    
    // Calculate regional control
    const regionalControl = deploymentSystem.calculateRegionalControl(
      room.phase2.deployments,
      room.phase2.currentYear
    );
    room.phase2.regionalControl = regionalControl;
    
    // Log conflicts
    if (conflicts.length > 0) {
      conflicts.forEach(conflict => {
        console.log(`⚠️  CONFLICT (${conflict.level}): ${conflict.description}`);
        console.log(`   Strategic Importance: ${conflict.strategicImportance}/10`);
      });
      
      // Broadcast conflict alerts to all players
      io.to(roomId).emit('militaryConflict', {
        conflicts: conflicts,
        newDeployment: {
          country: deployment.country,
          region: deployment.region,
          troops: deployment.troops,
          branch: deployment.branch
        }
      });
    }
    
    // Log regional control changes
    Object.entries(regionalControl).forEach(([region, control]) => {
      if (control.controller) {
        console.log(`   ${control.controller} controls ${region} (strength: ${Math.round(control.strength)})`);
        if (control.contested) {
          console.log(`      ⚠️  CONTESTED by: ${control.competitors.join(', ')}`);
        }
      }
    });
    
    // Send confirmation with conflict info
    socket.emit('deploymentConfirmed', {
      success: true,
      deployment: deploymentRecord,
      conflicts: conflicts,
      regionalControl: regionalControl
    });
    
    // Calculate deployment impacts using deployment system
    try {
      const impacts = deploymentSystem.calculateDeploymentImpacts(
        deployment.country,
        deployment.region,
        deployment.troops,
        room.phase2.yearlyData[room.phase2.currentYear]?.[deployment.country]
      );
      
      if (impacts) {
        console.log(`💪 Deployment impacts for ${deployment.country}:`, impacts);
        // Store impacts for later use in crisis resolution and scoring
        if (!room.phase2.crisisDeploymentBonuses) {
          room.phase2.crisisDeploymentBonuses = {};
        }
        if (!room.phase2.crisisDeploymentBonuses[deployment.country]) {
          room.phase2.crisisDeploymentBonuses[deployment.country] = {};
        }
        room.phase2.crisisDeploymentBonuses[deployment.country][deployment.region] = impacts;
      }
    } catch (err) {
      console.error('Error calculating deployment impacts:', err.message);
    }
    
    // Sync deployment to MySQL
    (async () => {
      try {
        const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
        if (!username) {
          console.error(`❌ [Deployment] Cannot find username for playerId: ${playerId}`);
          return;
        }
        
        const userId = await getUserId(username);
        if (!userId) {
          console.error(`❌ [Deployment] Cannot find userId for username: ${username}`);
          return;
        }
        
        console.log(`💾 Saving deployment: username=${username}, userId=${userId}, region=${deployment.region}, troops=${deployment.troops}, branch=${deployment.branch}`);
        
        const result = await dbSync(db.saveDeployment, room.gameCode, userId, {
          country: deployment.country,
          region: deployment.region,
          troops: deployment.troops,
          branch: deployment.branch,
          year: room.phase2.currentYear
        });
        if (result) {
          console.log(`✅ Deployment synced to MySQL: ${username} (${deployment.region})`);
        } else {
          console.error(`❌ Deployment failed to sync for ${username}`);
        }
      } catch (err) {
        console.error(`❌ [Deployment Sync] Error:`, err.message);
      }
    })();
    
    broadcastToRoom(roomId);
    saveState();
  });

  // CRISIS: Submit response to active crisis
  socket.on('submitCrisisResponse', ({ roomId, playerId, choiceId }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.phase2.active) return;
    
    // Ensure phase2.crises is initialized
    if (!room.phase2.crises) {
      room.phase2.crises = {
        active: null,
        history: [],
        responses: {}
      };
    }
    
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
    
    // Check for deployment bonuses - if country has forces in crisis region
    try {
      const crisisRegion = crisis.affectedRegion || crisis.region; // Get crisis region
      const countryDeployments = (room.phase2.deployments || []).filter(d => 
        d.country === country && d.region === crisisRegion && d.year === room.phase2.currentYear
      );
      
      if (countryDeployments.length > 0) {
        const totalTroops = countryDeployments.reduce((sum, d) => sum + d.troops, 0);
        const bonus = deploymentSystem.calculateCrisisDeploymentBonus(
          totalTroops,
          choice.diplomaticPoints || 0
        );
        
        // Store the bonus for scoring later
        if (!room.phase2.crisisDeploymentBonuses) {
          room.phase2.crisisDeploymentBonuses = {};
        }
        if (!room.phase2.crisisDeploymentBonuses[country]) {
          room.phase2.crisisDeploymentBonuses[country] = {};
        }
        room.phase2.crisisDeploymentBonuses[country][crisis.id] = bonus;
        
        console.log(`🎖️ ${country} gets +${bonus} deployment bonus for responding to ${crisis.id} with ${totalTroops} troops in region`);
      }
    } catch (err) {
      console.error('Error calculating crisis deployment bonus:', err.message);
    }
    
    // Sync crisis response to MySQL
    (async () => {
      try {
        const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
        if (!username) {
          console.error(`❌ [Crisis Response] Cannot find username for playerId: ${playerId}`);
          return;
        }
        
        const userId = await getUserId(username);
        if (!userId) {
          console.error(`❌ [Crisis Response] Cannot find userId for username: ${username}`);
          return;
        }
        
        console.log(`💾 Saving crisis response: username=${username}, userId=${userId}, crisisId=${crisis.id}, optionId=${choiceId}, year=${room.phase2.currentYear}`);
        
        const result = await dbSync(db.saveCrisisResponse, room.gameCode, userId, crisis.id, choiceId, room.phase2.currentYear);
        if (result) {
          console.log(`✅ Crisis response synced to MySQL: ${username}`);
        } else {
          console.error(`❌ Crisis response failed to sync for ${username}`);
        }
      } catch (err) {
        console.error(`❌ [Crisis Response Sync] Error:`, err.message);
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
    
    // Ensure phase2.crises is initialized
    if (!room.phase2.crises) {
      room.phase2.crises = {
        active: null,
        history: [],
        responses: {}
      };
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
    
    // Calculate this year's economics (this creates data for next year)
    calculateYearEconomics(roomId);
    
    // Advance year
    room.phase2.currentYear++;
    room.readyPlayers = [];
    
    // Check if we've completed all years (after advancing past 1952)
    if (room.phase2.currentYear > 1952) {
      // Game is complete - finalize
      calculatePhase2Scores(roomId);
      room.gamePhase = 'complete';
      room.phase2.active = false;
      // Async operations wrapped in IIFE
      (async () => {
        await dbSync(db.updateGame, room.gameCode, { status: 'completed', currentRound: 12 });
        // Release all players when game completes
        await dbSync(db.releaseAllPlayers, room.gameCode);
      })();
      console.log('Phase 2 complete! Final scores calculated. Players released.');
      broadcastToRoom(roomId);
      saveState();
      return;
    }
    
    // ===== TRIGGER CRISIS IMMEDIATELY AT START OF NEW YEAR =====
    console.log(`🚨 Checking for crisis at START of year ${room.phase2.currentYear}...`);
    triggerCrisisIfNeeded(roomId, room.phase2.currentYear);
    
    // If crisis was triggered, broadcast it and STOP (wait for responses)
    if (room.phase2.crises?.active) {
      console.log(`⚠️  CRISIS ACTIVE: ${room.phase2.crises.active.title}`);
      console.log(`   Players must respond BEFORE submitting policies`);
      
      // Broadcast crisis to all players
      io.to(roomId).emit('crisisTriggered', {
        crisis: room.phase2.crises.active,
        year: room.phase2.currentYear,
        message: 'CRISIS! You must respond before submitting economic policies.'
      });
      
      broadcastToRoom(roomId);
      saveState();
      
      console.log(`✅ Advanced to year ${room.phase2.currentYear}, PAUSED for crisis resolution`);
      return;
    }
    
    console.log(`✅ Advanced to year ${room.phase2.currentYear}`);
    
    // Check if we've reached the final year
    if (room.phase2.currentYear === 1952) {
      console.log('Now at final year 1952. After this year completes, Phase 2 will end.');
    }
    
    console.log('Broadcasting updated game state...');
    broadcastToRoom(roomId);
    saveState();
    console.log('✅ Year advancement complete');
  });
  
  // ADMIN: Reset room (room host or superadmin)
  socket.on('resetRoom', async ({ roomId, playerId }) => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║              RESET ROOM REQUEST RECEIVED               ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('📋 Room ID:', roomId);
    console.log('👤 Player ID:', playerId);
    
    const room = globalState.rooms[roomId];
    if (!room) {
      console.log('❌ Room not found');
      return;
    }
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    const isSuperAdmin = user && user.role === 'superadmin';
    const isRoomHost = room.hostId === playerId;
    
    console.log('🔐 Permission check:');
    console.log('   Is superadmin:', isSuperAdmin);
    console.log('   Is room host:', isRoomHost);
    
    if (!isSuperAdmin && !isRoomHost) {
      socket.emit('resetRoomResult', { success: false, message: 'Only the game admin can reset games' });
      console.log('❌ Permission denied');
      return;
    }
    
    console.log('✅ Permission granted - resetting game');
    
    // Get username and userId
    const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
    let userId = null;
    if (username) {
      userId = await getUserId(username);
    }
    
    try {
      // Mark old game as complete and update database
      const gameCode = room.gameCode || roomId;
      console.log('📦 Updating database for gameCode:', gameCode);
      
      // Mark old game complete
      if (room.gameId) {
        console.log('   Marking game as complete...');
        await dbSync(db.updateGame, gameCode, { status: 'complete' });
        console.log('   ✅ Game marked as complete');
      }
      
      // Release all players
      console.log('   Releasing all players...');
      await dbSync(db.releaseAllPlayers, gameCode);
      console.log('   ✅ Players released');
      
      // Check if game exists, create or reset
      const existingGame = await db.getGame(gameCode);
      let gameId;
      
      if (existingGame && existingGame.game_id) {
        console.log('   Game exists, resetting to lobby...');
        gameId = existingGame.game_id;
        await dbSync(db.updateGame, gameCode, { status: 'lobby', currentRound: 0 });
      } else {
        console.log('   Game doesn\'t exist, creating...');
        const result = await db.createGame(gameCode, userId);
        gameId = result.game_id;
        await dbSync(db.updateGame, gameCode, { status: 'lobby', currentRound: 0 });
      }
      
      console.log('   ✅ Database updated, game_id:', gameId);
      
      // Update room state
      room.gameId = gameId;
      room.gameCode = gameCode;
      
    } catch (err) {
      console.error('⚠️ Error updating database:', err.message);
      console.log('Continuing with memory-only reset...');
    }
    
    // Reset game state in memory
    console.log('📦 Resetting room state in memory...');
    room.gameStarted = false;
    room.currentRound = 0;
    room.gamePhase = 'lobby';
    room.votes = {};
    room.isRevoting = false;
    room.scores = { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 };
    room.roundHistory = [];
    room.readyPlayers = [];
    room.players = {}; // Clear players to force re-selection
    room.phase2 = {
      active: false,
      currentYear: 1946,
      maxYears: 7,
      policies: {},
      yearlyData: {},
      achievements: {},
      crises: {
        active: null,
        history: [],
        responses: {}
      },
      deployments: [],
      conflicts: [],
      regionalControl: {},
      crisisDeploymentBonuses: {}
    };
    console.log('   ✅ Room state reset');
    
    socket.emit('resetRoomResult', { success: true });
    broadcastToRoom(roomId);
    broadcastRoomList();
    saveState();
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║              ROOM RESET COMPLETE                       ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('✅ Game reset to lobby');
    console.log('✅ Database updated');
    console.log('✅ Players must choose countries again');
    console.log('');
  });
  
  // ADMIN: Start new game (resets current game and releases all players)
  socket.on('startNewGame', async ({ roomId, playerId }) => {
    console.log('=== START NEW GAME REQUEST ===');
    console.log('Room ID:', roomId);
    console.log('Player ID:', playerId);
    
    const room = globalState.rooms[roomId];
    if (!room) {
      console.log('ERROR: Room not found');
      socket.emit('startNewGameResult', { success: false, message: 'Room not found' });
      return;
    }
    
    console.log('Current room.gameCode:', room.gameCode);
    console.log('Current room.gameId:', room.gameId);
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    const isSuperAdmin = user && user.role === 'superadmin';
    const isRoomHost = room.hostId === playerId;
    
    if (!isSuperAdmin && !isRoomHost) {
      socket.emit('startNewGameResult', { success: false, message: 'Only the game admin can start a new game' });
      return;
    }
    
    // Get the username and userId for the creator
    const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
    console.log('Found username:', username);
    
    let userId = null;
    if (username) {
      userId = await getUserId(username);
      console.log('Got userId from database:', userId);
    } else {
      console.error('ERROR: Could not find username for playerId:', playerId);
    }
    
    try {
      // Mark the OLD game as completed in database (if it exists)
      const oldGameCode = room.gameCode;
      const oldGameId = room.gameId;
      
      if (oldGameCode && oldGameId) {
        console.log(`Marking old game ${oldGameCode} (game_id: ${oldGameId}) as completed...`);
        await dbSync(db.updateGame, oldGameCode, { status: 'complete' });
        
        // Release all players from the OLD game
        await dbSync(db.releaseAllPlayers, oldGameCode);
        console.log(`✅ Old game completed and players released`);
      }
      
      // Create a NEW game with UNIQUE gameCode (timestamp + random)
      // This ALWAYS creates a NEW game_id in the database
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8); // 6 char random string
      const newGameCode = `${roomId}-${timestamp}-${random}`;
      console.log(`╔════════════════════════════════════════════════════════╗`);
      console.log(`║           CREATING NEW GAME IN DATABASE               ║`);
      console.log(`╚════════════════════════════════════════════════════════╝`);
      console.log(`📋 New gameCode: ${newGameCode}`);
      console.log(`👤 Creator userId: ${userId}`);
      console.log(`📞 Calling db.createGame()...`);
      
      const result = await db.createGame(newGameCode, userId);
      
      console.log(`╔════════════════════════════════════════════════════════╗`);
      console.log(`║           DATABASE RESPONSE RECEIVED                   ║`);
      console.log(`╚════════════════════════════════════════════════════════╝`);
      console.log(`📦 Full result object:`, JSON.stringify(result, null, 2));
      console.log(`🔑 result.game_id:`, result?.game_id);
      console.log(`✓ result.existed:`, result?.existed);
      console.log(`⚠️  result.error:`, result?.error);
      console.log(`⚠️  result.success:`, result?.success);
      
      if (!result) {
        console.error('❌ ERROR: db.createGame returned null/undefined');
        socket.emit('startNewGameResult', { success: false, message: 'Database returned no result' });
        return;
      }
      
      if (result.error) {
        console.error('❌ ERROR: Database returned error:', result.error);
        socket.emit('startNewGameResult', { success: false, message: result.error });
        return;
      }
      
      if (!result.game_id) {
        console.error('❌ ERROR: No game_id in result');
        console.error('   This means the API did not create a new game');
        console.error('   Full result:', JSON.stringify(result));
        socket.emit('startNewGameResult', { success: false, message: 'Failed to create new game in database - no game_id returned' });
        return;
      }
      
      const newGameId = result.game_id;
      console.log(`╔════════════════════════════════════════════════════════╗`);
      console.log(`║           NEW GAME CREATED SUCCESSFULLY                ║`);
      console.log(`╚════════════════════════════════════════════════════════╝`);
      console.log(`✅ NEW game_id: ${newGameId}`);
      console.log(`✅ NEW gameCode: ${newGameCode}`);
      console.log(`✅ Was this a brand new game? ${result.existed === false ? 'YES' : 'NO (REUSED EXISTING)'}`);
      console.log(``);
      
      // Set initial status
      await dbSync(db.updateGame, newGameCode, { status: 'lobby', currentRound: 0 });
      
      // Update room to point to NEW game
      console.log(`Updating room state:`);
      console.log(`  Old: gameId=${oldGameId}, gameCode=${oldGameCode}`);
      console.log(`  New: gameId=${newGameId}, gameCode=${newGameCode}`);
      
      room.gameId = newGameId;
      room.gameCode = newGameCode;
      
      // CRITICAL: Reset game state completely
      room.gameStarted = false;
      room.currentRound = 0;
      room.gamePhase = 'lobby';
      room.votes = {};
      room.scores = { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 };
      room.roundHistory = [];
      room.readyPlayers = [];
      room.players = {}; // Clear player assignments in memory - forces everyone back to lobby
      room.phase2 = {
        active: false,
        currentYear: 1946,
        maxYears: 7,
        policies: {},
        yearlyData: {},
        achievements: {},
        crises: {
          active: null,
          history: [],
          responses: {}
        },
        deployments: [],
        conflicts: [],
        regionalControl: {},
        crisisDeploymentBonuses: {}
      };
      
      console.log(`✅ Room state reset complete`);
      console.log(`  Current gameCode: ${room.gameCode}`);
      console.log(`  Current gameId: ${room.gameId}`);
      
      socket.emit('startNewGameResult', { success: true, gameId: newGameId, gameCode: newGameCode });
      
      console.log(`Broadcasting room state and saving...`);
      broadcastToRoom(roomId);
      broadcastRoomList();
      saveState();
      
      console.log(`✅ ========================================`);
      console.log(`✅ NEW GAME CREATED SUCCESSFULLY`);
      console.log(`✅ Room ID: ${roomId}`);
      console.log(`✅ NEW Game Code: ${newGameCode}`);
      console.log(`✅ NEW Game ID: ${newGameId}`);
      console.log(`✅ Old game: ${oldGameCode || 'none'} (game_id: ${oldGameId || 'none'}) - marked as complete`);
      console.log(`✅ Created by: ${username || 'unknown'} (${isSuperAdmin ? 'superadmin' : 'room host'})`);
      console.log(`✅ This is a brand new game with a new database record`);
      console.log(`✅ Players must now choose countries in lobby`);
      console.log(`✅ ========================================`);
    } catch (error) {
      console.error('❌ ERROR creating new game:', error);
      console.error('❌ Error stack:', error.stack);
      socket.emit('startNewGameResult', { success: false, message: 'Error creating new game: ' + error.message });
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
});

// Start server with database connection
async function startServer() {
  // Test database connection
  const dbConnected = await db.testConnection();
  
  // Ensure database schema exists
  if (dbConnected) {
    try {
      await db.setupSchema();
      console.log('✅ Database schema verified');
      
      // Score columns already exist in database (phase1_score, phase2_score)
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
