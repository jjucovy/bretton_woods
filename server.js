// server-multiroom.js - Bretton Woods Multi-Room Server
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  normalizeCountryName,
  isCommandEconomy,
  areRivals,
  getBaseGDP,
  getInitialExchangeRate,
  getInitialUnemployment,
  getInitialInflation,
  INITIAL_EXCHANGE_RATES,
  COUNTRIES
} = require('./shared/country-utils');
const { queryDatabase, queryDatabaseForm } = require('./server/database');
const { sendAdminNotification } = require('./server/email');
const {
  REGIONS: DEPLOYMENT_REGIONS,
  calculateDeploymentCosts,
  calculateDeploymentEconomics,
  calculateRegionalControl,
  detectDeploymentConflicts,
  applyDeploymentEffects
} = require('./deployment-impacts');
// Economics functions (calculateAgreementBonus, calculateExchangeRate,
// calculateYearEconomics, calculatePhase2Scores) are also available as a
// module at ./server/economics.js. The inline definitions below are still
// used by the socket handlers and will be migrated incrementally.

// Password hashing using Node's built-in crypto (scrypt)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;

  // Format 3: New scrypt hash (salt:hash with colon separator)
  if (stored.includes(':') && stored.length > 100) {
    const [salt, hash] = stored.split(':');
    const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return hash === testHash;
  }

  // Format 2: Old SHA256 hash (64-char hex, static salt 'bretton-woods-2024')
  if (/^[a-f0-9]{64}$/.test(stored)) {
    const oldHash = crypto.createHash('sha256').update('bretton-woods-2024' + password).digest('hex');
    return oldHash === stored;
  }

  // Format 1: Plaintext password (legacy)
  return password === stored;
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 65002;
// Write state files to /tmp so pm2-watch doesn't detect changes and restart the server.
// DB snapshots + player scores are the authoritative persistence; the state file is a
// fast-start cache that's safe to lose across reboots.
const STATE_FILE = '/tmp/bretton-woods-state.json';

// Database (queryDatabase) imported from ./server/database.js
// Email (sendAdminNotification) imported from ./server/email.js

// normalizeCountryName, isCommandEconomy, areRivals, etc.
// imported from ./shared/country-utils.js
// queryDatabase imported from ./server/database.js
// sendAdminNotification imported from ./server/email.js

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Serve game HTML as the main page (MUST come before static middleware!)
app.get('/', (req, res) => {
  console.log(`🌐 Page request from ${req.ip}`);
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Diagnostic endpoint to check state
app.get('/debug/users', (req, res) => {
  const userList = Object.entries(globalState.users).map(([username, data]) => ({
    username,
    playerid: data.player.id,
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

// Diagnostic endpoint to check rooms
app.get('/admin/clear-memory-games', (req, res) => {
  const before = Object.keys(globalState.rooms).length;
  let removed = 0;
  for (const roomId of Object.keys(globalState.rooms)) {
    if (!globalState.rooms[roomId].gameId) {
      delete globalState.rooms[roomId];
      removed++;
    }
  }
  saveState();
  res.json({ removed, remaining: Object.keys(globalState.rooms).length, before });
});

app.get('/debug/rooms', (req, res) => {
  const rooms = Object.entries(globalState.rooms).map(([roomId, room]) => ({
    roomId,
    gameCode: room.gameCode,
    gameId: room.gameId,
    gamePhase: room.gamePhase,
    gameStarted: room.gameStarted,
    hostUserId: room.hostUserId,
    hostIsSuperAdmin: room.hostIsSuperAdmin,
    playerCount: Object.keys(room.players || {}).length,
    createdAt: room.createdAt
  }));
  res.json({ totalRooms: rooms.length, rooms });
});

// Serve static files (after the specific route)

// NEW: API endpoint to get available games for regular users (lobby games only)
app.get('/api/available-games', async (req, res) => {
  const { playerid } = req.query;
  
  // Verify user is authenticated
  const user = Object.values(globalState.users).find(u => u.player.id === player.id);
  if (!user) {
    return res.status(403).json({ error: 'Authentication required' });
  }
  
  const availableGames = [];
  
  // Get active games from database
  const dbGames = await queryDatabase('getGames', { status: 'active' });
  
  if (dbGames && Array.isArray(dbGames)) {
    for (const game of dbGames) {
      const roomState = globalState.rooms[game.game_code];
      
      // Only show games that are in lobby phase and have room for more players
      if (roomState && roomState.gamePhase === 'lobby') {
        const playerCount = Object.keys(roomState.players).length;
        if (playerCount < 7) {
          availableGames.push({
            gameCode: game.game_code,
            gameId: game.game_id,
            status: game.status,
            playerCount: playerCount,
            availableSlots: 7 - playerCount,
            createdAt: game.created_at,
            hostUserId: game.host_user_id,
            currentYear:game.currentYear
          });
        }
      }
    }
  }
  
  res.json({ games: availableGames });
});

// NEW: API endpoint to get all active games (for superadmin only)
app.get('/api/active-games', async (req, res) => {
  const adminId = req.query.adminPlayerId || req.query.adminplayerid;

  if (!await verifyAdmin(adminId)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  // Get all games (including in-progress ones)
  const activeGames = [];
  
  // Get games from database
  const dbGames = await queryDatabase('getGames', { status: 'active' });
  
  if (dbGames && Array.isArray(dbGames)) {
    for (const game of dbGames) {
      const roomState = globalState.rooms[game.game_code];
      activeGames.push({
        gameCode: game.game_code,
        gameId: game.game_id,
        status: game.status,
        currentRound: game.current_round,
        hostUserId: game.host_user_id,
        playerCount: roomState ? Object.keys(roomState.players).length : 0,
        gamePhase: roomState ? roomState.gamePhase : 'unknown',
        phase2Active: roomState ? roomState.phase2?.active : false,
        currentYear: roomState ? roomState.phase2?.currentYear : null,
        createdAt: game.created_at,
        startedAt: game.started_at,
        inMemory: !!roomState
      });
    }
  }
  
  // Also check for rooms in memory that might not be in database
  for (const [roomId, roomState] of Object.entries(globalState.rooms)) {
    if (!activeGames.find(g => g.gameCode === roomId)) {
      activeGames.push({
        gameCode: roomId,
        gameId: roomState.gameId,
        status: 'memory-only',
        currentRound: roomState.currentRound,
        hostUserId: roomState.hostId,
        playerCount: Object.keys(roomState.players).length,
        gamePhase: roomState.gamePhase,
        phase2Active: roomState.phase2?.active,
        currentYear: roomState.phase2?.currentYear,
        createdAt: new Date(roomState.createdAt).toISOString(),
        inMemory: true
      });
    }
  }
  
  res.json({ games: activeGames });
});

app.use(express.static(__dirname));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Multi-room game state
let globalState = {
  users: {}, // username -> { password: hashedPassword, playerid: string, createdAt: timestamp }
  rooms: {}, // roomId -> gameState
  roomList: [] // { id, name, host, playerCount, maxPlayers, status, createdAt }
};

// Global observer registry: roomId -> { userId -> socketId | null }
// Kept separate from room objects so room replacements/reconstructions don't lose it.
const observerRegistry = {};

// Load military deployments data
const militaryDeploymentsData = require('./military-deployments.json');

// Load crisis events data
const crisisEventsData = require('./crisis-events.json');

// Create default game state template
function createGameState(roomId, roomName, hostId) {
  return {
    roomId: roomId,
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
        responses: {} // player.id -> response choice
      }
    },
    maxPlayers: 7,
    createdAt: Date.now(),
    observerSockets: {}   // userId → socketId for superadmin observers
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
  } catch (err) {
    console.error('❌ Error saving state:', err);
  }
}

// Save Phase 2 state to per-game file (backup for server restarts)
function saveGamePhase2State(roomId) {
  try {
    const room = globalState.rooms[roomId];
    // Save if we have phase2 data (don't require active - game might be complete)
    if (!room || !room.phase2 || !room.phase2.yearlyData) return;

    const gameStateFile = `/tmp/bretton-woods-phase2-${roomId}.json`;
    const phase2State = {
      currentYear: room.phase2.currentYear,
      yearlyData: room.phase2.yearlyData,
      policies: room.phase2.policies,
      achievements: room.phase2.achievements,
      crises: room.phase2.crises,
      active: room.phase2.active,
      // Persist deployment and battle state
      cumulativeDeployments: room.phase2.cumulativeDeployments || {},
      deploymentHistory: room.phase2.deploymentHistory || [],
      pendingConflictZones: room.phase2.pendingConflictZones || {},
      activeConflicts: room.phase2.activeConflicts || [],
      battleResults: room.phase2.battleResults || [],
      battleDecisions: room.phase2.battleDecisions || {},
      battleOptions: room.phase2.battleOptions || {},
      diplomaticStances: room.phase2.diplomaticStances || {},
      diplomaticPoints: room.phase2.diplomaticPoints || {},
      awaitingDiplomaticResolution: room.phase2.awaitingDiplomaticResolution || false,
      scoreBreakdowns: room.phase2.scoreBreakdowns || {},
      savedAt: Date.now()
    };

    fs.writeFileSync(gameStateFile, JSON.stringify(phase2State, null, 2));
  } catch (err) {
    console.error(`❌ Error saving Phase 2 state for ${roomId}:`, err);
  }
}

// Save a complete game state snapshot to MySQL (Hostinger)
// Called at end of each round (Phase 1) or year (Phase 2)
async function saveGameStateSnapshot(roomId, snapshotType) {
  const room = globalState.rooms[roomId];
  if (!room) return;

  try {
    const isPhase2 = room.gamePhase === 'phase2' || room.gamePhase === 'complete';
    const phase = isPhase2 ? 2 : 1;
    const roundOrYear = isPhase2 ? (room.phase2?.currentYear || 1946) : (room.currentRound || 1);

    // Serialize full_state and check size
    let fullStateJson = '';
    try {
      fullStateJson = JSON.stringify(room);
    } catch (e) {
      console.error(`⚠️ Could not serialize room state: ${e.message}`);
    }
    const fullStateSizeKB = Math.round(fullStateJson.length / 1024);
    console.log(`📸 Preparing snapshot: ${roomId} [${snapshotType}] phase=${phase} round/year=${roundOrYear} full_state=${fullStateSizeKB}KB`);

    // If full_state is too large (>500KB), skip it to avoid PHP/MySQL limits
    // The individual fields (yearly_data, policies, etc.) will still be saved
    if (fullStateSizeKB > 500) {
      console.log(`   ⚠️ full_state too large (${fullStateSizeKB}KB) — saving without it`);
      fullStateJson = '';
    }

    const snapshotData = {
      game_code: roomId,
      game_id: room.gameId || null,
      snapshot_type: snapshotType,
      phase,
      round_or_year: roundOrYear,
      players: Object.fromEntries(
        Object.entries(room.players).map(([id, p]) => {
          const normCountry = normalizeCountryName(p.country) || p.country;
          const score = p.score || room.scores?.[normCountry] || room.scores?.[p.country] || 0;
          return [id, { country: p.country, score }];
        })
      ),
      scores: room.scores || {},
      round_history: room.roundHistory || [],
      current_round: room.currentRound || 0,
      current_year: room.phase2?.currentYear || null,
      yearly_data: isPhase2 ? (room.phase2?.yearlyData || null) : null,
      policies: isPhase2 ? (room.phase2?.policies || null) : null,
      deployments: isPhase2 ? (room.phase2?.cumulativeDeployments || null) : null,
      deployment_history: isPhase2 ? (room.phase2?.deploymentHistory || null) : null,
      crises: isPhase2 ? (room.phase2?.crises || null) : null,
      battle_results: isPhase2 ? (room.phase2?.battleResults || null) : null,
      diplomatic_points: isPhase2 ? (room.phase2?.diplomaticPoints || null) : null,
      full_state: fullStateJson,
      player_count: Object.keys(room.players).length
    };

    const result = await queryDatabase('saveGameStateSnapshot', snapshotData);
    if (result) {
      console.log(`📸 Snapshot saved OK: ${roomId} [${snapshotType}] phase=${phase} round/year=${roundOrYear}`);
    } else {
      console.error(`⚠️ Snapshot save returned null for ${roomId} [${snapshotType}] — retrying without full_state...`);
      // Retry without full_state (which may be causing the failure)
      snapshotData.full_state = '';
      const retry = await queryDatabase('saveGameStateSnapshot', snapshotData);
      if (retry) {
        console.log(`📸 Snapshot saved OK (without full_state): ${roomId} [${snapshotType}] round/year=${roundOrYear}`);
      } else {
        console.error(`❌ Snapshot save failed even without full_state for ${roomId}`);
      }
    }
  } catch (err) {
    console.error(`⚠️ Failed to save game state snapshot for ${roomId}:`, err);
  }
}

// Load Phase 2 state from per-game file
function loadGamePhase2State(roomId) {
  try {
    const gameStateFile = `/tmp/bretton-woods-phase2-${roomId}.json`;
    if (!fs.existsSync(gameStateFile)) {
      return null;
    }

    const data = fs.readFileSync(gameStateFile, 'utf8');
    const phase2State = JSON.parse(data);
    console.log(`📂 Loaded Phase 2 state for ${roomId} (saved at ${new Date(phase2State.savedAt).toLocaleString()})`);
    return phase2State;
  } catch (err) {
    console.error(`❌ Error loading Phase 2 state for ${roomId}:`, err);
    return null;
  }
}

// Save player scores (phase1_score and/or phase2_score) to the players table in DB
async function savePlayerScoresToDB(roomId, phase) {
  const room = globalState.rooms[roomId];
  if (!room || !room.gameId) return;

  const gameCode = roomId;
  for (const [userId, player] of Object.entries(room.players)) {
    const country = normalizeCountryName(player.country) || player.country;
    const score = room.scores?.[country] || 0;
    if (score === 0 && phase === 'phase1') continue; // Skip if no points yet

    try {
      await queryDatabase('updatePlayerPoints', {
        gameCode,
        userId: userId,
        points: score,
        phase: phase
      });
      console.log(`✅ ${phase}_score saved to DB: ${country} (user ${userId}) = ${score}`);
    } catch (err) {
      console.error(`❌ Failed to save ${phase}_score for ${country}:`, err.message);
    }
  }
}

// Save game state to database
async function saveGameToDatabase(roomId) {
  try {
    const room = globalState.rooms[roomId];
    if (!room) return;

    // Ensure we have a valid game_id (not a timestamp)
    if (!room.gameId || room.gameId > 1000000000000) {
      console.log(`⚠️ Invalid game_id for ${roomId}, skipping database update`);
      return;
    }

    // Map game phase to status
    let gameStatus = 'lobby';
    if (room.gamePhase === 'complete') {
      gameStatus = 'completed';
    } else if (room.gameStarted) {
      gameStatus = 'active';
    }

    // Get the current round value
    const currentRound = room.currentRound !== undefined ? Number(room.currentRound) : 0;

    // Prepare update data - use game_id as the primary key for updates
    const updateData = {
      game_id: parseInt(room.gameId),
      status: gameStatus,
      current_round: currentRound
    };

    // Add Phase 2 year if available (don't require active since game might be complete)
    if (room.phase2?.currentYear) {
      updateData.currentYear = room.phase2.currentYear;
    }

    // Mark as ended if complete
    if (room.gamePhase === 'complete') {
      updateData.endedAt = true; // API will set to NOW()
    }

    console.log(`💾 Saving game ${roomId} (game_id=${room.gameId}) to database: status=${gameStatus}, round=${currentRound}, year=${room.phase2?.currentYear || 'N/A'}`);

    // Update game in database
    const result = await queryDatabase('updateGame', updateData);

    if (result) {
      console.log(`✅ Game ${roomId} saved to database`);
    } else {
      console.log(`⚠️ Game ${roomId} DB update returned no result - check PHP API logs`);
    }
  } catch (err) {
    console.error('❌ Error saving game to database:', err);
  }
}

// Enhanced saveState that also saves to database
function saveStateWithDB(roomId) {
  saveState(); // Save to JSON file
  if (roomId) {
    saveGameToDatabase(roomId); // Save to database
  }
}

// Load state on startup
loadState();

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
app.post('/api/import-state/:roomId', express.json({ limit: '10mb' }), async (req, res) => {
  const { roomId } = req.params;
  const { roomData, playerid } = req.body;
  
  // Verify admin permissions by checking database
  let isSuperAdmin = false;
  
  try {
    const dbUsers = await queryDatabase('getAllUsers', {});
    
    if (dbUsers && Array.isArray(dbUsers)) {
      const dbUser = dbUsers.find(u => u.user_id === player.id);
      
      if (dbUser) {
        isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
      }
    }
  } catch (err) {
    console.error('Error checking user role:', err);
  }
  
  if (!isSuperAdmin) {
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

// Helper: verify admin by checking globalState.users first, then falling back to DB
async function verifyAdmin(playerIdParam) {
  if (!playerIdParam) return false;

  // Check in-memory users first
  const localAdmin = Object.values(globalState.users).find(u => u.player?.id === playerIdParam);
  if (localAdmin) return localAdmin.role === 'superadmin';

  // Fallback: check database (needed after server restart when globalState.users is empty)
  try {
    const dbUsers = await queryDatabase('getAllUsers', {});
    if (dbUsers && Array.isArray(dbUsers)) {
      const dbUser = dbUsers.find(u => u.user_id === playerIdParam || String(u.user_id) === String(playerIdParam));
      if (dbUser) {
        return dbUser.is_teacher === '1' || dbUser.is_teacher === 1;
      }
    }
  } catch (err) {
    console.error('Error verifying admin via DB:', err);
  }
  return false;
}

// Get all users (admin only)
app.get('/api/users', async (req, res) => {
  const adminId = req.query.adminPlayerId || req.query.adminplayerid;

  if (!await verifyAdmin(adminId)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Return users from database (authoritative source)
  try {
    const dbUsers = await queryDatabase('getAllUsers', {});
    if (dbUsers && Array.isArray(dbUsers)) {
      const users = dbUsers.map(u => ({
        username: u.username,
        playerid: u.user_id,
        role: (u.is_teacher === '1' || u.is_teacher === 1) ? 'superadmin' : 'player',
        createdAt: u.created_at,
        lastLogin: u.last_login
      }));
      return res.json({ users });
    }
  } catch (err) {
    console.error('Error loading users from DB:', err);
  }

  // Fallback to in-memory users
  const users = Object.entries(globalState.users).map(([username, data]) => ({
    username,
    playerid: data.player.id,
    role: data.role,
    createdAt: data.createdAt,
    lastLogin: data.lastLogin
  }));

  res.json({ users });
});

// Delete user (admin only)
app.delete('/api/users/:username', express.json(), async (req, res) => {
  const { username } = req.params;
  const adminId = req.body.adminPlayerId || req.body.adminplayerid;

  if (!await verifyAdmin(adminId)) {
    return res.status(403).json({ error: 'Admin access required' });
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
app.get('/api/export-users', async (req, res) => {
  const adminId = req.query.adminPlayerId || req.query.adminplayerid;

  if (!await verifyAdmin(adminId)) {
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


// Auto-save and shutdown handlers are defined later (near server startup)
// to ensure per-game Phase 2 state files are always included.

// Password functions
// (crypto already required at top of file)

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
  
  // Log what we're about to broadcast
  if (room.phase2?.active) {
    console.log(`\n📡 BROADCASTING ROOM ${roomId}:`);
    console.log(`   phase2.active: ${room.phase2.active}`);
    console.log(`   phase2.currentYear: ${room.phase2.currentYear}`);
    console.log(`   phase2.yearlyData type: ${typeof room.phase2.yearlyData}`);
    console.log(`   phase2.yearlyData keys:`, Object.keys(room.phase2.yearlyData));
    
    if (room.phase2.yearlyData[1946]) {
      const year1946 = room.phase2.yearlyData[1946];
      console.log(`   yearlyData[1946] type: ${typeof year1946}`);
      console.log(`   yearlyData[1946] keys:`, Object.keys(year1946));
      
      const firstCountry = Object.entries(year1946)[0];
      if (firstCountry) {
        console.log(`   Sample (${firstCountry[0]}):`, JSON.stringify(firstCountry[1], null, 2).substring(0, 200));
      }
    } else {
      console.log(`   ⚠️ yearlyData[1946] is ${typeof room.phase2.yearlyData[1946]}`);
    }
  }

  // Emit to all sockets in the game room (players + anyone who joined)
  io.to(roomId).emit('stateUpdate', room);
  // Emit to dedicated observer Socket.IO room (belt-and-suspenders)
  io.to(`observers:${roomId}`).emit('stateUpdate', room);

  // Last-resort: find the admin's socket by host_user_id via fetchSockets().
  // This works even if their socket was never in the game/observer room
  // (e.g. after a rapid restart where room membership was lost).
  const adminUserId = String(room.hostUserId || room.hostId || '');
  if (adminUserId) {
    io.fetchSockets().then(allSockets => {
      const adminSock = allSockets.find(s => String(s.userId) === adminUserId);
      if (adminSock) {
        adminSock.emit('stateUpdate', room);
      }
      io.in(roomId).allSockets().then(roomSockets => {
        io.in(`observers:${roomId}`).allSockets().then(obsSockets => {
          console.log(`📡 Broadcast to ${roomId}: ${Object.keys(room.players).length} player(s), room=${roomSockets.size}, obsRoom=${obsSockets.size}, adminFound=${!!adminSock}`);
        });
      });
    });
  } else {
    io.in(roomId).allSockets().then(roomSockets => {
      console.log(`📡 Broadcast to ${roomId}: ${Object.keys(room.players).length} player(s), room=${roomSockets.size} (no hostId)`);
    });
  }
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
  
  // Initial exchange rates from shared country-utils
  const initialExchangeRates = INITIAL_EXCHANGE_RATES;
  
  // Initialize starting economic conditions for each country
  room.phase2.yearlyData[1946] = {};
  console.log(`\n🎯 INITIALIZING PHASE 2 FOR ROOM ${roomId}`);
  console.log(`   Players in room:`, Object.keys(room.players).length);
  
  Object.values(room.players).forEach(player => {
    const country = normalizeCountryName(player.country);

    const initialData = initialEconomicData[country] || initialEconomicData[player.country];

    if (!initialData) {
      console.error(`⚠️ No economic data found for country: ${country} (raw: ${player.country})`);
      console.log('Available countries in economicData:', Object.keys(initialEconomicData));
      return; // Skip this country
    }

    // Historical 1946 GDP growth rates (real, vs 1945)
    const initialGdpGrowth = {
      'USA': -11.6,      // Massive demobilization: war production halted, 12M soldiers returning
      'UK': -2.5,        // Exhausted by war, severe austerity, rationing continues
      'USSR': -2.0,      // War devastation recovery just beginning, 27M dead
      'France': 16.5,    // Rapid recovery from near-zero occupation-era output
      'China': -3.5,     // Civil war escalating between KMT and CCP
      'India': 1.2,      // Modest growth, pre-independence economic stirrings
      'Argentina': 8.3   // Post-war commodity export boom, Perón industrialization
    };

    room.phase2.yearlyData[1946][country] = {
      gdpGrowth: initialGdpGrowth[country] || 0,
      goldReserves: initialData.goldReserves || 1000,
      unemployment: getInitialUnemployment(country),
      tradeBalance: initialData.tradeBalance || 0,
      inflation: getInitialInflation(country),
      industrialOutput: initialData.industrialOutput || 100,
      exchangeRate: getInitialExchangeRate(country),
      exchangeRateChange: 0,
      military: {
        army: initialData.military?.army || 1000000,
        navy: initialData.military?.navy || 100000,
        airForce: initialData.military?.airForce || 50000,
        total: initialData.military?.total || 1150000
      }
    };
    
    console.log(`   ✅ Loaded ${country}: Industrial=${initialData.industrialOutput}, Military=${initialData.military?.total}`);
  });
  
  console.log(`\n📦 PHASE 2 DATA READY:`);
  console.log(`   yearlyData[1946] keys:`, Object.keys(room.phase2.yearlyData[1946]));
  console.log(`   yearlyData[1946] sample:`, JSON.stringify(room.phase2.yearlyData[1946], null, 2).substring(0, 400));
  console.log(`Phase 2 initialized for room ${roomId}: Post-war economic management begins (1946-1952)\n`);

  // Compute and cache Phase 1 outcomes so they're available throughout Phase 2
  const phase1Outcomes = getPhase1Outcomes(roomId);
  console.log(`   Phase 1 outcomes:`, JSON.stringify(phase1Outcomes));

  // Auto-apply occupation zones (treaty-mandated deployments, no cost)
  const occupationZones = {
    'USA': [{ region: 'Germany', troops: 200000, branch: 'army' }],
    'UK': [{ region: 'Germany', troops: 150000, branch: 'army' }],
    'France': [{ region: 'Germany', troops: 100000, branch: 'army' }],
    'USSR': [
      { region: 'Germany', troops: 300000, branch: 'army' },
      { region: 'Eastern Europe', troops: 500000, branch: 'army' }
    ]
  };

  if (!room.phase2.cumulativeDeployments) {
    room.phase2.cumulativeDeployments = {};
  }
  if (!room.phase2.deploymentHistory) {
    room.phase2.deploymentHistory = [];
  }
  if (!room.phase2.deployments) {
    room.phase2.deployments = [];
  }

  Object.values(room.players).forEach(player => {
    const country = normalizeCountryName(player.country);
    const zones = occupationZones[country];
    if (!zones) return;

    zones.forEach(zone => {
      const { region, troops, branch } = zone;
      if (!room.phase2.cumulativeDeployments[region]) {
        room.phase2.cumulativeDeployments[region] = {};
      }
      if (!room.phase2.cumulativeDeployments[region][country]) {
        room.phase2.cumulativeDeployments[region][country] = { army: 0, navy: 0, airForce: 0, total: 0 };
      }
      room.phase2.cumulativeDeployments[region][country][branch] += troops;
      room.phase2.cumulativeDeployments[region][country].total += troops;

      const record = {
        country,
        region,
        branch: branch.charAt(0).toUpperCase() + branch.slice(1),
        troops,
        year: 1946,
        timestamp: Date.now(),
        occupationZone: true
      };
      room.phase2.deploymentHistory.push(record);
      room.phase2.deployments.push(record);

      console.log(`   🏛️ Occupation zone: ${country} → ${region} (${troops.toLocaleString()} ${branch})`);
    });
  });

  // Check for 1946 crises at game start
  triggerCrisisIfNeeded(roomId, 1946);

  // Save all state (main state file + per-game Phase 2 file)
  saveState();
  saveGamePhase2State(roomId);
  saveGameStateSnapshot(roomId, 'phase_transition');
}

// Derive structured Phase 1 outcomes from roundHistory.
// Each of the 10 voting issues maps to a concrete world-state decision.
function getPhase1Outcomes(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return {};

  // Cache so we only compute once per room
  if (room.phase1Outcomes) return room.phase1Outcomes;

  const roundHistory = room.roundHistory || [];
  const outcomes = {};

  roundHistory.forEach(round => {
    const win = round.winningOption; // 'a', 'b', 'c', or 'd'
    if (!win) return;

    switch (round.round) {
      case 1: // Reserve Currency System
        // a = dollar (White Plan), b = Bancor (Keynes Plan), c = multiple reserve currencies
        outcomes.reserveCurrency = win === 'a' ? 'dollar' : win === 'b' ? 'bancor' : 'multiple';
        break;
      case 2: // Exchange Rate System
        // a = fixed rates pegged to dollar, b = adjustable pegs, c = national sovereignty
        outcomes.exchangeRateSystem = win === 'a' ? 'fixed' : win === 'b' ? 'adjustable' : 'sovereign';
        break;
      case 3: // Capital Controls
        // a = free capital movement, b = transitional controls, c = permanent controls
        outcomes.capitalControls = win === 'a' ? 'free' : win === 'b' ? 'transitional' : 'permanent';
        break;
      case 4: // IMF Voting Power
        // a = weighted by gold/GDP, b = major power quotas, c = more equal distribution
        outcomes.imfVotingPower = win === 'a' ? 'weighted' : win === 'b' ? 'majorPower' : 'equal';
        break;
      case 5: // Reconstruction Financing
        // a = World Bank with US conditions, b = unconditional grants, c = priority for devastated, d = include commodity exporters
        outcomes.reconstructionFinancing = win === 'a' ? 'worldBank' : win === 'b' ? 'unconditional' : win === 'c' ? 'devastated' : 'commodity';
        break;
      case 6: // Currency Stabilization
        // a = market-based, b = IMF stabilization loans, c = state currency controls
        outcomes.currencyStabilization = win === 'a' ? 'market' : win === 'b' ? 'imfLoans' : 'stateControls';
        break;
      case 7: // Trade Liberalization
        // a = free trade, b = imperial preferences, c = gradual tariff reduction
        outcomes.tradeLiberalization = win === 'a' ? 'freeTrade' : win === 'b' ? 'imperialPreference' : 'gradualReduction';
        break;
      case 8: // Gold Standard
        // a = fixed gold-dollar peg ($35/oz), b = flexible gold standard, c = abandon gold
        outcomes.goldStandard = win === 'a' ? 'fixedPeg' : win === 'b' ? 'flexible' : 'abandonGold';
        break;
      case 9: // Soviet Participation
        // a = full with conditions, b = no political strings, c = separate Eastern system
        outcomes.sovietParticipation = win === 'a' ? 'conditional' : win === 'b' ? 'unconditional' : 'separate';
        break;
      case 10: // Post-War Economic Order
        // a = US-led liberal order, b = multilateral cooperation, c = national sovereignty
        outcomes.postWarOrder = win === 'a' ? 'usLed' : win === 'b' ? 'multilateral' : 'sovereignty';
        break;
    }
  });

  room.phase1Outcomes = outcomes;
  return outcomes;
}

function calculateAgreementBonus(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return {};

  const bonus = {};
  const roundHistory = room.roundHistory || [];
  const outcomes = getPhase1Outcomes(roomId);

  // Analyze each country's alignment with the agreed world order
  Object.values(room.players).forEach(player => {
    const country = normalizeCountryName(player.country);
    let gdpBonus = 0;
    let tradeBonus = 0;
    let cooperationBonus = 0;

    roundHistory.forEach((round, idx) => {
      const playerVote = round.votes[player.userId];
      const winningOption = round.winningOption;

      if (!playerVote || !winningOption) return;

      // Voted with majority = cooperation benefit
      if (playerVote === winningOption) {
        cooperationBonus += 0.3;
      } else {
        cooperationBonus -= 0.1;
      }
    });

    // --- Outcome-specific bonuses for each country ---

    // Reserve Currency (Issue 1)
    if (outcomes.reserveCurrency === 'dollar') {
      if (country === 'USA') { gdpBonus += 0.5; tradeBonus += 300; }
    } else if (outcomes.reserveCurrency === 'bancor') {
      // UK/France benefit from Keynes Plan
      if (country === 'UK') { gdpBonus += 0.4; tradeBonus += 200; }
      if (country === 'France') { gdpBonus += 0.3; tradeBonus += 150; }
    } else if (outcomes.reserveCurrency === 'multiple') {
      // Diversified system - smaller nations benefit, USA loses advantage
      if (country !== 'USA') { gdpBonus += 0.2; tradeBonus += 100; }
    }

    // Trade Liberalization (Issue 7)
    if (outcomes.tradeLiberalization === 'freeTrade') {
      // Free trade benefits large exporters
      if (country === 'USA') { tradeBonus += 300; gdpBonus += 0.3; }
      if (country === 'UK') { tradeBonus += 200; }
    } else if (outcomes.tradeLiberalization === 'imperialPreference') {
      // Commonwealth nations benefit
      if (country === 'UK' || country === 'India') { tradeBonus += 250; gdpBonus += 0.2; }
    } else if (outcomes.tradeLiberalization === 'gradualReduction') {
      // Developing nations benefit from gradual approach
      if (country === 'Argentina' || country === 'France') { tradeBonus += 150; gdpBonus += 0.2; }
    }

    // Reconstruction Financing (Issue 5)
    if (outcomes.reconstructionFinancing === 'worldBank') {
      if (country === 'UK' || country === 'France') { gdpBonus += 0.3; }
    } else if (outcomes.reconstructionFinancing === 'unconditional') {
      if (country === 'USSR') { gdpBonus += 0.4; tradeBonus += 200; }
      if (country === 'UK' || country === 'India') { gdpBonus += 0.2; }
    } else if (outcomes.reconstructionFinancing === 'devastated') {
      if (country === 'France' || country === 'USSR') { gdpBonus += 0.5; tradeBonus += 200; }
    } else if (outcomes.reconstructionFinancing === 'commodity') {
      if (country === 'Argentina' || country === 'India') { gdpBonus += 0.4; tradeBonus += 200; }
    }

    // Gold Standard (Issue 8)
    if (outcomes.goldStandard === 'fixedPeg') {
      // Benefits gold holders
      if (country === 'USA') { gdpBonus += 0.3; }
    } else if (outcomes.goldStandard === 'flexible') {
      // Moderate benefit for all participants
      gdpBonus += 0.1;
    } else if (outcomes.goldStandard === 'abandonGold') {
      // More monetary freedom for developing nations
      if (country === 'China' || country === 'India' || country === 'Argentina') { gdpBonus += 0.3; }
      if (country === 'USA') { gdpBonus -= 0.3; } // Loses gold advantage
    }

    // IMF Voting Power (Issue 4)
    if (outcomes.imfVotingPower === 'weighted') {
      if (country === 'USA') { tradeBonus += 200; }
    } else if (outcomes.imfVotingPower === 'equal') {
      if (country === 'China' || country === 'India' || country === 'Argentina') { tradeBonus += 150; }
    }

    // Capital Controls (Issue 3)
    if (outcomes.capitalControls === 'free') {
      if (country === 'USA') { tradeBonus += 200; }
    } else if (outcomes.capitalControls === 'permanent') {
      if (country === 'USSR' || country === 'China') { gdpBonus += 0.2; }
    }

    // Soviet Participation (Issue 9)
    if (outcomes.sovietParticipation === 'unconditional') {
      if (country === 'USSR') { gdpBonus += 0.5; tradeBonus += 300; }
    } else if (outcomes.sovietParticipation === 'separate') {
      if (country === 'USSR') { gdpBonus -= 0.3; tradeBonus -= 200; }
    }

    // Store detailed bonuses
    bonus[country] = {
      gdpBonus: gdpBonus + cooperationBonus,
      tradeBonus: tradeBonus,
      description: `Bretton Woods alignment: ${cooperationBonus > 0 ? 'cooperative' : 'isolated'}`
    };
  });

  return bonus;
}

// Calculate exchange rate changes based on economic policies
function calculateExchangeRate(country, currentYear, policy, previousData, room) {
  const nc = normalizeCountryName(country);
  // USSR doesn't participate in Bretton Woods
  if (nc === 'USSR') {
    return { rate: null, change: 0, defendable: true };
  }

  // USA is the anchor currency
  if (nc === 'USA') {
    return { rate: 1.00, change: 0, defendable: true };
  }

  const previousRate = previousData.exchangeRate;
  let rateChange = 0;

  // 1. Inflation differential (vs USA)
  const usData = room.phase2.yearlyData[currentYear]?.['USA'];
  const usInflation = usData ? usData.inflation : 3.0;
  const countryInflation = previousData.inflation || 5.0;
  const inflationDiff = countryInflation - usInflation;
  rateChange += inflationDiff * 0.4; // Purchasing power parity effect
  
  // 2. Trade balance impact  
  const tradeBalance = previousData.tradeBalance || 0;
  if (tradeBalance < -300) {
    rateChange += Math.abs(tradeBalance) * 0.01; // Deficit weakens currency
  } else if (tradeBalance > 300) {
    rateChange -= tradeBalance * 0.005; // Surplus strengthens currency
  }
  
  // 3. Interest rate differential (if policy has interest rate)
  if (policy && policy.interestRate) {
    const usInterestRate = 2.5; // Fed rate
    const rateDiff = policy.interestRate - usInterestRate;
    rateChange -= rateDiff * 0.3; // Higher rates strengthen currency
  }
  
  // 4. Gold reserves (confidence factor)
  const goldReserves = previousData.goldReserves || 1000;
  if (goldReserves < 500) {
    rateChange += 4.0; // Low reserves = crisis risk
  } else if (goldReserves > 15000) {
    rateChange -= 1.0; // High reserves = confidence
  }
  
  // 5. Government deficit (if policy data available)
  if (policy && policy.governmentSpending) {
    const gdp = policy.gdp || 100000;
    const deficit = (policy.governmentSpending - (policy.taxRevenue || 0)) / gdp * 100;
    if (deficit > 5) {
      rateChange += deficit * 0.3; // Deficit spending weakens currency
    }
  }
  
  // Historical event triggers
  if (nc === 'UK' && currentYear === 1949) {
    // September 1949: Sterling crisis - forced devaluation
    rateChange -= 30.5; // $4.03 → $2.80 (for GBP, negative = devaluation)
    console.log(`🚨 HISTORICAL EVENT: UK Sterling Crisis 1949 - Forced 30% devaluation`);
  }

  if (nc === 'France' && currentYear === 1948) {
    // January 1948: Major franc devaluation
    rateChange += 79.9; // 119.11 → 214.39 francs per dollar
    console.log(`🚨 HISTORICAL EVENT: France 1948 Devaluation - 80% currency collapse`);
  }

  if (nc === 'France' && currentYear === 1949) {
    // 1949: Two more devaluations
    rateChange += 63.3; // 214 → 350 francs per dollar (combined)
    console.log(`🚨 HISTORICAL EVENT: France 1949 Devaluations - Currency crisis continues`);
  }

  if (nc === 'India' && currentYear === 1949) {
    // Adjust to sterling devaluation
    rateChange += 18.0; // ₹3.31 → ₹4.76 (follows pound)
    console.log(`📊 India adjusts to sterling devaluation`);
  }

  // Calculate new rate
  let newRate;
  if (nc === 'UK') {
    // GBP quoted as $/£ - devaluation means lower number
    newRate = previousRate * (1 + rateChange / 100);
  } else {
    // Most currencies quoted as local/$ - devaluation means higher number
    newRate = previousRate * (1 + rateChange / 100);
  }
  
  // Phase 1 exchange rate system affects band width and volatility
  const phase1 = getPhase1Outcomes(room.roomId || '');
  let bandWidth = 1; // Default Bretton Woods ±1% band
  if (phase1.exchangeRateSystem === 'adjustable') {
    bandWidth = 5; // Adjustable pegs allow ±5% before intervention
    rateChange *= 0.8; // More policy room = less forced pressure
  } else if (phase1.exchangeRateSystem === 'sovereign') {
    bandWidth = 15; // Near-floating rates
    rateChange *= 0.6; // Nations can manage their own rates more freely
  }
  // 'fixed' = default strict ±1% band

  // Gold standard vote affects gold reserve pressure
  if (phase1.goldStandard === 'abandonGold') {
    // Gold reserves matter less -- reduce the gold-reserve-driven rate pressure
    if (goldReserves < 500) {
      rateChange -= 2.0; // Offset half the crisis pressure applied above
    }
  } else if (phase1.goldStandard === 'flexible') {
    if (goldReserves < 500) {
      rateChange -= 1.0; // Slightly less pressure than strict peg
    }
  }

  // Bretton Woods constraint: band depends on Phase 1 exchange rate vote
  const defendable = Math.abs(rateChange) < (bandWidth * 2);

  if (Math.abs(rateChange) > bandWidth && Math.abs(rateChange) < (bandWidth * 2)) {
    console.log(`⚠️  ${country}: Exchange rate pressure (${rateChange.toFixed(1)}%) - intervention required`);
  }
  
  return {
    rate: Math.max(0.01, newRate), // Ensure positive
    change: rateChange,
    defendable: defendable
  };
}

// Trigger crisis events at the END of year turn (or mid-year via deployment)
// Can trigger multiple crises per year, with random chance per crisis
// Options:
//   deploymentTriggered: { country, region, troops } - if called from a deployment action
function triggerCrisisIfNeeded(roomId, year, options = {}) {
  const room = globalState.rooms[roomId];
  if (!room) return;

  const deploymentTriggered = options.deploymentTriggered || null;

  // Find ALL crisis events for this year that haven't been triggered yet
  // When triggered by deployment, also check crises from the CURRENT year onward (±1 year window)
  const availableCrises = crisisEventsData.crisisEvents.filter(event => {
    const alreadyTriggered = room.phase2.crises.history.find(h => h.id === event.id);
    if (alreadyTriggered) return false;
    // Already active
    if (Array.isArray(room.phase2.crises.active) && room.phase2.crises.active.find(a => a.id === event.id)) return false;

    if (deploymentTriggered && event.deploymentTrigger) {
      // Deployment-triggered: allow crises within ±1 year of their historical date
      return Math.abs(event.year - year) <= 1;
    }
    // Normal year-based: exact year match only
    return event.year === year;
  });

  if (availableCrises.length === 0) {
    if (!deploymentTriggered) console.log(`📅 No new crises available for year ${year}`);
    return;
  }

  console.log(`📅 Found ${availableCrises.length} potential crisis(es) for year ${year}${deploymentTriggered ? ` (deployment-triggered by ${deploymentTriggered.country} in ${deploymentTriggered.region})` : ''}`);

  // Get cumulative deployments for checking deployment triggers
  const cumulativeDeployments = room.phase2.cumulativeDeployments || {};

  const CRISIS_TRIGGER_CHANCE = 0.6; // Base random chance
  const triggeredCrises = [];

  for (const crisis of availableCrises) {
    let triggerChance = CRISIS_TRIGGER_CHANCE;
    let triggeredByDeployment = false;
    let triggerReason = null;

    // Check if this crisis has deployment trigger conditions
    if (crisis.deploymentTrigger) {
      const dt = crisis.deploymentTrigger;
      const regionDeployments = cumulativeDeployments[dt.region] || {};

      // Check if any of the required countries have deployed enough troops
      const matchingCountry = dt.requiredCountries.find(reqCountry => {
        const countryDeps = regionDeployments[reqCountry];
        if (!countryDeps) return false;
        return countryDeps.total >= dt.minTroops;
      });

      if (matchingCountry) {
        triggerChance = dt.triggerChance; // Use the crisis-specific higher chance
        triggeredByDeployment = true;
        triggerReason = dt.description || `${matchingCountry} deployed forces to ${dt.region}`;
        console.log(`   ⚡ ${crisis.title}: deployment condition MET (${matchingCountry} has ${regionDeployments[matchingCountry].total} troops in ${dt.region}, need ${dt.minTroops}) → chance boosted to ${triggerChance}`);
      }
    }

    // If this is a deployment-triggered call, only trigger crises whose deployment conditions are met
    if (deploymentTriggered && !triggeredByDeployment) {
      continue;
    }

    const roll = Math.random();
    const willTrigger = roll < triggerChance;

    console.log(`   🎲 ${crisis.title}: roll=${roll.toFixed(2)} vs ${triggerChance}${triggeredByDeployment ? ' (deployment-boosted)' : ''} → ${willTrigger ? 'TRIGGERED' : 'skipped'}`);

    if (willTrigger) {
      triggeredCrises.push({
        ...crisis,
        triggeredByDeployment,
        triggerReason
      });
    }
  }

  if (triggeredCrises.length === 0) {
    if (!deploymentTriggered) console.log(`📅 No crises triggered this year (all failed random check)`);
    return;
  }

  // Store all triggered crises as active (array instead of single object)
  if (!Array.isArray(room.phase2.crises.active)) {
    room.phase2.crises.active = [];
  }

  // Determine which countries have active players in this room
  const activePlayerCountries = new Set();
  Object.values(room.players).forEach(p => {
    if (p.country) {
      activePlayerCountries.add(p.country);
      const normalized = normalizeCountryName(p.country);
      if (normalized) activePlayerCountries.add(normalized);
    }
  });

  for (const crisis of triggeredCrises) {
    console.log(`🚨 Triggering crisis: ${crisis.title}${crisis.triggeredByDeployment ? ' [DEPLOYMENT-TRIGGERED]' : ''}`);
    if (crisis.triggerReason) {
      console.log(`   Reason: ${crisis.triggerReason}`);
    }

    // Filter affected countries and options to only include countries with active players
    const filteredAffected = crisis.affectedCountries.filter(c =>
      activePlayerCountries.has(c) || activePlayerCountries.has(normalizeCountryName(c))
    );
    const filteredOptions = {};
    Object.keys(crisis.options).forEach(c => {
      if (activePlayerCountries.has(c) || activePlayerCountries.has(normalizeCountryName(c))) {
        filteredOptions[c] = crisis.options[c];
      }
    });

    // Skip this crisis entirely if no active players are affected
    if (filteredAffected.length === 0) {
      console.log(`   ⏭️ Skipping "${crisis.title}" — no active players among affected countries`);
      continue;
    }

    room.phase2.crises.active.push({
      ...crisis,
      affectedCountries: filteredAffected,
      options: filteredOptions,
      triggeredAt: Date.now(),
      resolved: false,
      responses: {} // Track responses per crisis
    });

    console.log(`   Affected countries (active players only):`, filteredAffected);
    if (filteredAffected.length < crisis.affectedCountries.length) {
      const skipped = crisis.affectedCountries.filter(c => !filteredAffected.includes(c));
      console.log(`   Skipped (no player):`, skipped);
    }
  }

  console.log(`✋ ${triggeredCrises.length} crisis(es) active - waiting for player responses`);
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
  const phase1 = getPhase1Outcomes(roomId);
  
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
    const country = normalizeCountryName(player.country);
    const policy = policies[country];
    const prevData = prevYearData[country];
    
    if (!policy || !prevData) {
      // If no policy submitted or no previous data, use defaults with penalty
      const defaultData = prevData || {
        gdp: 100,
        gdpGrowth: 0,
        goldReserves: 1000,
        unemployment: 5,
        tradeBalance: 0,
        inflation: 5,
        industrialOutput: 100,
        military: { army: 500000, navy: 100000, airForce: 50000, total: 650000 }
      };
      tempResults[country] = {
        ...defaultData,
        gdpGrowth: -2.0,
        industrialOutput: (defaultData.industrialOutput || 100) * 0.98
      };
      return;
    }
    
    // Economic calculation model with DYNAMIC CROSS-COUNTRY EFFECTS
    const policyIsCommand = policy.isCommandEconomy || false;

    // Extract policy variables based on economy type
    let centralBankRate, exchangeRate, tariffRate;
    if (policyIsCommand) {
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
    let tradeBalance = prevData.tradeBalance;
    let industrialOutput = prevData.industrialOutput || 100;
    let inflation = prevData.inflation;
    let unemployment = prevData.unemployment;
    
    // === MILITARY ECONOMIC IMPACT (BRANCH-SPECIFIC) ===
    // Military spending as % of GDP
    const milSpending = militarySpending || 5;
    
    // Calculate actual cost based on branch composition (costs in $millions)
    // Army: $0.001M per soldier ($1000 per soldier - food, basic equipment)
    // Navy: $0.004M per sailor ($4000 per sailor - ships, fuel, maintenance)
    // Air Force: $0.006M per airman ($6000 per airman - planes, fuel, high-tech)
    const armyCost = armySize * 0.001;
    const navyCost = navySize * 0.004;
    const airForceCost = airForceSize * 0.006;
    const totalMilitaryCost = armyCost + navyCost + airForceCost;

    // Calculate effective military spending as % of GDP
    // GDP is in $millions, totalMilitaryCost is now also in $millions
    const gdp = getBaseGDP(country);
    const effectiveMilSpending = (totalMilitaryCost / gdp) * 100; // As percentage of GDP
    
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
      // Scale down impact since this runs for each country pair
      const theirTariffImpact = (otherPolicy.tariffRate - 15) * -3; // They block your exports
      tradeBalance += theirTariffImpact;
      
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
      // Specific rivalries (defined in shared/country-utils.js)
      const isRival = areRivals(country, otherCountry);
      
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

    // Your own tariff impact (applied once, not per country)
    // High tariffs protect domestic industry but reduce trade efficiency
    if (tariffRate > 15) {
      tradeBalance -= (tariffRate - 15) * 15; // High tariffs hurt imports/efficiency
    }

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

    // Phase 1 Trade Liberalization outcome affects tariff penalties
    if (phase1.tradeLiberalization === 'freeTrade') {
      // Free trade world: low tariffs rewarded more, high tariffs punished more
      if (tariffRate < 15) {
        tradeBalance += 200; // Free trade bonus for compliant nations
        gdpGrowth += 0.3;
      } else if (tariffRate > 30) {
        tradeBalance -= 300; // Punished for protectionism in a free-trade world
        gdpGrowth -= 0.3;
      }
    } else if (phase1.tradeLiberalization === 'imperialPreference') {
      // Imperial preference world: UK/India/Commonwealth benefit from protected blocs
      if (country === 'UK' || country === 'India') {
        tradeBalance += 150;
      }
      // Outsiders penalized
      if (country === 'USA' || country === 'Argentina') {
        tradeBalance -= 100;
      }
    }
    // 'gradualReduction': no extra modifier -- standard mechanics apply
    
    // === CAPITAL FLOWS ===
    // Phase 1 capital controls outcome affects capital flow magnitude
    const capitalFlowMultiplier = phase1.capitalControls === 'free' ? 1.5
      : phase1.capitalControls === 'permanent' ? 0.3
      : 1.0; // 'transitional' = baseline

    // High interest rates attract capital (helps balance of payments)
    if (centralBankRate > globalAvgInterestRate + 2) {
      tradeBalance += Math.round(500 * capitalFlowMultiplier); // Capital inflows
    } else if (centralBankRate < globalAvgInterestRate - 2) {
      tradeBalance -= Math.round(300 * capitalFlowMultiplier); // Capital outflows
    }
    
    // Bretton Woods agreement bonuses
    const bwBonus = agreementBonuses[country] || { gdpBonus: 0, tradeBonus: 0 };
    gdpGrowth += bwBonus.gdpBonus;
    tradeBalance += bwBonus.tradeBonus;
    
    // Country-specific modifiers
    if (isCommandEconomy(country, currentYear)) {
      // Command economy effects (USSR always, China from 1949)
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
      
      // Marshall Plan isolation (from 1948) -- severity depends on Soviet Participation vote
      if (currentYear >= 1948) {
        if (phase1.sovietParticipation === 'unconditional') {
          // World voted to include USSR without strings -- milder isolation
          gdpGrowth -= 0.2;
          tradeBalance -= 100;
        } else if (phase1.sovietParticipation === 'separate') {
          // World endorsed a separate Eastern system -- deeper isolation
          gdpGrowth -= 0.8;
          tradeBalance -= 400;
        } else {
          // 'conditional' (default/historical) -- moderate isolation
          gdpGrowth -= 0.5;
          tradeBalance -= 200;
        }
      }

      // USSR Superpower Advantages
      // Massive industrial base and resources
      gdpGrowth += 0.8; // Industrial recovery and resource extraction
      tradeBalance += 300; // Resource exports to Eastern bloc

      // Command economy can achieve rapid growth through mobilization
      if (policy.isCommandEconomy && (policy.planFulfillmentPriority || 70) > 70) {
        gdpGrowth += 0.5; // Centralized planning efficiency in reconstruction
        industrialOutput *= 1.03; // Heavy industry focus
      }
    }
    
    if (country === 'China') {
      // Chinese Civil War (1946-1949) - intensifying effects (reduced for balance)
      if (currentYear <= 1949) {
        const warIntensity = {
          1946: -0.5,  // War resumes after WWII
          1947: -0.8,  // Escalation
          1948: -1.2,  // Major battles
          1949: -1.5   // Final decisive campaigns
        };

        gdpGrowth += (warIntensity[currentYear] || -0.5); // Negative growth from civil war
        tradeBalance -= (currentYear - 1945) * 100; // Trade disruption (reduced)
      }

      // China's massive population = economic potential
      gdpGrowth += 0.3; // Large domestic market

      // Foreign aid (US aids Nationalists, USSR aids Communists)
      tradeBalance += 200; // Foreign support flowing in
      
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
          gdpGrowth += 0.5; // Mobilization (increased)
          inflation += 0.8; // Bottlenecks (reduced)
        }

        // Post-civil war recovery - peace dividend after 1950
        if (currentYear >= 1950) {
          gdpGrowth += 1.0; // Peace dividend - war is over!
          tradeBalance += 150; // Trade normalizing
        } else {
          gdpGrowth -= 0.5; // Still consolidating power in 1949
        }
      }

      // Communist China post-1950 rapid industrialization
      if (currentYear >= 1950 && policy.isCommandEconomy) {
        gdpGrowth += 0.8; // Soviet-style industrialization drive
        industrialOutput *= 1.04; // Building factories
      }
    }
    
    if (country === 'India' && currentYear >= 1947) {
      gdpGrowth += 1.0; // Independence boost
    }

    if (country === 'France') {
      // Reconstruction aid -- scale depends on Phase 1 Reconstruction Financing vote
      if (currentYear >= 1948) {
        if (phase1.reconstructionFinancing === 'worldBank') {
          // World Bank with US conditions -- France benefits from structured aid
          gdpGrowth += 1.2;
          tradeBalance += 400;
        } else if (phase1.reconstructionFinancing === 'devastated') {
          // Priority for most devastated -- France is a top recipient
          gdpGrowth += 1.5;
          tradeBalance += 500;
        } else if (phase1.reconstructionFinancing === 'unconditional') {
          // Unconditional grants -- decent but less targeted
          gdpGrowth += 1.0;
          tradeBalance += 350;
        } else {
          // 'commodity' -- aid goes elsewhere, France gets less
          gdpGrowth += 0.6;
          tradeBalance += 200;
        }
      }
      // Despite currency crises, rapid reconstruction
      gdpGrowth += 0.5; // Reconstruction momentum
    }

    if (country === 'UK') {
      // Reconstruction aid depends on Phase 1 vote
      if (currentYear >= 1948) {
        if (phase1.reconstructionFinancing === 'worldBank') {
          gdpGrowth += 0.6;
          tradeBalance += 250;
        } else if (phase1.reconstructionFinancing === 'unconditional') {
          // UK pushed for unconditional -- bigger benefit
          gdpGrowth += 0.9;
          tradeBalance += 350;
        } else if (phase1.reconstructionFinancing === 'devastated') {
          // UK less devastated than France/USSR -- less priority
          gdpGrowth += 0.4;
          tradeBalance += 150;
        } else {
          gdpGrowth += 0.5;
          tradeBalance += 200;
        }
      }
      // Commonwealth trade -- stronger if imperial preferences won
      if (phase1.tradeLiberalization === 'imperialPreference') {
        tradeBalance += 350; // Sterling area trade flourishes
      } else {
        tradeBalance += 200; // Sterling area trade
      }
    }

    if (country === 'USA') {
      // USA reserve currency bonus -- depends on Phase 1 Reserve Currency vote
      if (phase1.reserveCurrency === 'dollar') {
        tradeBalance += 400; // Dollar demand as sole reserve currency
      } else if (phase1.reserveCurrency === 'multiple') {
        tradeBalance += 150; // Partial reserve status, shared with others
      } else {
        // 'bancor' -- Keynes Plan won, USA loses reserve currency privilege
        tradeBalance += 50; // Still a major currency but no special privilege
      }
    }

    // === ARGENTINA SPECIAL MECHANICS ===
    if (country === 'Argentina') {
      // Commodity Export Power - Argentina dominates global food exports
      // Trade balance bonus based on global demand (post-war food shortages)
      if (currentYear <= 1950) {
        tradeBalance += 800; // Food export boom
        gdpGrowth += 0.8; // Agricultural prosperity
      } else {
        // Drought and declining terms of trade after 1950
        tradeBalance += 300;
      }

      // Third Position Bonus - Perón's "neither capitalism nor communism"
      // Get bonus when policies differ from both USA and USSR
      const usaPolicy = policies['USA'];
      const ussrPolicy = policies['USSR'];
      if (usaPolicy && ussrPolicy) {
        let thirdPositionScore = 0;

        // Check if tariff rate differs from both powers
        if (policy.tariffRate) {
          const usaTariff = usaPolicy.tariffRate || 10;
          const diffFromUSA = Math.abs(policy.tariffRate - usaTariff);
          const diffFromUSSR = policy.isCommandEconomy ? 0 : 20; // USSR has state trade monopoly
          if (diffFromUSA > 10 && diffFromUSSR > 10) {
            thirdPositionScore += 1;
          }
        }

        // Check exchange rate independence
        if (policy.exchangeRate && policy.exchangeRate !== 1.0) {
          thirdPositionScore += 1;
        }

        // Bonus for Third Position policies
        if (thirdPositionScore > 0) {
          gdpGrowth += thirdPositionScore * 0.3; // Economic sovereignty bonus
          // diplomaticPoints would be added elsewhere
        }
      }

      // Perón's Social Programs (Import Substitution Industrialization)
      // High government spending helps employment but causes inflation
      if (policy.governmentSpending && policy.governmentSpending > 30) {
        unemployment -= (policy.governmentSpending - 30) * 0.05; // Jobs from state programs
        // Inflation effect handled separately
      }

      // Industrial development bonus
      industrialOutput *= 1.02; // Growing industrial base under Perón

      // British debt leverage - UK owes Argentina from WWII
      if (currentYear <= 1948) {
        tradeBalance += 200; // Debt repayments flowing in
      }
    }

    // Random shock
    const randomShock = (Math.random() - 0.5) * 2;
    gdpGrowth += randomShock;
    
    // === INFLATION (affected by global conditions) ===
    
    // China civil war effect on inflation (agricultural disruption)
    if (country === 'China' && currentYear >= 1948 && currentYear <= 1949) {
      inflation += 3.0; // Severe shortages from agricultural collapse
    }

    // Argentina Peronist inflation effects
    if (country === 'Argentina') {
      // Perón's social programs and nationalization cause inflation
      if (policy.governmentSpending && policy.governmentSpending > 30) {
        inflation += (policy.governmentSpending - 30) * 0.15; // Deficit spending
      }
      // Post-1950 economic troubles
      if (currentYear >= 1951) {
        inflation += 2.0; // Drought and declining exports cause inflation
      }
      // IAPI (state trade monopoly) creates inefficiencies
      inflation += 1.0; // Structural inflation from interventionist policies
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
    
    // === INDUSTRIAL OUTPUT (final adjustments) ===
    industrialOutput *= (1 + gdpGrowth / 100);
    
    // === GOLD RESERVES ===
    let goldReserves = prevData.goldReserves;
    if (tradeBalance > 0) {
      goldReserves += tradeBalance * 0.01;
    } else {
      goldReserves += tradeBalance * 0.02; // Lose gold faster with deficits
    }
    goldReserves = Math.max(0, goldReserves);
    
    // Calculate exchange rate changes
    const exchangeRateResult = calculateExchangeRate(country, currentYear, policy, prevData, room);
    
    // Exchange rate affects trade competitiveness
    if (exchangeRateResult.change > 5) {
      // Weaker currency = better exports (already incorporated above, but add small additional effect)
      tradeBalance += exchangeRateResult.change * 5;
      gdpGrowth += exchangeRateResult.change * 0.05;
    } else if (exchangeRateResult.change < -5) {
      // Stronger currency = worse exports but lower inflation
      tradeBalance += exchangeRateResult.change * 5;
      inflation += exchangeRateResult.change * 0.1; // Negative change reduces inflation
    }
    
    // Devaluation increases import costs (inflation)
    if (exchangeRateResult.change > 10) {
      inflation += exchangeRateResult.change * 0.15;
    }
    
    // === DEPLOYMENT MAINTENANCE COSTS ===
    // Annual upkeep for all deployed troops (deducted from gold reserves and trade balance)
    const flatDeployments = flattenDeployments(room.phase2.cumulativeDeployments, currentYear);
    const countryDeployments = flatDeployments.filter(d => d.country === country);

    let totalMaintenanceCost = 0;
    countryDeployments.forEach(d => {
      const distFactor = getDeploymentDistanceFactor(country, d.region);
      const branchMult = d.branch === 'navy' ? 4.0 : d.branch === 'airForce' ? 6.0 : 1.0;
      // ~$500-$6000 per soldier per year depending on branch and distance
      const maintenance = d.troops * distFactor * 0.0005 * branchMult; // in $M
      totalMaintenanceCost += maintenance;
    });

    if (totalMaintenanceCost > 0) {
      // Maintenance hits gold reserves directly
      goldReserves -= totalMaintenanceCost;
      // Also drags on trade balance (supply shipments, logistics)
      tradeBalance -= totalMaintenanceCost * 0.3;
      // Overextension: more than 5 deployments hurts GDP
      if (countryDeployments.length > 5) {
        const overextensionPenalty = (countryDeployments.length - 5) * 0.2;
        gdpGrowth -= overextensionPenalty;
      }
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
      exchangeRate: Math.round(exchangeRateResult.rate * 100) / 100,
      exchangeRateChange: Math.round(exchangeRateResult.change * 10) / 10,
      militarySpending: milSpending,
      deploymentMaintenanceCost: Math.round(totalMaintenanceCost),
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
}

// Award Phase 2 points each year based on that year's economic performance.
// Called after calculateYearEconomics() so yearlyData[year] is populated.
// This gives a running total players can see during Phase 2.
function calculateYearlyPhase2Score(roomId, year) {
  const room = globalState.rooms[roomId];
  if (!room) return;

  if (!room.phase2.yearlyScores) room.phase2.yearlyScores = {};
  room.phase2.yearlyScores[year] = {};

  console.log(`📊 Scoring year ${year} for room ${roomId}`);

  Object.values(room.players).forEach(player => {
    const rawCountry = player.country;
    const country = normalizeCountryName(rawCountry);
    let data = room.phase2.yearlyData[year]?.[country];
    if (!data && rawCountry !== country) {
      data = room.phase2.yearlyData[year]?.[rawCountry];
    }
    if (!data) return;

    let yearScore = 0;

    // GDP Growth: 15 pts per % (good growth ~3-5% = 45-75 pts)
    yearScore += Math.round((data.gdpGrowth || 0) * 15);

    // Inflation control: 0-30 pts
    const inf = data.inflation || 0;
    if (inf < 3) yearScore += 30;
    else if (inf < 5) yearScore += 20;
    else if (inf < 10) yearScore += 10;
    else if (inf < 20) yearScore += 0;
    else yearScore -= 15; // hyperinflation penalty

    // Unemployment: 0-25 pts
    const unemp = data.unemployment || 0;
    if (unemp < 2) yearScore += 25;
    else if (unemp < 4) yearScore += 18;
    else if (unemp < 6) yearScore += 10;
    else if (unemp < 10) yearScore += 0;
    else yearScore -= 10; // mass unemployment penalty

    // Trade balance: up to 15 pts
    const tb = data.tradeBalance || 0;
    if (tb > 500) yearScore += 15;
    else if (tb > 100) yearScore += 10;
    else if (tb > 0) yearScore += 5;
    else if (tb < -500) yearScore -= 5;

    yearScore = Math.max(0, yearScore); // Floor at 0 for any single year

    room.phase2.yearlyScores[year][country] = yearScore;

    // Add to running total
    if (!room.scores) room.scores = {};
    room.scores[country] = (room.scores[country] || 0) + yearScore;

    console.log(`   ${country} year ${year}: +${yearScore} pts (total: ${room.scores[country]})`);
  });

  // Save updated phase2 running totals to DB
  savePlayerScoresToDB(roomId, 'phase2').catch(err => {
    console.error('⚠️ Failed to save yearly phase2 scores:', err);
  });
}

// Final Phase 2 bonus — awarded once at game end for overall performance.
// This is ON TOP of the yearly scores accumulated above.
function calculatePhase2Scores(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return;

  console.log(`\n📊 Calculating Phase 2 FINAL BONUS scores for room ${roomId}`);
  console.log(`   Players:`, Object.values(room.players).map(p => `${p.country} -> ${normalizeCountryName(p.country)}`));
  console.log(`   YearlyData years:`, Object.keys(room.phase2.yearlyData || {}));

  const phase2Scores = {};
  const scoreBreakdowns = {};

  Object.values(room.players).forEach(player => {
    const rawCountry = player.country;
    const country = normalizeCountryName(rawCountry);

    let score = 0;
    const breakdown = {
      gdp: 0,
      inflation: 0,
      unemployment: 0,
      trade: 0,
      stability: 0,
      brettonWoods: 0,
      crisisDiplomacy: 0,
      yearlyTotal: 0
    };

    // Tally the yearly scores already awarded
    let yearlyTotal = 0;
    for (let y = 1947; y <= 1952; y++) {
      yearlyTotal += room.phase2.yearlyScores?.[y]?.[country] || 0;
    }
    breakdown.yearlyTotal = yearlyTotal;

    // Calculate averages for end-game bonus
    let totalGDP = 0, totalInflation = 0, totalUnemployment = 0, yearsCount = 0;
    let positiveTradeYears = 0;

    for (let year = 1947; year <= 1952; year++) {
      let data = room.phase2.yearlyData[year]?.[country];
      if (!data && rawCountry !== country) {
        data = room.phase2.yearlyData[year]?.[rawCountry];
      }
      if (data) {
        totalGDP += data.gdpGrowth || 0;
        totalInflation += data.inflation || 0;
        totalUnemployment += data.unemployment || 0;
        if ((data.tradeBalance || 0) > 0) positiveTradeYears++;
        yearsCount++;
      }
    }

    console.log(`   ${country}: found data for ${yearsCount} years`);

    if (yearsCount > 0) {
      const avgGDP = totalGDP / yearsCount;
      const avgInflation = totalInflation / yearsCount;
      const avgUnemployment = totalUnemployment / yearsCount;

      // End-game GDP bonus: 8 pts per % average (e.g., 4% avg = 32 pts)
      breakdown.gdp = Math.round(avgGDP * 8);
      score += breakdown.gdp;

      // End-game inflation bonus
      if (avgInflation < 3) breakdown.inflation = 40;
      else if (avgInflation < 5) breakdown.inflation = 25;
      else if (avgInflation < 10) breakdown.inflation = 10;
      else if (avgInflation < 20) breakdown.inflation = 0;
      else breakdown.inflation = -20;
      score += breakdown.inflation;

      // End-game unemployment bonus
      if (avgUnemployment < 2) breakdown.unemployment = 30;
      else if (avgUnemployment < 4) breakdown.unemployment = 20;
      else if (avgUnemployment < 6) breakdown.unemployment = 10;
      else if (avgUnemployment < 10) breakdown.unemployment = 0;
      else breakdown.unemployment = -10;
      score += breakdown.unemployment;

      // Trade consistency bonus
      breakdown.trade = positiveTradeYears * 10;
      score += breakdown.trade;

      // Stability bonus (low GDP variance)
      let gdpVariance = 0;
      for (let year = 1947; year <= 1952; year++) {
        const data = room.phase2.yearlyData[year]?.[country];
        if (data) {
          gdpVariance += Math.abs(data.gdpGrowth - avgGDP);
        }
      }
      const avgVariance = gdpVariance / yearsCount;
      if (avgVariance < 1.5) breakdown.stability = 40;
      else if (avgVariance < 3) breakdown.stability = 20;
      else if (avgVariance < 5) breakdown.stability = 5;
      score += breakdown.stability;

      // Bretton Woods cooperation bonus
      const agreementBonuses = calculateAgreementBonus(roomId);
      const bwBonus = agreementBonuses[country];
      if (bwBonus) {
        breakdown.brettonWoods = Math.round((bwBonus.gdpBonus + bwBonus.tradeBonus / 100) * 8);
        score += breakdown.brettonWoods;
      }

      // Crisis diplomatic points
      if (room.phase2.diplomaticPoints && room.phase2.diplomaticPoints[country]) {
        breakdown.crisisDiplomacy = room.phase2.diplomaticPoints[country] * 3;
        score += breakdown.crisisDiplomacy;
      }
    }

    const finalScore = isNaN(score) ? 0 : Math.round(score);
    phase2Scores[country] = finalScore;
    scoreBreakdowns[country] = breakdown;

    // Add end-game bonus to running total
    if (!room.scores) room.scores = {};
    room.scores[country] = (room.scores[country] || 0) + finalScore;

    console.log(`   ${country}: End-game bonus=${finalScore}, Yearly total=${yearlyTotal}, Grand total=${room.scores[country]}`);
  });

  // Store breakdowns for display
  room.phase2.scoreBreakdowns = scoreBreakdowns;

  console.log(`📊 Final scores:`, room.scores);
  console.log(`Phase 2 end-game bonuses:`, phase2Scores);
  console.log(`Score breakdowns:`, scoreBreakdowns);

  // Save final phase2_score to players table in DB
  (async () => {
    for (const [userId, player] of Object.entries(room.players)) {
      const country = normalizeCountryName(player.country) || player.country;
      const totalP2 = (phase2Scores[country] || 0) +
        Object.values(room.phase2.yearlyScores || {}).reduce((sum, ys) => sum + (ys[country] || 0), 0);
      try {
        await queryDatabase('updatePlayerPoints', {
          gameCode: roomId,
          userId: userId,
          points: totalP2,
          phase: 'phase2'
        });
        console.log(`✅ phase2_score saved to DB: ${country} (user ${userId}) = ${totalP2}`);
      } catch (err) {
        console.error(`❌ Failed to save phase2_score for ${country}:`, err.message);
      }
    }
  })();

  return phase2Scores;
}

// --- Deployment cost helpers ---
// Base deployment costs per region (in $M, for 50K troops)
function getDeploymentBaseCost(region) {
  const costs = {
    'Western Europe': 100, 'Eastern Europe': 150, 'Germany': 80, 'Berlin': 200,
    'Greece & Turkey': 160, 'Iran': 180, 'Taiwan': 220, 'India': 120, 'Pakistan': 140,
    'Middle East': 180, 'Suez Canal': 150, 'Korea': 250, 'Indochina': 220,
    'East Asia': 200, 'Southeast Asia': 180, 'Pacific Islands': 150,
    'North America': 50, 'Central America': 100, 'South America': 120, 'Caribbean': 80,
    'North Africa': 140, 'Sub-Saharan Africa': 160,
    'Mediterranean': 130, 'Atlantic Ocean': 120, 'Pacific Ocean': 140,
    'Indian Ocean': 150, 'Central Asia': 140, 'Latin America': 120, 'Africa': 160
  };
  return costs[region] || 100;
}

// Distance factor: how far region is from country (1.0 = near, 2.0 = far)
function getDeploymentDistanceFactor(country, region) {
  const distanceMap = {
    'USA': {
      'Western Europe': 1.5, 'Eastern Europe': 2.0, 'Germany': 1.5, 'Berlin': 2.0,
      'Greece & Turkey': 1.7, 'Iran': 1.9, 'Taiwan': 1.7,
      'Middle East': 1.8, 'Suez Canal': 1.8, 'Korea': 1.8, 'Indochina': 1.8,
      'India': 1.9, 'Pakistan': 1.9, 'East Asia': 1.8, 'Southeast Asia': 1.7, 'Pacific Islands': 1.2,
      'North America': 1.0, 'Central America': 1.0, 'South America': 1.3, 'Caribbean': 1.0,
      'North Africa': 1.6, 'Sub-Saharan Africa': 1.7
    },
    'USSR': {
      'Western Europe': 1.2, 'Eastern Europe': 1.0, 'Germany': 1.1, 'Berlin': 1.1,
      'Greece & Turkey': 1.1, 'Iran': 1.0, 'Taiwan': 1.5,
      'Middle East': 1.2, 'Suez Canal': 1.4, 'Korea': 1.3, 'Indochina': 1.6,
      'India': 1.3, 'Pakistan': 1.2, 'East Asia': 1.3, 'Southeast Asia': 1.6, 'Pacific Islands': 1.8,
      'North America': 2.0, 'Central America': 2.0, 'South America': 2.0, 'Caribbean': 2.0,
      'North Africa': 1.5, 'Sub-Saharan Africa': 1.6
    },
    'UK': {
      'Western Europe': 1.0, 'Eastern Europe': 1.3, 'Germany': 1.0, 'Berlin': 1.2,
      'Greece & Turkey': 1.2, 'Iran': 1.4, 'Taiwan': 1.9,
      'Middle East': 1.3, 'Suez Canal': 1.2, 'Korea': 1.9, 'Indochina': 1.6,
      'India': 1.5, 'Pakistan': 1.5, 'East Asia': 1.9, 'Southeast Asia': 1.6, 'Pacific Islands': 1.9,
      'North America': 1.3, 'Central America': 1.5, 'South America': 1.6, 'Caribbean': 1.4,
      'North Africa': 1.1, 'Sub-Saharan Africa': 1.2
    },
    'France': {
      'Western Europe': 1.0, 'Eastern Europe': 1.4, 'Germany': 1.0, 'Berlin': 1.3,
      'Greece & Turkey': 1.3, 'Iran': 1.5, 'Taiwan': 2.0,
      'Middle East': 1.3, 'Suez Canal': 1.2, 'Korea': 2.0, 'Indochina': 1.5,
      'India': 1.7, 'Pakistan': 1.7, 'East Asia': 2.0, 'Southeast Asia': 1.5, 'Pacific Islands': 2.0,
      'North America': 1.5, 'Central America': 1.7, 'South America': 1.7, 'Caribbean': 1.6,
      'North Africa': 1.0, 'Sub-Saharan Africa': 1.1
    },
    'China': {
      'Western Europe': 2.0, 'Eastern Europe': 1.8, 'Germany': 2.0, 'Berlin': 2.0,
      'Greece & Turkey': 1.7, 'Iran': 1.5, 'Taiwan': 1.0,
      'Middle East': 1.6, 'Suez Canal': 1.8, 'Korea': 1.0, 'Indochina': 1.1,
      'India': 1.3, 'Pakistan': 1.4, 'East Asia': 1.0, 'Southeast Asia': 1.1, 'Pacific Islands': 1.4,
      'North America': 2.0, 'Central America': 2.0, 'South America': 2.0, 'Caribbean': 2.0,
      'North Africa': 1.9, 'Sub-Saharan Africa': 1.8
    },
    'India': {
      'Western Europe': 1.8, 'Eastern Europe': 1.9, 'Germany': 1.8, 'Berlin': 1.9,
      'Greece & Turkey': 1.5, 'Iran': 1.2, 'Taiwan': 1.5,
      'Middle East': 1.3, 'Suez Canal': 1.4, 'Korea': 1.6, 'Indochina': 1.2,
      'India': 1.0, 'Pakistan': 1.0, 'East Asia': 1.5, 'Southeast Asia': 1.2, 'Pacific Islands': 1.6,
      'North America': 2.0, 'Central America': 2.0, 'South America': 2.0, 'Caribbean': 2.0,
      'North Africa': 1.5, 'Sub-Saharan Africa': 1.4
    },
    'Argentina': {
      'Western Europe': 1.7, 'Eastern Europe': 2.0, 'Germany': 1.8, 'Berlin': 2.0,
      'Greece & Turkey': 1.9, 'Iran': 2.0, 'Taiwan': 2.0,
      'Middle East': 2.0, 'Suez Canal': 1.9, 'Korea': 2.0, 'Indochina': 2.0,
      'India': 2.0, 'Pakistan': 2.0, 'East Asia': 2.0, 'Southeast Asia': 2.0, 'Pacific Islands': 1.8,
      'North America': 1.3, 'Central America': 1.2, 'South America': 1.0, 'Caribbean': 1.2,
      'North Africa': 1.7, 'Sub-Saharan Africa': 1.6
    }
  };
  return distanceMap[country]?.[region] || 1.5;
}

// Convert cumulativeDeployments (server format) to flat array (deployment-impacts format)
function flattenDeployments(cumulativeDeployments, year) {
  const flat = [];
  if (!cumulativeDeployments) return flat;
  Object.entries(cumulativeDeployments).forEach(([region, countries]) => {
    Object.entries(countries).forEach(([country, forces]) => {
      // Create one entry per branch with troops > 0
      if (forces.army > 0) flat.push({ country, region, branch: 'army', troops: forces.army, year });
      if (forces.navy > 0) flat.push({ country, region, branch: 'navy', troops: forces.navy, year });
      if (forces.airForce > 0) flat.push({ country, region, branch: 'airForce', troops: forces.airForce, year });
    });
  });
  return flat;
}

// Helper function to resolve a specific crisis and apply effects
// If crisisId is not provided, resolves all active crises
function resolveCrisisEffects(roomId, crisisId = null) {
  const room = globalState.rooms[roomId];
  if (!room) return false;

  // Handle both old single-crisis format and new array format
  let activeCrises = room.phase2.crises.active;
  if (!activeCrises) return false;

  // Convert to array if it's the old format
  if (!Array.isArray(activeCrises)) {
    activeCrises = [activeCrises];
  }

  if (activeCrises.length === 0) return false;

  const currentYear = room.phase2.currentYear;
  const resolvedCrises = [];

  for (const crisis of activeCrises) {
    // If crisisId specified, only resolve that one
    if (crisisId && crisis.id !== crisisId) continue;

    const responses = crisis.responses || room.phase2.crises.responses || {};

    console.log(`=== RESOLVING CRISIS: ${crisis.title} ===`);

    // Apply each country's choice effects
    Object.entries(responses).forEach(([country, response]) => {
      const choice = response.choice;
      const effects = choice.effects || {};

      // Get or create year data for this country
      if (!room.phase2.yearlyData[currentYear]) {
        room.phase2.yearlyData[currentYear] = {};
      }
      if (!room.phase2.yearlyData[currentYear][country]) {
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

      // Apply diplomatic points
      if (effects.diplomaticPoints) {
        if (!room.phase2.diplomaticPoints) room.phase2.diplomaticPoints = {};
        room.phase2.diplomaticPoints[country] = (room.phase2.diplomaticPoints[country] || 0) + effects.diplomaticPoints;
      }

      console.log(`  ${country}: ${choice.text}`);
      if (Object.keys(effects).length > 0) {
        console.log(`    Effects:`, effects);
      }

      // Apply cross-country effects (this country's choice impacts other nations)
      // Only apply to countries that have active players (have year data)
      const crossEffects = choice.crossEffects || {};
      Object.entries(crossEffects).forEach(([targetCountry, targetEffects]) => {
        const normTarget = normalizeCountryName(targetCountry) || targetCountry;
        // Skip cross-effects for countries not in the game
        const hasPlayer = Object.values(room.players).some(p =>
          p.country === targetCountry || normalizeCountryName(p.country) === normTarget
        );
        if (!hasPlayer) {
          console.log(`    → Skipping cross-effect on ${normTarget} (no active player)`);
          return;
        }
        if (!room.phase2.yearlyData[currentYear][normTarget]) {
          const prevYear = currentYear - 1;
          room.phase2.yearlyData[currentYear][normTarget] = {
            ...room.phase2.yearlyData[prevYear]?.[normTarget]
          };
        }
        const targetData = room.phase2.yearlyData[currentYear][normTarget];
        if (targetEffects.gdpGrowth) targetData.gdpGrowth = (targetData.gdpGrowth || 0) + targetEffects.gdpGrowth;
        if (targetEffects.tradeBalance) targetData.tradeBalance = (targetData.tradeBalance || 0) + targetEffects.tradeBalance;
        if (targetEffects.inflation) targetData.inflation = (targetData.inflation || 0) + targetEffects.inflation;
        if (targetEffects.unemployment) targetData.unemployment = (targetData.unemployment || 0) + targetEffects.unemployment;
        if (targetEffects.diplomaticPoints) {
          if (!room.phase2.diplomaticPoints) room.phase2.diplomaticPoints = {};
          room.phase2.diplomaticPoints[normTarget] = (room.phase2.diplomaticPoints[normTarget] || 0) + targetEffects.diplomaticPoints;
        }
        console.log(`    → Cross-effect on ${normTarget}:`, targetEffects);
      });
    });

    // Move crisis to history
    room.phase2.crises.history.push({
      ...crisis,
      responses,
      resolvedAt: Date.now(),
      autoResolved: true
    });

    resolvedCrises.push(crisis.id);
    console.log(`✅ Crisis resolved - ${Object.keys(responses).length} countries responded`);
  }

  // Remove resolved crises from active list
  if (Array.isArray(room.phase2.crises.active)) {
    room.phase2.crises.active = room.phase2.crises.active.filter(c => !resolvedCrises.includes(c.id));
    if (room.phase2.crises.active.length === 0) {
      room.phase2.crises.active = [];
    }
  } else {
    room.phase2.crises.active = [];
  }

  // Clear old-style responses if using new format
  room.phase2.crises.responses = {};

  saveState();
  return resolvedCrises.length > 0;
}

// ============================================
// END PHASE 2 FUNCTIONS
// ============================================

// Socket connection
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Register new user
  socket.on('register', async ({ username, password, email }) => {
    if (!username || !password || !email) {
      socket.emit('registerResult', { success: false, message: 'Username, password, and email are required' });
      return;
    }

    // Only jjucovy@gmail.com is the super admin
    const isSuperAdmin = username.toLowerCase() === 'jjucovy@gmail.com' || username.toLowerCase() === 'jjucovy';
    const role = isSuperAdmin ? 'superadmin' : 'player';

    try {
      // Hash password before storing
      const hashedPassword = hashPassword(password);

      // Create user in database
      const result = await queryDatabase('createUser', {
        username: username,
        password: hashedPassword,
        role: isSuperAdmin ? 'teacher' : 'student',
        email: email,
        displayName: username
      });

      // PHP returns { exists: true, user_id } if already exists
      if (result?.exists && result?.user_id) {
        console.log(`User already exists: ${username}, user_id: ${result.user_id}`);
        socket.emit('registerResult', { success: false, message: 'Username already exists' });
        return;
      }

      // PHP INSERT returns { affected: 1 } without user_id
      // Fetch the newly created user to get their user_id
      let userId = result?.user_id || result?.id;
      if (!userId) {
        const dbUser = await queryDatabase('getUser', { username });
        userId = dbUser?.user_id;
      }

      if (!userId) {
        console.error('Registration failed - could not retrieve user_id after creation:', result);
        socket.emit('registerResult', { success: false, message: 'Registration failed - please try again' });
        return;
      }

      console.log(`User registered: ${username} (${role}), user_id: ${userId}`);

      socket.emit('registerResult', {
        success: true,
        userId: userId,
        username: username,
        role: role
      });
    } catch (err) {
      console.error('Registration error:', err);
      const message = err.message?.includes('exists') ? 'Username already exists' : 'Registration failed';
      socket.emit('registerResult', { success: false, message });
    }
  });
  
  // Login existing user
  socket.on('login', async ({ username, password }) => {
    console.log('=== LOGIN REQUEST ===');
    console.log('Username:', username);
    
    if (!username || !password) {
      socket.emit('loginResult', { success: false, message: 'Username and password required' });
      return;
    }
    
    try {
      // Query database for user by username
      const dbUser = await queryDatabase('getUser', { username });

      // Check for valid user with user_id (reject empty objects, null, undefined)
      if (!dbUser || !dbUser.user_id) {
        console.log('ERROR: User not found in database or missing user_id:', dbUser);
        socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
        return;
      }

      console.log('User found in database:', dbUser.username, 'user_id:', dbUser.user_id);

      // Verify password against stored hash
      const storedPassword = dbUser.password_hash || dbUser.password || '';
      if (!verifyPassword(password, storedPassword)) {
        console.log('ERROR: Password mismatch for user:', username);
        socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
        return;
      }

      const role = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1) ? 'superadmin' : 'player';
      console.log('Login successful, role:', role);
      
      // Get ALL active games for this player (multi-game support)
      let myActiveGames = [];
      if (role === 'player') {
        // Use getPlayerActiveGame action - may return one or more games
        const gameResult = await queryDatabase('getPlayerActiveGame', {
          userId: dbUser.user_id
        });

        console.log('getPlayerActiveGame result:', JSON.stringify(gameResult));

        // Handle both array and single object responses
        const games = Array.isArray(gameResult) ? gameResult : (gameResult ? [gameResult] : []);
        for (const game of games) {
          if (game && game.game_code) {
        
            const roomState = globalState.rooms[game.game_code];
            const isCompleted = game.status === 'completed' ||
              game.game_status === 'completed' ||
              (roomState && roomState.gamePhase === 'complete');

            if (isCompleted) {
              console.log(`⏭️ User's game ${game.game_code} is completed - skipping`);
            } else {
              
              myActiveGames.push({
                game_id: game.game_id,
                gameCode: game.game_code,
                country_id: game.country_id,
                country_code: game.country_code,
                status: game.status,
                playerCount: roomState ? Object.keys(roomState.players).length : 0,
                gamePhase: roomState ? roomState.gamePhase : (game.status || 'unknown'),
                currentRound: roomState ? roomState.currentRound : (game.current_round || 0),
                currentYear: roomState?.phase2?.currentYear || null
              });
              console.log(`✓ User has active game: ${game.game_code} as ${game.country_code}`);
            }
          }
        }
      }

      // Always get available lobby games for players (regardless of active games)
      let availableGames = [];
      if (role === 'player') {
        // Filter games that are in lobby phase and have room for new players
        const lobbyGames = Object.values(globalState.rooms).filter(room => {
          // Must be in lobby phase (not started)
          if (room.gamePhase !== 'lobby' || room.gameStarted) return false;
          // Must have room for new players (less than 7)
          const playerCount = Object.keys(room.players).length;
          if (playerCount >= 7) return false;
          return true;
        });
        availableGames = lobbyGames.map(room => ({
          roomId: room.roomId,
          gameCode: room.gameCode || room.roomId,
          playerCount: Object.keys(room.players).length,
          maxPlayers: 7,
          availableSlots: 7 - Object.keys(room.players).length,
          hostUserId: room.hostUserId || room.hostId,
          createdAt: room.createdAt
        }));
        console.log(`   Found ${availableGames.length} available lobby games for player`);
      }

      // Always send player to lobby - never auto-join
      socket.emit('loginResult', {
        success: true,
        username: username,
        role: role,
        userId: dbUser.user_id,
        activeGame: null,
        myActiveGames: myActiveGames,
        availableGames: availableGames
      });

      console.log(`User logged in: ${username} (${role})`);
      if (myActiveGames.length > 0) console.log(`  Active games: ${myActiveGames.length}`);
      if (availableGames.length > 0) console.log(`  Available lobby games: ${availableGames.length}`);
      console.log('====================');
    } catch (error) {
      console.error('Login error:', error);
      socket.emit('loginResult', { success: false, message: 'Server error during login' });
    }
  });
  
  // Create new room
  socket.on('createRoom', async ({ playerId, roomName, userId }) => {
    const roomId = roomName || `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const creatorId = userId || playerId; // Use userId if provided, otherwise playerId

    console.log(`📝 Creating room: ${roomId} for user ${creatorId}`);

    // Join the socket.io room immediately before any async operations
    socket.join(roomId);
    console.log(`🔌 socket.join: socket ${socket.id} → room ${roomId} (createRoom)`);

    // Check if creator is superadmin
    let isSuperAdmin = false;
    try {
      const dbUsers = await queryDatabase('getAllUsers', {});
      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === creatorId);
        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
          console.log(`   Creator ${dbUser.username} is superadmin: ${isSuperAdmin}`);
        }
      }
    } catch (err) {
      console.error('Error checking creator role:', err);
    }
    
    // Create room state - hostId is set to the creator's userId
    globalState.rooms[roomId] = createGameState(roomId, roomName || roomId, creatorId);
    globalState.rooms[roomId].hostUserId = creatorId; // Store the host's user ID
    globalState.rooms[roomId].hostIsSuperAdmin = isSuperAdmin;
    
    console.log(`   Room host set to userId: ${creatorId} (superadmin: ${isSuperAdmin})`);
    
    // If this looks like a game code (e.g., "game_123"), create it in the DB
    if (roomId.startsWith('game_')) {
      globalState.rooms[roomId].status = 'active';
      globalState.rooms[roomId].gameCode = roomId;

      try {
        const created = await queryDatabase('createNewGame', {
          gameCode: roomId,
          createdBy: creatorId,
        });
        console.log(`   createNewGame result:`, JSON.stringify(created));

        if (created) {
          const gameId = created.game_id ?? created.insertId;
          globalState.rooms[roomId].gameId = gameId;
          console.log(`✅ Game created in DB: game_id=${gameId} code=${roomId}`);
          await queryDatabase('updateGame', { game_id: gameId, status: 'active', current_round: 0 });
        } else {
          // INSERT may still have succeeded — verify via getGame
          const gameData = await queryDatabase('getGame', { gameCode: roomId });
          if (gameData && gameData.game_id) {
            globalState.rooms[roomId].gameId = gameData.game_id;
            console.log(`   Recovered game_id=${gameData.game_id} via getGame`);
            await queryDatabase('updateGame', { game_id: gameId, status: 'active', current_round: 0 });
          } else {
            console.error(`❌ Game ${roomId} not persisted to DB`);
          }
        }
      } catch (err) {
        console.error('Error persisting game to DB:', err);
      }
    }

    // Register creator as observer in global registry + dedicated Socket.IO room
    if (isSuperAdmin) {
      if (!observerRegistry[roomId]) observerRegistry[roomId] = {};
      observerRegistry[roomId][creatorId] = socket.id;
      socket.join(`observers:${roomId}`);
      console.log(`🔭 Registered superadmin ${creatorId} as observer of ${roomId} (socket ${socket.id})`);
    }

    socket.emit('roomCreated', {
      success: true,
      roomId: roomId,
      roomName: roomName || roomId,
      hostId: creatorId
    });

    broadcastRoomList();
    saveState();
    
    console.log(`✅ Room created: ${roomName || roomId} (${roomId}) by ${creatorId} as ${isSuperAdmin ? 'HOST (superadmin)' : 'player'}`);
  });
  
  // Join existing room
  socket.on('joinRoom', async ({ roomId, userId }) => {
    console.log(`📥 joinRoom request: roomId=${roomId}, userId=${userId}`);

    // Set userId on socket NOW so fetchSockets() can find this socket by userId
    // even during async DB calls below
    socket.userId = userId;

    // Join the socket.io room immediately before any async operations
    // so the socket is in the room even if async DB calls take time
    socket.join(roomId);
    console.log(`🔌 socket.join: socket ${socket.id} → room ${roomId}`);

    // If this user was a known observer, re-join the observer room and update
    // registry BEFORE any async DB calls, so broadcasts during the DB query reach them.
    if (observerRegistry[roomId] && userId in observerRegistry[roomId]) {
      observerRegistry[roomId][userId] = socket.id;
      socket.join(`observers:${roomId}`);
      console.log(`🔭 Fast-updated observer socket for ${userId}: ${socket.id} (rejoined observers:${roomId})`);
    }

    // If room not in memory, try to reconstruct from database + saved state
    if (!globalState.rooms[roomId]) {
      console.log(`⚠️ Room ${roomId} not in memory - attempting to load from database...`);

      try {
        // 1. Check if game exists in database
        const gameData = await queryDatabase('getGame', { gameCode: roomId });

        if (gameData && gameData.game_code) {
          console.log(`   ✅ Found game in database: game_id=${gameData.game_id}, status=${gameData.status}`);

          // 2. Create room state from database info
          const restoredRoom = createGameState(roomId, roomId, gameData.host_user_id);
          restoredRoom.gameId = gameData.game_id;
          restoredRoom.hostUserId = gameData.host_user_id;
          restoredRoom.gameStarted = gameData.status === 'active' || gameData.status === 'phase2';
          restoredRoom.gamePhase = gameData.status === 'phase2' ? 'phase2' : (gameData.status === 'active' ? 'phase1' : 'lobby');
          restoredRoom.currentRound = gameData.current_round || 0;

          // 3. Load players from database
          const dbPlayers = await queryDatabase('getPlayers', { gameCode: roomId });
          if (dbPlayers && Array.isArray(dbPlayers)) {
            dbPlayers.forEach(p => {
              const playerId = p.user_id || p.player_id;
              restoredRoom.players[playerId] = {
                id: playerId,
                userId: p.user_id,
                playerId: p.player_id,
                country: p.country_code || p.country_name,
                socketId: null,
                joinedAt: Date.now(),
                role: 'player',
                disconnected: true
              };
              console.log(`   ✅ Restored player: ${playerId} as ${p.country_code}`);
            });
          }

          // 4. Load Phase 2 state from saved file if it exists
          const gameStateFile = `/tmp/bretton-woods-phase2-${roomId}.json`;
          if (fs.existsSync(gameStateFile)) {
            try {
              const phase2Data = JSON.parse(fs.readFileSync(gameStateFile, 'utf8'));
              restoredRoom.phase2 = {
                ...restoredRoom.phase2,
                active: phase2Data.active !== undefined ? phase2Data.active : true,
                currentYear: phase2Data.currentYear || 1946,
                yearlyData: phase2Data.yearlyData || {},
                policies: phase2Data.policies || {},
                achievements: phase2Data.achievements || {},
                crises: phase2Data.crises || restoredRoom.phase2.crises
              };
              console.log(`   ✅ Restored Phase 2 state: year=${restoredRoom.phase2.currentYear}, active=${restoredRoom.phase2.active}`);
            } catch (err) {
              console.error(`   ❌ Error loading Phase 2 state file:`, err.message);
            }
          }

          // 5. Store in memory
          globalState.rooms[roomId] = restoredRoom;
          console.log(`   ✅ Room ${roomId} reconstructed in memory with ${Object.keys(restoredRoom.players).length} players`);
          saveState();
        } else {
          console.log(`❌ Game ${roomId} not found in database either`);
          socket.emit('joinRoomResult', { success: false, message: 'Room not found' });
          return;
        }
      } catch (err) {
        console.error(`❌ Error reconstructing room ${roomId}:`, err);
        socket.emit('joinRoomResult', { success: false, message: 'Room not found and could not be restored' });
        return;
      }
    }
    
    // Store userId on socket for later reference
    socket.userId = userId;

    const room = globalState.rooms[roomId];

    // Ensure we have the database game_id (not just Date.now() timestamp)
    if (roomId.startsWith('game_') && (!room.gameId || room.gameId > 1000000000000)) {
      // gameId looks like a timestamp, fetch the real one from database
      try {
        const gameData = await queryDatabase('getGame', { gameCode: roomId });
        if (gameData && gameData.game_id) {
          room.gameId = gameData.game_id;
          console.log(`   Updated gameId from database: ${gameData.game_id}`);
        }
      } catch (err) {
        console.error('Error fetching game_id on join:', err);
      }
    }

    // Debug: Log room host information
    console.log(`   Room host info: hostId=${room.hostId}, hostUserId=${room.hostUserId}, hostIsSuperAdmin=${room.hostIsSuperAdmin}, gameId=${room.gameId}`);
    
    // Check if user is superadmin
    let isSuperAdmin = false;
    let userRole = 'player';
    try {
      const dbUsers = await queryDatabase('getAllUsers', {});
      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === userId);
        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
          userRole = isSuperAdmin ? 'superadmin' : 'player';
          console.log(`   User ${dbUser.username} role: ${userRole}`);
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }

    // If userId provided, check if they have an active player assignment in this game
    if (userId) {
      console.log(`   Room has ${Object.keys(room.players).length} players`);
      console.log(`   Player keys:`, Object.keys(room.players));
      
      // SUPERADMIN: Join as host/observer, NOT as player
      if (isSuperAdmin) {
        // Check if this superadmin is the host
        // First check memory, then check database
        let isHost = room.hostUserId === userId || room.hostId === userId;
        
        // If not found in memory, check database
        if (!isHost && room.gameId) {
          try {
            const gameData = await queryDatabase('getGame', { game_id: room.gameId });
            if (gameData && gameData.host_user_id) {
              isHost = gameData.host_user_id === userId;
              // Update memory with host info
              room.hostUserId = gameData.host_user_id;
              console.log(`   Retrieved host_user_id from database: ${gameData.host_user_id}`);
            }
          } catch (err) {
            console.error('Error checking host from database:', err);
          }
        }
        
        console.log(`✅ Superadmin ${userId} joined room ${roomId} as ${isHost ? 'HOST' : 'OBSERVER'} (socket ${socket.id})`);
        console.log(`   Host check: room.hostUserId=${room.hostUserId}, room.hostId=${room.hostId}, userId=${userId}, isHost=${isHost}`);

        // Register observer socket in global registry AND a dedicated Socket.IO
        // observer room. The Socket.IO room is authoritative for delivery;
        // the registry is kept only for the log/count.
        if (!observerRegistry[roomId]) observerRegistry[roomId] = {};
        observerRegistry[roomId][userId] = socket.id;
        socket.join(`observers:${roomId}`);
        console.log(`🔭 Registered observer ${userId} in global registry + observers:${roomId} room (socket ${socket.id})`);

        socket.emit('joinRoomResult', {
          success: true,
          roomId: roomId,
          actualRoomId: roomId,
          role: 'superadmin',
          isHost: isHost
        });

        broadcastToRoom(roomId);
        console.log(`✅ Superadmin ${userId} joined room: ${roomId} (will observe only)`);
        return;
      }
      
      // REGULAR PLAYER: Try to find existing player record
      const existingPlayer = room.players[userId];
      
      console.log(`   Looking for userId ${userId}: found=${!!existingPlayer}`);
      
      if (existingPlayer) {
        // Player already in this game - update their socket ID for reconnection
        existingPlayer.socketId = socket.id;
        existingPlayer.disconnected = false;
        console.log(`✅ User ${userId} reconnected to game ${roomId} as ${existingPlayer.country}`);
        
        socket.emit('joinRoomResult', { 
          success: true, 
          roomId: roomId,
          actualRoomId: roomId,
          role: 'player',
          reconnected: true,
          country: existingPlayer.country
        });
      } else {
        // Player not found in memory - check database for existing assignment
        console.log(`   Player ${userId} not found in memory - checking database...`);

        let dbAssignment = null;
        try {
          dbAssignment = await queryDatabase('getPlayerAssignment', {
            user_id: parseInt(userId),
            game_id: parseInt(room.gameId)
          });
          console.log(`   getPlayerAssignment result:`, JSON.stringify(dbAssignment));
        } catch (err) {
          console.error('Error checking player assignment:', err);
        }

        if (dbAssignment && (dbAssignment.country_code || dbAssignment.country_name)) {
          // Player has an existing assignment in database - restore them
          const assignedCountry = dbAssignment.country_code || dbAssignment.country_name;
          console.log(`   ✓ Found player assignment in database: ${assignedCountry}`);

          // Add player back to room state
          room.players[userId] = {
            id: dbAssignment.player_id,
            userId: userId,
            playerId: dbAssignment.player_id,
            country: assignedCountry,
            socketId: socket.id,
            joinedAt: Date.now(),
            role: 'player',
            reconnected: true
          };

          socket.emit('joinRoomResult', {
            success: true,
            roomId: roomId,
            actualRoomId: roomId,
            role: 'player',
            reconnected: true,
            country: dbAssignment.country_code
          });

          broadcastToRoom(roomId);
          saveState();
          console.log(`✅ User ${userId} restored to game ${roomId} as ${dbAssignment.country_code} from database`);
        } else {
          // Player has no assignment - they need to select a country
          console.log(`   User ${userId} not found in player database - needs country selection`);

          socket.emit('joinRoomResult', {
            success: true,
            roomId: roomId,
            actualRoomId: roomId,
            role: 'player',
            needsCountrySelection: true
          });
        }
      }
    } else {
      socket.emit('joinRoomResult', { 
        success: true, 
        roomId: roomId,
        actualRoomId: roomId
      });
    }
    
    broadcastToRoom(roomId);
    console.log(`✅ User ${userId || 'guest'} joined room: ${roomId}`);
  });
  
  // Leave room
  socket.on('leaveRoom', ({ roomId }) => {
    socket.leave(roomId);
    socket.emit('leftRoom', { roomId });
    console.log(`Player left room: ${roomId}`);
  });
  
  // Delete room (host only)
  socket.on('deleteRoom', ({ roomId, playerId, playerid, userId }) => {
    // Support multiple parameter names
    const id = userId || playerId || playerid;

    const room = globalState.rooms[roomId];

    if (!room) {
      socket.emit('deleteRoomResult', { success: false, message: 'Room not found' });
      return;
    }

    // Check using hostUserId (which is always user_id)
    if (room.hostUserId !== id && room.hostId !== id) {
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
  socket.on('joinGame', async ({ roomId, userId, playerid, country }) => {
    // Support both userId (new) and playerid (legacy), fall back to socket.userId from joinRoom
    const id = userId || playerid || socket.userId;
    console.log(`🎮 Join game request: roomId=${roomId}, userId=${userId}, playerid=${playerid}, socket.userId=${socket.userId}, resolved id=${id}, country=${country}`);
    console.log(`   Available rooms:`, Object.keys(globalState.rooms));

    if (!id) {
      console.error(`❌ joinGame: No user ID available (userId=${userId}, playerid=${playerid}, socket.userId=${socket.userId})`);
      socket.emit('joinResult', { success: false, message: 'No user ID - please log in again' });
      return;
    }

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
    
    // Check if user is superadmin - they should NEVER join as a player
    let isSuperAdmin = false;
    try {
      const dbUsers = await queryDatabase('getAllUsers', {});
      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === id);
        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }
    
    if (isSuperAdmin) {
      console.log(`❌ Superadmin ${id} attempted to join as player - blocked`);
      socket.emit('joinResult', { 
        success: false, 
        message: 'Administrators cannot join as players. You are an observer only.' 
      });
      return;
    }
    
    // Check if country is already taken
    const taken = Object.values(room.players).some(p => p.country === country);
    
    if (taken) {
      console.log(`❌ Country ${country} already taken`);
      socket.emit('joinResult', { success: false, message: 'Country already taken' });
      return;
    }
    
    // Get or create player assignment in database
    let assignedPlayerId = null;
    try {
      // Check if user already has a player assignment in this game
      let existingAssignment = null;
      try {
        existingAssignment = await queryDatabase('getPlayerAssignment', {
          user_id: parseInt(id || userId),
          game_id: parseInt(room.gameId)
        });
      } catch (err) {
        // Not found is OK - we'll create one
        console.log(`   No existing assignment found (${err.message})`);
      }

      if (existingAssignment && existingAssignment.player_id) {
        assignedPlayerId = existingAssignment.player_id;
        console.log(`   User already has player_id ${assignedPlayerId} in this game`);
      } else {
        // Save player assignment to database
        const result = await queryDatabase('addPlayer', {
          gameCode: roomId,
          userId: id,
          countryCode: country
        });

        if (result?.player_id) {
          assignedPlayerId = result.player_id;
        } else {
          // PHP didn't return player_id — fetch it from DB so id is stable across restarts
          const fetched = await queryDatabase('getPlayerAssignment', {
            user_id: parseInt(id),
            game_id: parseInt(room.gameId)
          }).catch(() => null);
          assignedPlayerId = fetched?.player_id || `player_${Date.now()}`;
        }
        console.log(`   Created player assignment in database: userId=${id}, gameCode=${roomId}, country=${country}, player_id=${assignedPlayerId}`);
      }
    } catch (err) {
      console.error('Error managing player assignment:', err);
      // Fallback to generated player_id if database fails
      assignedPlayerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }
    
    // Store player with both id and userId for flexibility
    room.players[id] = {
      id: assignedPlayerId,
      userId: userId || id,
      playerId: assignedPlayerId,
      country: country,
      socketId: socket.id,
      joinedAt: Date.now(),
      role: 'player'
    };
    
    socket.emit('joinResult', { 
      success: true,
      playerId: assignedPlayerId,
      country: country
    });
    broadcastToRoom(roomId);
    broadcastRoomList();
    saveState();
    
    console.log(`✅ Player ${id} (player_id: ${assignedPlayerId}) joined as ${country} in room ${roomId}`);
  });
  
  // Rejoin game after disconnect/reconnect
  socket.on('rejoinGame', ({ roomId, playerid, country }) => {
    const room = globalState.rooms[roomId];
    
    if (!room) {
      socket.emit('rejoinResult', { success: false, message: 'Room not found' });
      return;
    }
    
    // Check if player was in this game with this country
    const existingPlayer = room.players[playerid];
    
    if (existingPlayer && existingPlayer.country === country) {
      // Player is rejoining their previous slot
      console.log(`✅ Player ${playerid} rejoining as ${country} in room ${roomId}`);

      // Join the socket room first so they receive the broadcast
      socket.join(roomId);

      // Update socket ID and clear disconnected flag
      existingPlayer.socketId = socket.id;
      existingPlayer.disconnected = false;
      delete existingPlayer.disconnectedAt;

      socket.emit('rejoinResult', { success: true, country: country });
      broadcastToRoom(roomId); // Now they'll receive this since they're in the room
      saveState();

      console.log(`Player ${playerid} reconnected to room ${roomId} as ${country}`);
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
  // Leave a completed game — releases player so they can join new games
  socket.on('leaveCompletedGame', async ({ roomId, userId }) => {
    console.log(`🚪 Player ${userId} leaving completed game ${roomId}`);
    const room = globalState.rooms[roomId];

    // Only allow leaving completed games
    if (room && room.gamePhase !== 'complete') {
      console.log(`   ❌ Game ${roomId} is not complete (phase: ${room.gamePhase}) - cannot leave`);
      return;
    }

    // Remove from socket room
    socket.leave(roomId);

    // Mark player as released in database so getPlayerActiveGame won't return this game
    if (room && room.gameId) {
      try {
        await queryDatabase('updateGame', {
          game_id: room.gameId,
          status: 'completed',
          game_status: 'completed'
        });
      } catch (err) {
        console.error(`   ❌ Failed to update game status in DB:`, err);
      }
    }

    console.log(`   ✅ Player ${userId} released from completed game ${roomId}`);
    socket.emit('leftRoom', { roomId });
  });

  socket.on('leaveGame', ({ roomId, userId, playerid }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const id = userId || playerid;  // Support both userId (new) and playerid (legacy)
    delete room.players[id];
    room.readyPlayers = room.readyPlayers.filter(pid => pid !== id);
    
    broadcastToRoom(roomId);
    broadcastRoomList();
    saveState();
    
    console.log(`Player ${id} left game in room ${roomId}`);
  });
  
  // Lightweight state request — superadmin polls every few seconds to stay in sync
  // without the full joinRoom async flow. Also refreshes room membership + registry.
  socket.on('requestState', ({ roomId, userId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;

    // Ensure socket is in the room for future push broadcasts
    socket.join(roomId);

    // Update observer registry so next broadcast reaches this socket
    if (userId && observerRegistry[roomId] && userId in observerRegistry[roomId]) {
      observerRegistry[roomId][userId] = socket.id;
    }

    socket.emit('stateUpdate', room);
  });

  // Set ready status
  socket.on('setReady', async ({ roomId, userId, playerid, ready }) => {
    const room = globalState.rooms[roomId];
    if (!room) {
      console.log(`❌ setReady: room ${roomId} not found`);
      return;
    }

    const socketUserId = userId || playerid;
    const player = room.players[socketUserId];
    const id = player?.id || socketUserId;

    console.log(`🔔 setReady: userId=${socketUserId}, player found=${!!player}, player.id=${player?.id}, ready=${ready}`);

    // Update ready flag directly on the player object so observers see it immediately
    if (player) {
      player.ready = !!ready;
    } else {
      console.log(`⚠️ setReady: player not found in room.players for userId=${socketUserId}`);
      console.log(`   room.players keys:`, Object.keys(room.players));
    }

    if (ready) {
      if (!room.readyPlayers.includes(id)) {
        room.readyPlayers.push(id);
      }
    } else {
      room.readyPlayers = room.readyPlayers.filter(pid => pid !== id);
    }

    // Log who's in the socket.io room
    const socketsInRoom = await io.in(roomId).allSockets();
    console.log(`📡 Broadcasting to ${socketsInRoom.size} socket(s) in room ${roomId}:`, [...socketsInRoom]);

    // Persist ready status to DB
    if (player?.id) {
      queryDatabase('updatePlayerReady', {
        player_id: player.id,
        is_ready: ready ? 1 : 0
      }).catch(err => console.error('Failed to persist ready status:', err.message));
    }

    broadcastToRoom(roomId);
    saveState();
  });
  
  // SUPERADMIN ONLY: Start game in room
  socket.on('startGame', async ({ roomId, playerId, playerid, userId, skipPhase1 }) => {
    // Support multiple parameter names - prefer userId, then playerId, then playerid
    const id = userId || playerId || playerid;

    console.log('=== START GAME REQUEST ===');
    console.log('Room ID:', roomId);
    console.log('User ID:', id);
    console.log('Skip Phase 1:', skipPhase1 || false);

    const room = globalState.rooms[roomId];
    if (!room) {
      console.log('ERROR: Room not found');
      socket.emit('startGameResult', { success: false, message: 'Room not found' });
      return;
    }

    // Check if user is superadmin by querying database using user_id
    let isSuperAdmin = false;

    try {
      // Query database to get user info
      const dbUsers = await queryDatabase('getAllUsers', {});

      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === id);

        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
          console.log('User found in DB:', {
            username: dbUser.username,
            user_id: dbUser.user_id,
            is_teacher: dbUser.is_teacher,
            isSuperAdmin
          });
        } else {
          console.log('User not found in database with user_id:', id);
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }

    // Check if user is the room host using hostUserId (which is always user_id)
    const isRoomHost = room.hostUserId === id || room.hostId === id;
    console.log('Is superadmin:', isSuperAdmin);
    console.log('Is room host:', isRoomHost, '| Checking id:', id, '| hostUserId:', room.hostUserId, '| hostId:', room.hostId);
    
    if (!isSuperAdmin && !isRoomHost) {
      console.log('ERROR: Not superadmin or room host');
      socket.emit('startGameResult', { 
        success: false, 
        message: 'Only the game admin can start games.' 
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
    saveGameToDatabase(roomId); // Save game state to database
    
    console.log(`Game started in room ${roomId} by admin`);
    console.log('=========================');
  });
  
  // Vote on current issue
  socket.on('vote', async ({ roomId, playerId, playerid, userId, choice }) => {
    // Support multiple parameter names - prefer userId, then playerId, then playerid
    const id = userId || playerId || playerid;

    const room = globalState.rooms[roomId];
    if (!room || !room.gameStarted) {
      console.log('Vote rejected: room not found or game not started');
      return;
    }

    // Check player is in game
    if (!room.players[id]) {
      console.log(`Vote rejected: player ${id} not in game. Players:`, Object.keys(room.players));
      return;
    }

    // Get the DB player_id (e.g. "36") — votes are keyed by this, not userId
    const playerDbId = room.players[id].id;

    // Check if player has already voted this round (prevent double-voting on tie revotes)
    if (room.votes[playerDbId]) {
      console.log(`Vote rejected: player ${id} (player_id=${playerDbId}) has already voted this round`);
      return;
    }

    // Store vote keyed by DB player_id
    room.votes[playerDbId] = choice;
    console.log(`Vote received: userId=${id} player_id=${playerDbId} voted ${choice} in room ${roomId}`);

    // Check if all players have voted
    const allVoted = Object.values(room.players).every(p => room.votes[p.id]);
    
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
      
      console.log('Vote tally:', voteTally);
      
      // Check for ties
      const voteValues = [voteTally.a, voteTally.b, voteTally.c];
      const maxVotes = Math.max(...voteValues);
      const optionsWithMaxVotes = ['a', 'b', 'c'].filter((opt, idx) => voteValues[idx] === maxVotes);
      
      const isTie = optionsWithMaxVotes.length > 1;
      
      // Initialize revote count if not exists
      if (!room.revoteCount) {
        room.revoteCount = 0;
      }
      
      // Handle tie situation
      if (isTie) {
        console.log(`🔄 TIE detected! Options ${optionsWithMaxVotes.join(', ')} all have ${maxVotes} votes`);
        
        if (room.revoteCount < 2) {
          // Allow revote (max 2 revotes = 3 total votes)
          room.revoteCount++;
          console.log(`Initiating revote ${room.revoteCount} of 2`);
          
          room.voteTally = voteTally;
          room.roundOutcome = `TIE! Revote ${room.revoteCount} of 2 required`;
          room.winningOption = null;
          room.isTie = true;
          room.tiedOptions = optionsWithMaxVotes;
          room.votes = {}; // Clear votes for revote
          room.gamePhase = 'voting'; // Stay in voting phase
          
          console.log(`Revote initiated. Votes cleared:`, Object.keys(room.votes).length === 0);
          console.log(`Room state: gamePhase=${room.gamePhase}, revoteCount=${room.revoteCount}`);
        } else {
          // Max revotes reached, no decision adopted
          console.log(`⚠️  Still tied after 2 revotes. No decision adopted for this issue.`);
          
          room.voteTally = voteTally;
          room.roundOutcome = `TIE after 3 votes - No decision adopted`;
          room.winningOption = null;
          room.isTie = true;
          room.noDecision = true;
          room.revoteCount = 0; // Reset for next round
          
          // Award base participation points only (no winner bonus)
          const roundScores = {};
          Object.entries(room.players).forEach(([id, player]) => {
            const country = normalizeCountryName(player.country) || player.country;
            const points = 10; // Only participation points
            roundScores[country] = points;
            room.scores[country] = (room.scores[country] || 0) + points;
          });
          
          room.roundScores = roundScores;
          room.gamePhase = 'results';

          // Load issue title and save individual votes for tie
          let tieIssueTitle = '';
          try {
            const gd = JSON.parse(fs.readFileSync(path.join(__dirname, 'game-data.json'), 'utf8'));
            const ci = gd.issues[room.currentRound - 1];
            if (ci) tieIssueTitle = ci.title;
          } catch (e) {}
          Object.entries(room.players).forEach(([id, player]) => {
            const vote = room.votes[player.id]?.toLowerCase();
            if (!vote) return;
            const country = normalizeCountryName(player.country) || player.country;
            queryDatabase('saveGameVote', {
              game_id: room.gameId,
              player_id: player.id,
              round_number: room.currentRound,
              issue_id: room.currentRound,
              issue_title: tieIssueTitle || `Issue ${room.currentRound}`,
              option_id: vote,
              option_text: `Option ${vote.toUpperCase()} (Tie - no decision)`,
              points_earned: roundScores[country] || 0
            }).catch(err => console.error('⚠️ Failed to save tie vote:', err));
          });

          // Send email notification for tie result
          const playerCount = Object.keys(room.players).length;
          sendAdminNotification(
            `Round ${room.currentRound} - Tie After Revotes`,
            `All ${playerCount} players have voted in Round ${room.currentRound}, but no decision was reached after 3 voting attempts.<br><br>
             <strong>Result:</strong> ${room.roundOutcome}<br>
             <strong>Final Vote Tally:</strong> A: ${voteTally.a}, B: ${voteTally.b}, C: ${voteTally.c}<br><br>
             Please log in to advance to the next round.`,
            roomId
          );

          // Save tie result to database
          try {
            const roundResultData = {
              gameCode: roomId,
              game_id: room.gameId,
              round: room.currentRound,
              phase: 1, // Phase 1 voting
              winningOptionId: 'TIE',
              winningOptionText: 'No decision adopted after 3 voting attempts',
              totalVotes: Object.keys(room.votes).length,
              results: {
                voteTally: voteTally,
                votes: room.votes,
                isTie: true,
                noDecision: true,
                timestamp: Date.now()
              }
            };
            queryDatabase('saveRoundResult', roundResultData).catch(err => {
              console.error('⚠️ Failed to save tie result to database:', err);
            });
            console.log(`✅ Round ${room.currentRound} tie result saved to database`);
            saveGameStateSnapshot(roomId, 'round_end');

            // Save phase1_score to players table
            savePlayerScoresToDB(roomId, 'phase1').catch(err => {
              console.error('⚠️ Failed to save phase1 scores after tie:', err);
            });
          } catch (err) {
            console.error('⚠️ Failed to save tie result to database:', err);
          }
        }
      } else {
        // Clear winner - no tie
        const winningOption = optionsWithMaxVotes[0];
        room.revoteCount = 0; // Reset revote count
        room.isTie = false;
        room.noDecision = false;
        
        console.log(`✅ Clear winner: Option ${winningOption.toUpperCase()} with ${maxVotes} votes`);
        
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
        Object.entries(room.players).forEach(([id, player]) => {
          const country = normalizeCountryName(player.country) || player.country;
          const vote = room.votes[player.id].toLowerCase();

          let points = 0;

          // Base points for participation
          points += 10;

          // Find the option they voted for
          const optionIndex = vote === 'a' ? 0 : vote === 'b' ? 1 : vote === 'c' ? 2 : 3;
          const votedOption = currentIssueOptions[optionIndex];

          if (votedOption) {
            // Bonus for voting for winning option
            if (vote === winningOption) {
              points += 20; // Voted with winning side
            }

            // Major bonus if the winning option favors your country
            const winIdx = winningOption === 'a' ? 0 : winningOption === 'b' ? 1 : winningOption === 'c' ? 2 : 3;
            const winningOptionData = currentIssueOptions[winIdx];
            if (winningOptionData && winningOptionData.favors && winningOptionData.favors.includes(country)) {
              points += 40; // Your country benefits from winning option
            }

            // Penalty if winning option opposes your country
            if (winningOptionData && winningOptionData.opposes && winningOptionData.opposes.includes(country)) {
              points -= 10; // Your country hurt by winning option
            }

            // Bonus for voting for option that favors you
            if (votedOption.favors && votedOption.favors.includes(country)) {
              points += 15; // Strategic vote for your interests
            }
          }

          roundScores[country] = points;
          room.scores[country] = (room.scores[country] || 0) + points;
        });

        // Store results
        room.voteTally = voteTally;
        room.roundScores = roundScores;
        room.gamePhase = 'results';

        // Save to round history for Phase 2 calculations
        let issueTitle = '';
        try {
          const gameDataContent = fs.readFileSync(gameDataPath, 'utf8');
          const gameData = JSON.parse(gameDataContent);
          const currentIssue = gameData.issues[room.currentRound - 1];
          if (currentIssue) {
            issueTitle = currentIssue.title;
          }
        } catch (err) {
          console.error('Error loading issue title:', err);
        }
        
        if (!room.roundHistory) {
          room.roundHistory = [];
        }

        room.roundHistory.push({
          round: room.currentRound,
          winningOption: winningOption,
          issueTitle: issueTitle,
          votes: { ...room.votes }, // Copy of all votes
          voteTally: { ...voteTally },
          timestamp: Date.now()
        });

        console.log(`Round ${room.currentRound} results:`, {
          voteTally,
          winningOption: room.roundOutcome
        });
        console.log(`✅ Saved to round history for Phase 2 calculations`);

        // Save individual votes to game_votes table
        Object.entries(room.players).forEach(([id, player]) => {
          const vote = room.votes[player.id]?.toLowerCase();
          if (!vote) return;
          const country = normalizeCountryName(player.country) || player.country;
          const optIdx = vote === 'a' ? 0 : vote === 'b' ? 1 : vote === 'c' ? 2 : 3;
          const optionData = currentIssueOptions[optIdx];
          queryDatabase('saveGameVote', {
            game_id: room.gameId,
            player_id: player.id,
            round_number: room.currentRound,
            issue_id: room.currentRound,
            issue_title: issueTitle || `Issue ${room.currentRound}`,
            option_id: vote,
            option_text: optionData?.text || `Option ${vote.toUpperCase()}`,
            points_earned: roundScores[country] || 0
          }).catch(err => console.error('⚠️ Failed to save vote:', err));
        });

        // Save round result to database
        try {
          const roundResultData = {
            gameCode: roomId,
            game_id: room.gameId,
            round: room.currentRound,
            phase: 1, // Phase 1 voting
            winningOptionId: winningOption,
            winningOptionText: currentIssueOptions[winningOption === 'a' ? 0 : winningOption === 'b' ? 1 : 2]?.text || '',
            totalVotes: Object.keys(room.votes).length,
            results: {
              voteTally: voteTally,
              votes: room.votes,
              issueTitle: issueTitle,
              roundScores: roundScores,
              totalScores: { ...room.scores },
              timestamp: Date.now()
            }
          };
          await queryDatabase('saveRoundResult', roundResultData);
          console.log(`✅ Round ${room.currentRound} result saved to database`);
          saveGameStateSnapshot(roomId, 'round_end');

          // Save phase1_score to players table
          await savePlayerScoresToDB(roomId, 'phase1');
        } catch (err) {
          console.error('⚠️ Failed to save round result to database:', err);
        }

        // Send email notification to superadmin that round is ready to advance
        const playerCount = Object.keys(room.players).length;
        sendAdminNotification(
          `Round ${room.currentRound} Voting Complete`,
          `All ${playerCount} players have voted in Round ${room.currentRound}.<br><br>
           <strong>Result:</strong> ${room.roundOutcome}<br>
           <strong>Vote Tally:</strong> A: ${voteTally.a}, B: ${voteTally.b}, C: ${voteTally.c}<br><br>
           Please log in to advance to the next round.`,
          roomId
        );
      }
    }

    broadcastToRoom(roomId);
    saveState();
  });
  
  // Advance to next round (admin only)
  socket.on('advanceRound', async ({ roomId, playerId, playerid, userId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;

    // Support multiple parameter names - prefer userId, then playerId, then playerid
    const id = userId || playerId || playerid;

    console.log('🔄 Advance round request:', { roomId, receivedId: id, hostUserId: room.hostUserId, hostId: room.hostId });

    // Check if user is superadmin by querying database using user_id
    let isSuperAdmin = false;

    try {
      // Query database to get user info by user_id
      const dbUsers = await queryDatabase('getAllUsers', {});

      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === id);

        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
          console.log('User found in DB:', {
            username: dbUser.username,
            user_id: dbUser.user_id,
            is_teacher: dbUser.is_teacher,
            isSuperAdmin
          });
        } else {
          console.log('User not found in database with user_id:', id);
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }

    // Check if user is the room host using hostUserId (which is always user_id)
    const isRoomHost = room.hostUserId === id || room.hostId === id;
    console.log('Permission check:', { isSuperAdmin, isRoomHost, checkingId: id, hostUserId: room.hostUserId, hostId: room.hostId });

    // Allow either superadmin OR room host to advance round
    if (!isSuperAdmin && !isRoomHost) {
      console.log('❌ Advance round rejected - not admin or host');
      socket.emit('advanceRoundError', {
        message: 'Only the game admin can advance the round.'
      });
      return;
    }
    
    // Advance round
    room.currentRound++;
    console.log(`✅ Advancing to round ${room.currentRound}`);
    
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
    saveGameToDatabase(roomId); // Save game state to database
  });
  
  // PHASE 2: Submit economic policy
  socket.on('submitPolicy', async ({ roomId, playerid, policy }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.phase2.active) return;

    const player = room.players[playerid];
    if (!player) return;

    const currentYear = room.phase2.currentYear;
    if (!room.phase2.policies[currentYear]) {
      room.phase2.policies[currentYear] = {};
    }

    // Prevent resubmission if player already submitted for this year
    const normalizedPolicyCountry = normalizeCountryName(player.country);
    if (room.phase2.policies[currentYear][normalizedPolicyCountry] && room.readyPlayers.includes(playerid)) {
      console.log(`⚠️ ${player.country} already submitted policy for ${currentYear}, rejecting duplicate`);
      socket.emit('policySubmitted', {
        success: false,
        country: player.country,
        year: currentYear,
        message: `Policy already submitted for ${currentYear}. Wait for the year to advance.`
      });
      return;
    }
    
    room.phase2.policies[currentYear][normalizeCountryName(player.country)] = policy.isCommandEconomy ? {
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
    
    console.log(`Player ${playerid} (${player.country}) submitted policy for ${currentYear}`);
    
    // Mark ready
    if (!room.readyPlayers.includes(playerid)) {
      room.readyPlayers.push(playerid);
    }
    
    // Save policy to database
    try {
      // Map game policy fields to PHP API expected fields
      const policyData = {
        gameId: room.gameId,
        userId: playerid,
        round: room.currentRound,
        year: currentYear,
        interestRate: policy.centralBankRate || 0,
        govtSpending: policy.militarySpending || 0,
        tradePolicy: policy.tariffRate > 20 ? 'protectionist' : policy.tariffRate > 10 ? 'moderate' : 'free_trade',
        currencyPolicy: policy.exchangeRate > 1.5 ? 'devalue' : policy.exchangeRate < 0.8 ? 'strengthen' : 'stable',
        policyFocus: policy.isCommandEconomy ? 'command_economy' : 'market_economy',
        rationale: `Military: ${policy.militarySpending}%, Army: ${policy.armySize || 0}, Navy: ${policy.navySize || 0}, Air: ${policy.airForceSize || 0}`,
        gdpChange: 0,
        inflationChange: 0,
        pointsEarned: 0
      };

      await queryDatabase('savePolicy', policyData);
      console.log(`✅ Policy saved to database for ${player.country}`);
    } catch (error) {
      console.error('⚠️ Failed to save policy to database:', error);
    }
    
    // Send confirmation to the player
    socket.emit('policySubmitted', {
      success: true,
      country: player.country,
      year: currentYear
    });
    
    // Check if all players have submitted policies
    const activePlayers = Object.keys(room.players).length;
    const readyCount = room.readyPlayers.length;
    
    console.log(`Policy submissions: ${readyCount}/${activePlayers} players ready`);

    // Auto-advance if all players submitted
    if (readyCount === activePlayers && activePlayers > 0) {
      console.log('🎯 All players have submitted policies!');

      // Wait a moment then check for conflicts or auto-advance
      setTimeout(async () => {
        try {
          // Re-fetch room in case state changed
          const currentRoom = globalState.rooms[roomId];
          if (!currentRoom || !currentRoom.phase2?.active) {
            console.log('⚠️ Room no longer active, skipping auto-advance');
            return;
          }

          // Check for pending conflict zones FIRST - trigger diplomatic phase before advancing
          // (Military conflicts take priority over economic crises)
          const pendingConflicts = currentRoom.phase2.pendingConflictZones || {};
          const conflictRegions = Object.keys(pendingConflicts);

          console.log(`🔍 Checking for pending conflicts...`);
          console.log(`   pendingConflictZones: ${JSON.stringify(pendingConflicts)}`);
          console.log(`   conflictRegions: ${conflictRegions.join(', ') || 'none'}`);

          if (conflictRegions.length > 0) {
            console.log(`⚔️ Found ${conflictRegions.length} pending conflict zone(s): ${conflictRegions.join(', ')}`);
            console.log('   Triggering diplomatic phase before year advance...');

            // Mark that we're waiting for diplomatic resolutions
            currentRoom.phase2.awaitingDiplomaticResolution = true;

            // Emit diplomatic stance requirement for each conflict zone
            conflictRegions.forEach(region => {
              const conflict = pendingConflicts[region];
              io.to(roomId).emit('diplomaticStanceRequired', {
                region,
                countries: conflict.countries,
                deployments: conflict.deployments,
                year: conflict.year,
                message: `Multiple nations have forces in ${region}. Declare your diplomatic stance toward each country.`
              });
              console.log(`   📢 Sent diplomaticStanceRequired for ${region} to: ${conflict.countries.join(', ')}`);
            });

            broadcastToRoom(roomId);
            saveState();
            return; // Don't advance year yet - wait for diplomatic phase to complete
          }

          // Check for crisis (only if no military conflicts)
          if (currentRoom.phase2.crises.active) {
            console.log('⚠️ Cannot auto-advance - active crisis must be resolved first');
            return;
          }

          const currentYear = currentRoom.phase2.currentYear;
          console.log(`🔍 Auto-advance check: currentYear=${currentYear}`);

          // Check if we're already at the end (1952)
          if (currentYear >= 1952) {
            // Don't calculate more economics, just finalize
            calculatePhase2Scores(roomId);
            currentRoom.gamePhase = 'complete';
            currentRoom.phase2.active = false;
            console.log('Phase 2 complete! Final scores calculated.');
            saveGameStateSnapshot(roomId, 'game_complete');

            broadcastToRoom(roomId);
            saveState();
            saveGamePhase2State(roomId);
            saveGameToDatabase(roomId); // Handles DB update with correct status
            return;
          }

          // Calculate economics
          calculateYearEconomics(roomId);

          // Advance year and round
          currentRoom.phase2.currentYear++;
          currentRoom.currentRound++; // Track Phase 2 progress in DB
          currentRoom.readyPlayers = [];

          // Score this year's economic performance
          calculateYearlyPhase2Score(roomId, currentRoom.phase2.currentYear);

          // Check for new crisis
          triggerCrisisIfNeeded(roomId, currentRoom.phase2.currentYear);

          console.log(`✅ Auto-advanced to year ${currentRoom.phase2.currentYear}`);
          saveGameStateSnapshot(roomId, 'year_end');

          // Check if we've reached the final year
          if (currentRoom.phase2.currentYear >= 1952) {
            console.log('Reached final year 1952. Next advance will complete Phase 2.');
          }

          broadcastToRoom(roomId);
          saveState();
          saveGamePhase2State(roomId);
          saveGameToDatabase(roomId); // Handles DB update
        } catch (err) {
          console.error('❌ Auto-advance failed:', err);
        }
      }, 2000); // Wait 2 seconds to let everyone see the "all submitted" message
    }

    broadcastToRoom(roomId);
    saveState();
    saveGamePhase2State(roomId);
    saveGameToDatabase(roomId);
  });

  // PHASE 2: Advance to next year
  // PLAYER: Deploy troops
  socket.on('deployTroops', ({ roomId, playerid, deployment }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;

    const player = room.players[playerid];
    if (!player) return;

    // Verify the deployment is for the player's own country
    if (deployment.country !== player.country) {
      console.log('Deploy troops rejected: country mismatch');
      return;
    }

    // Initialize cumulative deployments structure if doesn't exist
    // Structure: { regionName: { countryName: { army: X, navy: Y, airForce: Z, total: T } } }
    if (!room.phase2.cumulativeDeployments) {
      room.phase2.cumulativeDeployments = {};
    }

    // Initialize deployment history if doesn't exist
    if (!room.phase2.deploymentHistory) {
      room.phase2.deploymentHistory = [];
    }

    const region = deployment.region;
    const country = deployment.country;
    const branch = deployment.branch || 'Army';
    const troops = parseInt(deployment.troops) || 0;
    const currentYear = room.phase2.currentYear;
    const normalizedCountry = normalizeCountryName(country);

    // Deployment limit: max 2 deployments per country per year
    const MAX_DEPLOYMENTS_PER_YEAR = 2;
    if (!room.phase2.deploymentsThisYear) {
      room.phase2.deploymentsThisYear = {};
    }
    const countryDeploymentsThisYear = room.phase2.deploymentsThisYear[normalizedCountry] || 0;
    if (countryDeploymentsThisYear >= MAX_DEPLOYMENTS_PER_YEAR) {
      console.log(`Deploy troops rejected: ${country} already deployed ${countryDeploymentsThisYear} times this year (max ${MAX_DEPLOYMENTS_PER_YEAR})`);
      const playerSocket = io.sockets.sockets.get(player.socketId);
      if (playerSocket) {
        playerSocket.emit('deploymentRejected', {
          region,
          reason: `You have already deployed ${MAX_DEPLOYMENTS_PER_YEAR} times this year. Wait for the next year.`
        });
      }
      return;
    }

    // Year-gate checks
    if (region === 'Pakistan' && currentYear < 1947) {
      console.log(`Deploy troops rejected: Pakistan not available until 1947`);
      return;
    }
    if (region === 'Taiwan' && currentYear < 1949) {
      console.log(`Deploy troops rejected: Taiwan not a flashpoint until 1949`);
      return;
    }

    // Berlin requires presence in Germany first
    if (region === 'Berlin') {
      const germanyDeployments = room.phase2.cumulativeDeployments?.['Germany']?.[country];
      const occupationZones = {
        'USA': [{ region: 'Germany' }],
        'UK': [{ region: 'Germany' }],
        'France': [{ region: 'Germany' }],
        'USSR': [{ region: 'Germany' }]
      };
      const hasGermanyPresence = (germanyDeployments && germanyDeployments.total > 0) ||
        occupationZones[normalizedCountry]?.some(z => z.region === 'Germany');
      if (!hasGermanyPresence) {
        console.log(`Deploy troops rejected: ${country} needs Germany presence before deploying to Berlin`);
        const playerSocket = io.sockets.sockets.get(player.socketId);
        if (playerSocket) {
          playerSocket.emit('deploymentRejected', {
            region: 'Berlin',
            reason: 'You must have forces in Germany before deploying to Berlin'
          });
        }
        return;
      }
    }

    // Initialize region if doesn't exist
    if (!room.phase2.cumulativeDeployments[region]) {
      room.phase2.cumulativeDeployments[region] = {};
    }

    // Initialize country in region if doesn't exist
    if (!room.phase2.cumulativeDeployments[region][country]) {
      room.phase2.cumulativeDeployments[region][country] = {
        army: 0,
        navy: 0,
        airForce: 0,
        total: 0
      };
    }

    // Add to cumulative deployment (not replace)
    const branchKey = branch.toLowerCase().replace(' ', '');
    const branchMap = { 'army': 'army', 'navy': 'navy', 'airforce': 'airForce', 'air force': 'airForce' };
    const normalizedBranch = branchMap[branchKey] || 'army';

    room.phase2.cumulativeDeployments[region][country][normalizedBranch] += troops;
    room.phase2.cumulativeDeployments[region][country].total += troops;

    // Add to deployment history for record keeping
    const deploymentRecord = {
      ...deployment,
      branch: normalizedBranch === 'airForce' ? 'Air Force' : normalizedBranch.charAt(0).toUpperCase() + normalizedBranch.slice(1),
      timestamp: Date.now(),
      year: room.phase2.currentYear
    };
    room.phase2.deploymentHistory.push(deploymentRecord);

    // Sync deployments array (used by client for display)
    if (!room.phase2.deployments) room.phase2.deployments = [];
    room.phase2.deployments.push(deploymentRecord);

    // --- Deduct deployment cost from gold reserves ---
    const countryData = room.phase2.yearlyData[currentYear]?.[normalizedCountry];
    if (countryData) {
      const distanceFactor = getDeploymentDistanceFactor(normalizedCountry, region);
      const branchCostMultiplier = normalizedBranch === 'navy' ? 1.5 : normalizedBranch === 'airForce' ? 2.0 : 1.0;
      const baseCost = getDeploymentBaseCost(region);
      const deploymentCost = Math.round(baseCost * (troops / 50000) * branchCostMultiplier * distanceFactor);

      countryData.goldReserves = Math.max(0, (countryData.goldReserves || 0) - deploymentCost);

      console.log(`   💰 Cost: $${deploymentCost}M (base $${baseCost}M × ${(troops/50000).toFixed(1)} × ${branchCostMultiplier}x branch × ${distanceFactor}x distance)`);
      console.log(`   📦 ${normalizedCountry} gold reserves now: $${countryData.goldReserves}M`);

      // Notify the deploying player of the cost
      const playerSocket = io.sockets.sockets.get(player.socketId);
      if (playerSocket) {
        playerSocket.emit('deploymentCostNotification', {
          region,
          troops,
          branch: deploymentRecord.branch,
          cost: deploymentCost,
          goldRemaining: countryData.goldReserves,
          distanceFactor
        });
      }
    }

    // Track deployment count for this year
    room.phase2.deploymentsThisYear[normalizedCountry] = (room.phase2.deploymentsThisYear[normalizedCountry] || 0) + 1;
    console.log(`   📋 ${normalizedCountry} deployments this year: ${room.phase2.deploymentsThisYear[normalizedCountry]}/${MAX_DEPLOYMENTS_PER_YEAR}`);

    console.log(`✅ ${country} deployed ${troops} ${normalizedBranch} to ${region}`);
    console.log(`   Cumulative in ${region}: ${JSON.stringify(room.phase2.cumulativeDeployments[region][country])}`);

    // Check for potential conflicts but DON'T trigger battle yet
    // Store pending conflicts to be resolved after all policies submitted
    const countriesInRegion = Object.keys(room.phase2.cumulativeDeployments[region]);
    if (countriesInRegion.length > 1) {
      // Multiple countries in same region - mark as potential conflict zone
      if (!room.phase2.pendingConflictZones) {
        room.phase2.pendingConflictZones = {};
      }

      room.phase2.pendingConflictZones[region] = {
        countries: countriesInRegion,
        year: room.phase2.currentYear,
        deployments: room.phase2.cumulativeDeployments[region]
      };

      console.log(`⚠️ POTENTIAL CONFLICT: Multiple countries in ${region}: ${countriesInRegion.join(', ')}`);

      // Notify all players in the region about the tension (but no battle yet)
      io.to(roomId).emit('tensionAlert', {
        region: region,
        countries: countriesInRegion,
        message: `Military tension rising in ${region}! Multiple nations have forces deployed.`
      });
    }

    // Check if this deployment triggers a crisis event
    // Only check if there are no active crises (don't stack mid-turn)
    const activeCrises = room.phase2.crises?.active || [];
    if (activeCrises.length === 0) {
      triggerCrisisIfNeeded(roomId, room.phase2.currentYear, {
        deploymentTriggered: { country, region, troops }
      });
    }

    broadcastToRoom(roomId);
    saveState();
    saveGamePhase2State(roomId);
    saveGameToDatabase(roomId);
  });

  // Handle battle decisions
  socket.on('submitBattleDecision', ({ roomId, playerid, battleId, decision, region, year }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.phase2.active) return;
    
    const player = room.players[playerid];
    if (!player) return;
    
    const country = player.country;
    
    console.log(`🎖️ Battle decision from ${country}: ${decision} in ${region}`);
    
    // Store battle decision
    if (!room.phase2.battleDecisions) {
      room.phase2.battleDecisions = {};
    }
    
    if (!room.phase2.battleDecisions[battleId]) {
      room.phase2.battleDecisions[battleId] = {};
    }
    
    room.phase2.battleDecisions[battleId][country] = {
      decision,
      timestamp: Date.now()
    };
    
    // Find the conflict
    const conflict = room.phase2.conflicts?.find(c => c.battleId === battleId);
    if (!conflict) {
      console.log('Conflict not found for battleId:', battleId);
      return;
    }
    
    // Check if all countries have decided
    const allDecided = conflict.countries.every(c => 
      room.phase2.battleDecisions[battleId]?.[c]
    );
    
    if (allDecided) {
      console.log(`✅ All countries decided for battle ${battleId} - resolving...`);
      
      // Resolve battle
      const decisions = room.phase2.battleDecisions[battleId];
      const yearData = room.phase2.yearlyData[year];
      
      // Calculate battle outcome
      const battleResult = {
        region,
        year,
        participants: []
      };
      
      conflict.countries.forEach(country => {
        const countryData = yearData?.[country];
        const countryDecision = decisions[country].decision;
        
        if (!countryData) return;
        
        // Calculate combat power based on decision and military strength
        let combatPower = 0;
        const militaryStrength = countryData.military?.total || 0;
        const militarySpending = countryData.militarySpending || 5;
        
        if (countryDecision === 'fight') {
          combatPower = militaryStrength * (militarySpending / 10) * 1.0; // Full power
        } else if (countryDecision === 'withdraw') {
          combatPower = 0; // No combat
        } else if (countryDecision === 'negotiate') {
          combatPower = militaryStrength * (militarySpending / 10) * 0.3; // Reduced power
        }
        
        battleResult.participants.push({
          country,
          decision: countryDecision,
          combatPower,
          militaryStrength
        });
      });
      
      // Determine winner (highest combat power)
      const winner = battleResult.participants.reduce((max, p) => 
        p.combatPower > (max?.combatPower || 0) ? p : max
      , null);
      
      // Calculate casualties and effects
      battleResult.participants.forEach(p => {
        const isWinner = p.country === winner?.country;
        
        if (p.decision === 'withdraw') {
          p.casualties = Math.floor(p.militaryStrength * 0.05); // 5% casualties from retreat
          p.outcome = 'withdrew';
        } else if (p.decision === 'negotiate') {
          p.casualties = Math.floor(p.militaryStrength * 0.10); // 10% casualties
          p.outcome = isWinner ? 'diplomatic victory' : 'diplomatic defeat';
        } else { // fight
          if (isWinner) {
            p.casualties = Math.floor(p.militaryStrength * 0.15); // 15% casualties for winner
            p.outcome = 'military victory';
            p.territoryGained = region;
          } else {
            p.casualties = Math.floor(p.militaryStrength * 0.30); // 30% casualties for loser
            p.outcome = 'military defeat';
          }
        }
        
        // Apply casualties to year data
        if (yearData[p.country]?.military) {
          const casualties = p.casualties;
          yearData[p.country].military.army -= Math.floor(casualties * 0.6);
          yearData[p.country].military.navy -= Math.floor(casualties * 0.2);
          yearData[p.country].military.airForce -= Math.floor(casualties * 0.2);
          yearData[p.country].military.total = 
            yearData[p.country].military.army +
            yearData[p.country].military.navy +
            yearData[p.country].military.airForce;
          
          // Ensure no negative values
          yearData[p.country].military.army = Math.max(0, yearData[p.country].military.army);
          yearData[p.country].military.navy = Math.max(0, yearData[p.country].military.navy);
          yearData[p.country].military.airForce = Math.max(0, yearData[p.country].military.airForce);
        }
      });
      
      battleResult.winner = winner?.country;
      
      // Store battle result
      if (!room.phase2.battleResults) {
        room.phase2.battleResults = [];
      }
      room.phase2.battleResults.push(battleResult);
      
      console.log('Battle resolved:', battleResult);

      // Send results to players involved in the battle
      console.log('📋 Looking up players for battle results:', battleResult.participants.map(p => p.country));
      console.log('📋 Room players:', Object.entries(room.players).map(([id, p]) => `${id}: ${p.country} (socket: ${p.socketId || 'none'})`));

      let sentToAnySocket = false;
      battleResult.participants.forEach(participant => {
        const playerEntry = Object.entries(room.players).find(([id, p]) => {
          const match = p.country === participant.country ||
                        normalizeCountryName(p.country) === normalizeCountryName(participant.country);
          return match;
        });

        if (playerEntry) {
          const [playerId, playerData] = playerEntry;
          if (playerData.socketId) {
            io.to(playerData.socketId).emit('battleResolved', {
              battleId,
              result: battleResult
            });
            console.log(`📨 Sent battle result to ${participant.country} (socket: ${playerData.socketId})`);
            sentToAnySocket = true;
          }
        }
      });

      // Fallback: if no sockets were found (e.g., after server restart), broadcast to room
      if (!sentToAnySocket) {
        console.log(`⚠️ No valid sockets found - broadcasting battleResolved to entire room`);
        io.to(roomId).emit('battleResolved', {
          battleId,
          result: battleResult
        });
      }
    }

    broadcastToRoom(roomId);
    saveState();
    saveGamePhase2State(roomId);
    saveGameToDatabase(roomId);
  });

  // DIPLOMATIC STANCE: Submit stance for each country in conflict zone
  socket.on('submitDiplomaticStance', ({ roomId, playerid, region, stances }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.phase2?.active) return;

    const player = room.players[playerid];
    if (!player) return;

    const country = player.country;
    console.log(`🤝 Diplomatic stance from ${country} for ${region}:`, stances);

    // Initialize diplomatic stances storage
    if (!room.phase2.diplomaticStances) {
      room.phase2.diplomaticStances = {};
    }

    if (!room.phase2.diplomaticStances[region]) {
      room.phase2.diplomaticStances[region] = {};
    }

    // Store this country's stances toward others
    // stances = { "USA": "ally", "USSR": "enemy", "China": "neutral" }
    room.phase2.diplomaticStances[region][country] = {
      stances: stances,
      timestamp: Date.now()
    };

    // Check if all countries in this conflict zone have submitted stances
    const conflictZone = room.phase2.pendingConflictZones?.[region];
    if (conflictZone) {
      const allCountries = conflictZone.countries;
      const submittedCountries = Object.keys(room.phase2.diplomaticStances[region]);
      const allSubmitted = allCountries.every(c => submittedCountries.includes(c));

      console.log(`   Stances submitted: ${submittedCountries.length}/${allCountries.length}`);

      if (allSubmitted) {
        console.log(`✅ All diplomatic stances submitted for ${region} - proceeding to battle phase`);

        // Analyze stances to determine alliances and enemies
        const stanceAnalysis = analyzeDiplomaticStances(room.phase2.diplomaticStances[region], allCountries);

        // Create battle with stance information
        const battleId = `${region}-${room.phase2.currentYear}-${Date.now()}`;
        const conflict = {
          battleId,
          region,
          countries: allCountries,
          year: room.phase2.currentYear,
          stances: room.phase2.diplomaticStances[region],
          alliances: stanceAnalysis.alliances,
          enemies: stanceAnalysis.enemies,
          phase: 'battle_options', // Now waiting for attack/retreat/negotiate
          timestamp: Date.now()
        };

        if (!room.phase2.activeConflicts) {
          room.phase2.activeConflicts = [];
        }
        room.phase2.activeConflicts.push(conflict);

        // Notify all countries in the conflict to select battle options
        io.to(roomId).emit('battleOptionsRequired', {
          battleId,
          region,
          countries: allCountries,
          stances: room.phase2.diplomaticStances[region],
          alliances: stanceAnalysis.alliances,
          enemies: stanceAnalysis.enemies,
          deployments: conflictZone.deployments,
          message: `Diplomatic stances set in ${region}. Choose your military action.`
        });
      }
    }

    broadcastToRoom(roomId);
    saveState();
  });

  // Helper function to analyze diplomatic stances
  function analyzeDiplomaticStances(stances, countries) {
    const alliances = []; // Groups of allied countries
    const enemies = {}; // { "USA": ["USSR", "China"], "USSR": ["USA"] }

    countries.forEach(country => {
      enemies[country] = [];
      const countryStances = stances[country]?.stances || {};

      countries.forEach(otherCountry => {
        if (country === otherCountry) return;

        const stance = countryStances[otherCountry];
        if (stance === 'enemy') {
          enemies[country].push(otherCountry);
        }
      });
    });

    // Find mutual alliances (both countries mark each other as ally)
    const processedPairs = new Set();
    countries.forEach(country => {
      const countryStances = stances[country]?.stances || {};

      countries.forEach(otherCountry => {
        if (country === otherCountry) return;
        const pairKey = [country, otherCountry].sort().join('-');
        if (processedPairs.has(pairKey)) return;
        processedPairs.add(pairKey);

        const otherStances = stances[otherCountry]?.stances || {};
        if (countryStances[otherCountry] === 'ally' && otherStances[country] === 'ally') {
          // Mutual alliance - add to alliance groups
          let foundGroup = false;
          for (const group of alliances) {
            if (group.includes(country) || group.includes(otherCountry)) {
              if (!group.includes(country)) group.push(country);
              if (!group.includes(otherCountry)) group.push(otherCountry);
              foundGroup = true;
              break;
            }
          }
          if (!foundGroup) {
            alliances.push([country, otherCountry]);
          }
        }
      });
    });

    return { alliances, enemies };
  }

  // BATTLE OPTIONS: Submit attack/retreat/negotiate after stance selection
  socket.on('submitBattleOption', ({ roomId, playerid, battleId, option, region }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.phase2?.active) return;

    const player = room.players[playerid];
    if (!player) return;

    const country = player.country;
    console.log(`⚔️ Battle option from ${country}: ${option} in ${region}`);

    // Store battle option
    if (!room.phase2.battleOptions) {
      room.phase2.battleOptions = {};
    }

    if (!room.phase2.battleOptions[battleId]) {
      room.phase2.battleOptions[battleId] = {};
    }

    room.phase2.battleOptions[battleId][country] = {
      option, // 'attack', 'retreat', 'negotiate'
      timestamp: Date.now()
    };

    // Find the active conflict
    const conflict = room.phase2.activeConflicts?.find(c => c.battleId === battleId);
    if (!conflict) {
      console.log(`Conflict not found: ${battleId}`);
      return;
    }

    // Check if all countries have submitted options
    const allCountries = conflict.countries;
    const submittedCountries = Object.keys(room.phase2.battleOptions[battleId]);
    const allSubmitted = allCountries.every(c => submittedCountries.includes(c));

    console.log(`   Battle options submitted: ${submittedCountries.length}/${allCountries.length}`);

    if (allSubmitted) {
      console.log(`✅ All battle options submitted for ${battleId} - resolving battle`);
      resolveBattleWithStances(room, roomId, battleId, conflict);
    }

    broadcastToRoom(roomId);
    saveState();
  });

  // --- Battle Power Modifier Helpers ---

  // Country home coordinates for distance calculations (capital/center of gravity)
  const COUNTRY_HOME_COORDS = {
    'USA': { lat: 38.9, lng: -77.0 },       // Washington DC
    'UK': { lat: 51.5, lng: -0.1 },          // London
    'USSR': { lat: 55.8, lng: 37.6 },        // Moscow
    'France': { lat: 48.9, lng: 2.3 },       // Paris
    'China': { lat: 39.9, lng: 116.4 },      // Beijing/Nanjing
    'India': { lat: 28.6, lng: 77.2 },       // New Delhi
    'Argentina': { lat: -34.6, lng: -58.4 }  // Buenos Aires
  };

  // Region center coordinates for distance calc
  const BATTLE_REGION_COORDS = {
    'Eastern Europe': { lat: 52.2, lng: 21.0 },
    'Western Europe': { lat: 48.8, lng: 2.3 },
    'East Asia': { lat: 35.7, lng: 127.0 },
    'Southeast Asia': { lat: 13.8, lng: 100.5 },
    'Middle East': { lat: 31.5, lng: 34.8 },
    'Mediterranean': { lat: 37.0, lng: 15.0 },
    'Central Asia': { lat: 41.3, lng: 69.3 },
    'Latin America': { lat: -15.0, lng: -60.0 },
    'Africa': { lat: 0.0, lng: 25.0 },
    'Greece & Turkey': { lat: 39.0, lng: 27.0 },
    'Iran': { lat: 32.4, lng: 53.7 },
    'Taiwan': { lat: 23.7, lng: 121.0 },
    'Pakistan': { lat: 30.4, lng: 69.3 },
    'Berlin': { lat: 52.5, lng: 13.4 },
    'Germany': { lat: 51.2, lng: 10.4 },
    'Korea': { lat: 37.6, lng: 127.0 },
    'Suez Canal': { lat: 30.6, lng: 32.3 },
    'Indochina': { lat: 16.0, lng: 108.0 },
    'India': { lat: 22.0, lng: 78.9 },
    'Atlantic Ocean': { lat: 35.0, lng: -40.0 },
    'Pacific Ocean': { lat: 20.0, lng: -160.0 },
    'Indian Ocean': { lat: -10.0, lng: 70.0 }
  };

  // Haversine distance in km between two lat/lng points
  function haversineDistance(coord1, coord2) {
    const R = 6371; // Earth radius in km
    const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
    const dLng = (coord2.lng - coord1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(coord1.lat * Math.PI / 180) * Math.cos(coord2.lat * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // Calculate power multiplier for a country fighting in a region
  function getBattlePowerMultiplier(country, region, yearData) {
    const normalized = normalizeCountryName(country);
    const gdp = getBaseGDP(normalized);
    const countryEconData = yearData?.[normalized];

    // 1. GDP/Economic Power Factor (logarithmic scale to prevent total domination)
    //    USA $228B = 1.0 baseline, others scaled relative
    //    Using log scale: ln(gdp/14000) / ln(228000/14000) → 0.0 (Argentina) to 1.0 (USA)
    const gdpRatio = Math.log(gdp / 14000) / Math.log(228000 / 14000);
    const gdpMultiplier = 0.4 + (gdpRatio * 0.6); // Range: 0.4x to 1.0x

    // 2. Industrial Output Factor (better factories = better weapons/supply)
    //    Base 100 = 1.0x, higher output = better equipped
    const industrialOutput = countryEconData?.industrialOutput || 100;
    const industrialMultiplier = 0.6 + (Math.min(industrialOutput, 200) / 200) * 0.4; // 0.6x to 1.0x

    // 3. Distance/Power Projection Penalty
    //    Fighting far from home is harder - supply lines stretch, logistics cost more
    const homeCoords = COUNTRY_HOME_COORDS[normalized];
    const regionCoords = BATTLE_REGION_COORDS[region];
    let distanceMultiplier = 1.0;
    if (homeCoords && regionCoords) {
      const distKm = haversineDistance(homeCoords, regionCoords);
      // Under 2000km: no penalty (neighboring region)
      // 2000-5000km: mild penalty
      // 5000-10000km: moderate penalty
      // 10000+km: severe penalty
      if (distKm > 2000) {
        const penaltyFactor = Math.min((distKm - 2000) / 15000, 0.4); // Max 40% penalty
        distanceMultiplier = 1.0 - penaltyFactor;
      }
    }

    // 4. Naval Projection Requirement
    //    Overseas battles (ocean regions or far-flung theaters) need naval support
    const overseasRegions = ['Pacific Ocean', 'Atlantic Ocean', 'Indian Ocean',
      'East Asia', 'Southeast Asia', 'Taiwan', 'Korea', 'Indochina'];
    const needsNaval = overseasRegions.includes(region);
    let navalMultiplier = 1.0;
    if (needsNaval) {
      const navy = countryEconData?.military?.navy || 0;
      // Need significant navy for overseas power projection
      // 200k+ navy = full effectiveness, less = degraded
      navalMultiplier = Math.min(1.0, 0.3 + (navy / 200000) * 0.7);
    }

    const totalMultiplier = gdpMultiplier * industrialMultiplier * distanceMultiplier * navalMultiplier;

    return {
      total: totalMultiplier,
      gdp: gdpMultiplier,
      industrial: industrialMultiplier,
      distance: distanceMultiplier,
      naval: navalMultiplier,
      details: {
        gdpBillions: Math.round(gdp / 1000),
        industrialOutput,
        distanceKm: homeCoords && regionCoords ? Math.round(haversineDistance(homeCoords, regionCoords)) : 0,
        needsNaval
      }
    };
  }

  // Resolve battle with diplomatic stances and battle options
  function resolveBattleWithStances(room, roomId, battleId, conflict) {
    const options = room.phase2.battleOptions[battleId];
    const stances = conflict.stances;
    const deployments = room.phase2.cumulativeDeployments[conflict.region] || {};
    const yearData = room.phase2.yearlyData[conflict.year];

    const battleResult = {
      battleId,
      region: conflict.region,
      year: conflict.year,
      alliances: conflict.alliances,
      participants: []
    };

    // Calculate combat power for each country/alliance
    conflict.countries.forEach(country => {
      const countryDeployment = deployments[country] || { total: 0 };
      const countryOption = options[country]?.option || 'retreat';
      const countryData = yearData?.[country];

      // Calculate base combat power from deployed troops
      let combatPower = countryDeployment.total;

      // Apply power multipliers (GDP, industry, distance, naval)
      const powerMod = getBattlePowerMultiplier(country, conflict.region, yearData);
      combatPower *= powerMod.total;

      console.log(`   ⚔️ ${country} power modifiers: GDP=${powerMod.gdp.toFixed(2)} Industry=${powerMod.industrial.toFixed(2)} Distance=${powerMod.distance.toFixed(2)} Naval=${powerMod.naval.toFixed(2)} → ${powerMod.total.toFixed(2)}x (${countryDeployment.total} troops → ${Math.round(combatPower)} effective)`);

      // Add allied power (also modified by ally's own multiplier)
      const countryStances = stances[country]?.stances || {};
      conflict.countries.forEach(otherCountry => {
        if (country === otherCountry) return;
        const otherStances = stances[otherCountry]?.stances || {};
        // Mutual alliance provides combat bonus
        if (countryStances[otherCountry] === 'ally' && otherStances[country] === 'ally') {
          const otherDeployment = deployments[otherCountry] || { total: 0 };
          const otherPowerMod = getBattlePowerMultiplier(otherCountry, conflict.region, yearData);
          combatPower += otherDeployment.total * otherPowerMod.total * 0.3; // 30% of ally's modified power
        }
      });

      // Modify by battle option
      if (countryOption === 'attack') {
        combatPower *= 1.0; // Full power
      } else if (countryOption === 'negotiate') {
        combatPower *= 0.4; // Reduced power but lower casualties
      } else { // retreat
        combatPower = 0; // No combat
      }

      battleResult.participants.push({
        country,
        option: countryOption,
        deployedTroops: countryDeployment.total,
        combatPower: Math.round(combatPower),
        powerModifiers: powerMod,
        stances: countryStances
      });
    });

    // Determine outcomes
    const attackers = battleResult.participants.filter(p => p.option === 'attack');
    const negotiators = battleResult.participants.filter(p => p.option === 'negotiate');
    const retreaters = battleResult.participants.filter(p => p.option === 'retreat');

    // If everyone retreats or negotiates, no battle
    if (attackers.length === 0) {
      battleResult.outcome = 'standoff';
      battleResult.participants.forEach(p => {
        p.outcome = p.option === 'retreat' ? 'withdrew safely' : 'diplomatic resolution';
        p.casualties = 0;
      });
    } else {
      // Calculate battle with power-asymmetric casualties
      const totalAttackPower = attackers.reduce((sum, p) => sum + p.combatPower, 0);
      const maxAttackPower = Math.max(...attackers.map(a => a.combatPower));

      battleResult.participants.forEach(p => {
        const isAttacker = p.option === 'attack';
        const isRetreater = p.option === 'retreat';

        if (isRetreater) {
          // Retreaters take some casualties from attackers
          const casualtyRate = attackers.length > 0 ? 0.1 : 0;
          p.casualties = Math.floor(p.deployedTroops * casualtyRate);
          p.outcome = 'withdrew under fire';
        } else if (isAttacker) {
          // Power ratio determines casualty asymmetry
          // If you're 3x stronger, you take fewer casualties; if weaker, you take more
          const isTopAttacker = p.combatPower >= maxAttackPower;
          const otherMaxPower = Math.max(1, ...attackers.filter(a => a.country !== p.country).map(a => a.combatPower));
          const powerRatio = p.combatPower / Math.max(1, otherMaxPower);

          if (isTopAttacker && attackers.length === 1) {
            // Unopposed attack — minimal casualties
            p.casualties = Math.floor(p.deployedTroops * 0.05);
            p.outcome = 'military victory';
            battleResult.winner = p.country;
          } else if (isTopAttacker) {
            // Won the battle — casualties scale inversely with power advantage
            // 1:1 power = 15% casualties, 3:1 = 8%, 5:1+ = 5%
            const winnerCasualtyRate = Math.max(0.05, 0.15 / Math.max(1, powerRatio));
            p.casualties = Math.floor(p.deployedTroops * winnerCasualtyRate);
            p.outcome = powerRatio >= 3 ? 'decisive victory' : 'contested victory';
            battleResult.winner = p.country;
          } else {
            // Lost — casualties scale with how outmatched you are
            // 1:1 power = 20%, 1:3 = 30%, 1:5+ = 40%
            const loserCasualtyRate = Math.min(0.40, 0.20 + (1 / Math.max(1, powerRatio)) * 0.05);
            p.casualties = Math.floor(p.deployedTroops * loserCasualtyRate);
            p.outcome = powerRatio < 0.33 ? 'crushing defeat' : 'military defeat';
          }
        } else { // negotiate
          p.casualties = Math.floor(p.deployedTroops * 0.05);
          p.outcome = 'held position through diplomacy';
        }

        // Apply casualties to cumulative deployments
        if (p.casualties > 0 && deployments[p.country]) {
          const totalBefore = deployments[p.country].total;
          deployments[p.country].total = Math.max(0, totalBefore - p.casualties);
          // Distribute casualties proportionally across branches
          const ratio = deployments[p.country].total / Math.max(1, totalBefore);
          deployments[p.country].army = Math.floor(deployments[p.country].army * ratio);
          deployments[p.country].navy = Math.floor(deployments[p.country].navy * ratio);
          deployments[p.country].airForce = Math.floor(deployments[p.country].airForce * ratio);
        }
      });
    }

    // Store battle result
    if (!room.phase2.battleResults) {
      room.phase2.battleResults = [];
    }
    room.phase2.battleResults.push(battleResult);

    // Remove from active conflicts
    room.phase2.activeConflicts = room.phase2.activeConflicts.filter(c => c.battleId !== battleId);

    // Clear pending conflict zone
    if (room.phase2.pendingConflictZones) {
      delete room.phase2.pendingConflictZones[conflict.region];
    }

    console.log('⚔️ Battle resolved:', JSON.stringify(battleResult, null, 2));

    // Notify all players of battle result
    io.to(roomId).emit('battleResolved', {
      battleId,
      result: battleResult
    });

    // Check if all conflicts are resolved - if so, continue with year advance
    const remainingConflicts = Object.keys(room.phase2.pendingConflictZones || {}).length;
    const activeConflictCount = (room.phase2.activeConflicts || []).length;

    console.log(`   Remaining conflicts: ${remainingConflicts} pending, ${activeConflictCount} active`);

    if (remainingConflicts === 0 && activeConflictCount === 0 && room.phase2.awaitingDiplomaticResolution) {
      console.log('✅ All diplomatic/battle phases complete! Proceeding with year advance...');
      room.phase2.awaitingDiplomaticResolution = false;

      // Now do the year advance that was postponed
      try {
        const currentYear = room.phase2.currentYear;
        console.log(`🔍 Post-battle year advance: currentYear=${currentYear}`);

        // Check if we're already at the end (1952)
        if (currentYear >= 1952) {
          calculatePhase2Scores(roomId);
          room.gamePhase = 'complete';
          room.phase2.active = false;
          console.log('Phase 2 complete! Final scores calculated.');
          saveGameStateSnapshot(roomId, 'game_complete');
        } else {
          // Calculate economics
          calculateYearEconomics(roomId);

          // Advance year and round
          room.phase2.currentYear++;
          room.currentRound++;
          room.readyPlayers = [];

          // Score this year's economic performance
          calculateYearlyPhase2Score(roomId, room.phase2.currentYear);

          // Check for new crisis
          triggerCrisisIfNeeded(roomId, room.phase2.currentYear);

          console.log(`✅ Advanced to year ${room.phase2.currentYear} after battle resolution`);
          saveGameStateSnapshot(roomId, 'year_end');
        }

        broadcastToRoom(roomId);
      } catch (err) {
        console.error('❌ Post-battle year advance failed:', err);
      }
    }

    saveState();
    saveGamePhase2State(roomId);
    saveGameToDatabase(roomId);
  }

  // CRISIS: Submit response to active crisis
  // Now supports multiple active crises - crisisId identifies which one
  socket.on('submitCrisisResponse', ({ roomId, playerid, choiceId, crisisId }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.phase2?.active) return;

    const player = room.players[playerid];
    if (!player) return;

    // Handle both old single-crisis format and new array format
    let activeCrises = room.phase2.crises.active;
    if (!activeCrises || (Array.isArray(activeCrises) && activeCrises.length === 0)) {
      console.log('No active crisis');
      return;
    }

    // Convert to array if old format
    if (!Array.isArray(activeCrises)) {
      activeCrises = [activeCrises];
      room.phase2.crises.active = activeCrises;
    }

    // Find the specific crisis (by crisisId or default to first)
    let crisis;
    if (crisisId) {
      crisis = activeCrises.find(c => c.id === crisisId);
    } else {
      // Backwards compatibility: find first crisis this country is affected by
      const country = player.country;
      const normalizedCountry = normalizeCountryName(country);
      crisis = activeCrises.find(c =>
        c.affectedCountries.some(ac =>
          ac === country || ac === normalizedCountry || normalizeCountryName(ac) === normalizedCountry
        )
      );
    }

    if (!crisis) {
      console.log('Crisis not found or player not affected');
      return;
    }

    const country = player.country;
    const normalizedCountry = normalizeCountryName(country);

    // Check if this country is affected by the crisis
    const isAffected = crisis.affectedCountries.some(c =>
      c === country || c === normalizedCountry || normalizeCountryName(c) === normalizedCountry
    );
    if (!isAffected) {
      console.log(`${country} (normalized: ${normalizedCountry}) not affected by crisis: ${crisis.title}`);
      return;
    }

    // Get the choice
    let countryOptions = crisis.options[country] || crisis.options[normalizedCountry];
    if (!countryOptions) {
      console.log(`No options for ${country} or ${normalizedCountry} in crisis: ${crisis.title}`);
      console.log(`Available option keys: ${Object.keys(crisis.options).join(', ')}`);
      return;
    }

    const choice = countryOptions.find(opt => opt.id === choiceId);
    if (!choice) {
      console.log(`Invalid choice ID: ${choiceId}`);
      return;
    }

    // Validate military requirements
    const currentYear = room.phase2.currentYear;
    const yearData = room.phase2.yearlyData[currentYear]?.[normalizedCountry] ||
                     room.phase2.yearlyData[currentYear]?.[country];

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

    // Initialize responses object on the crisis if needed
    if (!crisis.responses) {
      crisis.responses = {};
    }

    // Store the response in the crisis's own responses object
    crisis.responses[normalizedCountry] = {
      playerid,
      choiceId,
      choice,
      timestamp: Date.now()
    };

    console.log(`${country} (${normalizedCountry}) submitted response to "${crisis.title}": ${choice.text}`);

    // Crisis choices are persisted via game state snapshots (crises JSON field)
    // Reference option definitions live in the crisis_options table (populated from crisis-events.json)

    // Check if all affected countries with active players have responded to THIS crisis
    const affectedCountriesWithPlayers = crisis.affectedCountries.filter(c => {
      const normalizedC = normalizeCountryName(c);
      return Object.values(room.players).some(p =>
        p.country === c || normalizeCountryName(p.country) === normalizedC
      );
    });

    const allResponded = affectedCountriesWithPlayers.every(c => {
      const normalizedC = normalizeCountryName(c);
      return crisis.responses[c] || crisis.responses[normalizedC];
    });

    console.log(`Crisis "${crisis.title}" responses: ${Object.keys(crisis.responses).length}/${affectedCountriesWithPlayers.length}`);

    if (allResponded) {
      console.log(`✅ All affected countries responded to "${crisis.title}" - auto-resolving`);
      resolveCrisisEffects(roomId, crisis.id);
    }

    broadcastToRoom(roomId);
    saveState();
    saveGamePhase2State(roomId);
    saveGameToDatabase(roomId);
  });

  // CRISIS: Admin manually resolves crisis (for cases where not all countries responded)
  // crisisId is optional - if not provided, resolves all active crises
  socket.on('resolveCrisis', async ({ roomId, playerId, playerid, userId, crisisId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;

    // Support multiple parameter names - prefer userId, then playerId, then playerid
    const checkId = userId || playerId || playerid;

    // Check if user is superadmin by querying database
    let isSuperAdmin = false;

    try {
      const dbUsers = await queryDatabase('getAllUsers', {});

      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === checkId);

        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
          console.log('User checking crisis resolution permission:', {
            username: dbUser.username,
            user_id: dbUser.user_id,
            is_teacher: dbUser.is_teacher,
            isSuperAdmin
          });
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }

    // Check if user is the host
    const isRoomHost = room.hostUserId === checkId || room.hostId === checkId;

    if (!isSuperAdmin && !isRoomHost) {
      socket.emit('resolveCrisisError', {
        message: 'Only the game admin can manually resolve crises'
      });
      return;
    }

    // Handle both old and new format
    let activeCrises = room.phase2.crises.active;
    if (!activeCrises || (Array.isArray(activeCrises) && activeCrises.length === 0)) {
      console.log('No active crisis to resolve');
      return;
    }

    if (!Array.isArray(activeCrises)) {
      activeCrises = [activeCrises];
    }

    if (crisisId) {
      const crisis = activeCrises.find(c => c.id === crisisId);
      console.log(`Admin manually resolving crisis: ${crisis?.title || crisisId}`);
    } else {
      console.log(`Admin manually resolving all ${activeCrises.length} active crisis(es)`);
    }

    const success = resolveCrisisEffects(roomId, crisisId);
    if (success) {
      broadcastToRoom(roomId);
      saveState();
      saveGamePhase2State(roomId);
      saveGameToDatabase(roomId);
    }
  });

  socket.on('advanceYear', async ({ roomId, playerId, playerid, userId }) => {
    // Support multiple parameter names - prefer userId, then playerId, then playerid
    const checkId = userId || playerId || playerid;

    console.log('=== ADVANCE YEAR REQUEST ===');
    console.log('Room ID:', roomId);
    console.log('User ID:', checkId);

    const room = globalState.rooms[roomId];
    if (!room) {
      console.log('ERROR: Room not found');
      return;
    }

    console.log('Room found:', room.roomName);
    console.log('Room host userId:', room.hostUserId);
    console.log('Room host Id (legacy):', room.hostId);
    console.log('Phase 2 active:', room.phase2.active);
    console.log('Current year:', room.phase2.currentYear);
    
    // Check if user is superadmin by querying database
    let isSuperAdmin = false;
    
    try {
      const dbUsers = await queryDatabase('getAllUsers', {});
      
      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === checkId);
        
        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
          console.log('User found in DB:', {
            username: dbUser.username,
            user_id: dbUser.user_id,
            is_teacher: dbUser.is_teacher,
            isSuperAdmin
          });
        } else {
          console.log('User not found in database with user_id:', checkId);
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }
    
    // Check if user is the host (either by hostUserId or legacy hostId)
    const isRoomHost = room.hostUserId === checkId || room.hostId === checkId;
    
    console.log('=== DETAILED PERMISSION CHECK ===');
    console.log('Check ID (userId or playerid):', checkId);
    console.log('Room host userId:', room.hostUserId);
    console.log('Room host Id (legacy):', room.hostId);
    console.log('IDs match hostUserId:', room.hostUserId === checkId);
    console.log('IDs match hostId:', room.hostId === checkId);
    console.log('Is superadmin:', isSuperAdmin);
    console.log('Is room host:', isRoomHost);
    console.log('Permission check result:', { isSuperAdmin, isRoomHost });
    
    // Allow either superadmin OR room host to advance year
    if (!isSuperAdmin && !isRoomHost) {
      console.log('❌ Advance year rejected:', {
        checkId,
        isSuperAdmin,
        isRoomHost,
        roomHostUserId: room.hostUserId,
        roomHostId: room.hostId,
        reason: 'User is neither superadmin nor room host'
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
    // Handle both array format and single object format
    const activeCrises = room.phase2.crises.active;
    const hasActiveCrisis = Array.isArray(activeCrises)
      ? activeCrises.length > 0
      : activeCrises !== null && activeCrises !== undefined;

    if (hasActiveCrisis) {
      const crisisTitle = Array.isArray(activeCrises)
        ? activeCrises.map(c => c.title || c.id || 'Unknown').join(', ')
        : (activeCrises.title || activeCrises.id || 'Unknown');
      console.log('⚠️ Cannot advance year - active crisis must be resolved first:', crisisTitle);
      socket.emit('advanceYearError', {
        message: `Crisis in progress: ${crisisTitle}. Resolve the crisis before advancing.`
      });
      return;
    }
    
    // Check if we're already at the end
    if (room.phase2.currentYear >= 1952) {
      // Don't calculate more economics, just finalize
      calculatePhase2Scores(roomId);
      room.gamePhase = 'complete';
      room.phase2.active = false;
      console.log('Phase 2 complete! Final scores calculated.');
      saveGameStateSnapshot(roomId, 'game_complete');

      broadcastToRoom(roomId);
      saveState();
      saveGamePhase2State(roomId);
      saveGameToDatabase(roomId); // Handles DB update with completed status
      return;
    }
    
    // Calculate this year's economics (this creates data for next year)
    try {
      console.log('Calculating year economics...');
      calculateYearEconomics(roomId);
      console.log('✓ Economics calculated');
    } catch (err) {
      console.error('❌ Error calculating year economics:', err);
      socket.emit('advanceYearError', {
        message: `Failed to calculate economics: ${err.message}`
      });
      return;
    }
    
    // Advance year and round
    room.phase2.currentYear++;
    room.currentRound++; // Track Phase 2 progress in DB (11=1946, 12=1947, etc.)
    room.readyPlayers = [];
    room.phase2.deploymentsThisYear = {}; // Reset deployment limits for new year

    // Score this year's economic performance
    calculateYearlyPhase2Score(roomId, room.phase2.currentYear);

    // Check for crisis events this year
    triggerCrisisIfNeeded(roomId, room.phase2.currentYear);
    
    console.log(`✅ Advanced to year ${room.phase2.currentYear}`);
    saveGameStateSnapshot(roomId, 'year_end');

    // Check if we've reached the final year
    if (room.phase2.currentYear >= 1952) {
      console.log('Reached final year 1952. Next advance will complete Phase 2.');
    }

    console.log('Broadcasting updated game state...');
    broadcastToRoom(roomId);
    saveState();
    saveGamePhase2State(roomId); // Save Phase 2 state to per-game file
    saveGameToDatabase(roomId); // Save game state to database
    console.log('✅ Year advancement complete');
  });

  // ADMIN: Reset room (room host or superadmin)
  socket.on('resetRoom', async ({ roomId, playerId, playerid, userId }) => {
    // Support multiple parameter names
    const id = userId || playerId || playerid;

    const room = globalState.rooms[roomId];
    if (!room) return;

    // Check if user is superadmin by querying database
    let isSuperAdmin = false;

    try {
      const dbUsers = await queryDatabase('getAllUsers', {});

      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === id);

        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }

    // Check using hostUserId (which is always user_id)
    const isRoomHost = room.hostUserId === id || room.hostId === id;
    
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
      achievements: {}
    };
    
    socket.emit('resetRoomResult', { success: true });
    broadcastToRoom(roomId);
    broadcastRoomList();
    saveState();
    
    console.log(`Room ${roomId} reset by superadmin`);
  });
  
  // SUPERADMIN ONLY: Clear all data
  socket.on('clearAllData', async ({ playerId, playerid, userId, confirmCode }) => {
    // Support multiple parameter names
    const id = userId || playerId || playerid;
    console.log('clearAllData called:', { userId: id, confirmCode });

    // Check if user is superadmin by querying database
    let isSuperAdmin = false;
    let dbUser = null;

    try {
      const dbUsers = await queryDatabase('getAllUsers', {});

      if (dbUsers && Array.isArray(dbUsers)) {
        dbUser = dbUsers.find(u => u.user_id === id);

        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }

    if (!dbUser) {
      socket.emit('clearDataResult', { success: false, message: 'User not found. Please try logging out and back in.' });
      return;
    }
    
    if (!isSuperAdmin) {
      socket.emit('clearDataResult', { success: false, message: `Access denied. Only superadmin can clear data.` });
      return;
    }
    
    if (confirmCode !== 'CLEAR_ALL_DATA') {
      socket.emit('clearDataResult', { success: false, message: 'Invalid confirmation code. Type exactly: CLEAR_ALL_DATA' });
      return;
    }
    
    // Clear all rooms but keep superadmin user
    globalState.rooms = {};
    globalState.roomList = [];
    
    // Keep only superadmin users
    const superAdminUsers = {};
    Object.entries(globalState.users).forEach(([username, userData]) => {
      if (userData.role === 'superadmin') {
        superAdminUsers[username] = userData;
      }
    });
    globalState.users = superAdminUsers;
    
    broadcastRoomList();
    saveState();
    
    socket.emit('clearDataResult', { success: true, message: 'All data cleared except administrator account' });
    console.log(`All data cleared by superadmin: ${id}`);
  });

  // SUPERADMIN ONLY: Delete any room
  socket.on('adminDeleteRoom', async ({ roomId, playerId, playerid, userId }) => {
    // Support multiple parameter names
    const id = userId || playerId || playerid;

    // Check if user is superadmin by querying database
    let isSuperAdmin = false;

    try {
      const dbUsers = await queryDatabase('getAllUsers', {});

      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === id);

        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }

    if (!isSuperAdmin) {
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
  
  // Get all active games for a specific player (multi-game support)
  socket.on('getPlayerActiveGames', async ({ playerId }) => {
    console.log('getPlayerActiveGames request from playerId:', playerId);
    const myActiveGames = [];

    try {
      const gameResult = await queryDatabase('getPlayerActiveGame', { userId: playerId });
      const games = Array.isArray(gameResult) ? gameResult : (gameResult ? [gameResult] : []);
      

      for (const game of games) {
        if (game && game.game_code) {
          const roomState = globalState.rooms[game.game_code];
          const isCompleted = game.status === 'completed' ||
            game.game_status === 'completed' ||
            (roomState && roomState.gamePhase === 'complete');

          if (!isCompleted) {
            myActiveGames.push({
              game_id: game.game_id,
              gameCode: game.game_code,
              country_id: game.country_id,
              country_code: game.country_code,
              status: game.status,
              playerCount: roomState ? Object.keys(roomState.players).length : 0,
              gamePhase: roomState ? roomState.gamePhase : (game.status || 'unknown'),
              currentRound: roomState ? roomState.currentRound : (game.current_round || 0),
              currentYear: roomState?.phase2?.currentYear || null
            });
          }
        }
      }
    } catch (err) {
      console.error('Error fetching player active games:', err);
    }

    console.log(`Returning ${myActiveGames.length} active games for player ${playerId}`);
    socket.emit('playerActiveGamesResult', { success: true, games: myActiveGames });
  });

  // Get available games (for regular users - lobby games they can join)
  socket.on('getAvailableGames', ({ playerId }) => {
    // Scan in-memory rooms for lobby-phase games with open slots.
    // (DB status is 'active' for all games; gamePhase is the authoritative lobby flag.)
    const availableGames = Object.values(globalState.rooms)
      .filter(room => room.gamePhase === 'lobby' && !room.gameStarted)
      .filter(room => Object.keys(room.players).length < 7)
      .map(room => ({
        gameCode: room.gameCode || room.roomId,
        gameId: room.gameId,
        playerCount: Object.keys(room.players).length,
        availableSlots: 7 - Object.keys(room.players).length,
        hostUserId: room.hostUserId || room.hostId,
        createdAt: room.createdAt
      }));

    console.log(`getAvailableGames: returning ${availableGames.length} lobby game(s) for player ${playerId}`);

    socket.emit('availableGamesResult', {
      success: true,
      games: availableGames
    });
  });

  // NEW: Superadmin request for active games list (all games, any phase)
  socket.on('getActiveGames', async ({ playerId }) => {
    console.log('getActiveGames request from playerId:', playerId);
    
    // Get ALL games from database  
    const dbGames = await queryDatabase('getGames', { status: 'active' });
    const activeGames = [];
    
    console.log('Database games:', dbGames ? dbGames.length : 0);
    
    if (dbGames && Array.isArray(dbGames)) {
      for (const game of dbGames) {
        const roomState = globalState.rooms[game.game_code];
        console.log(`  - Game ${game.game_code}: inMemory=${!!roomState}`);
        activeGames.push({
          gameCode: game.game_code,
          gameId: game.game_id,
          status: game.status,
          currentRound: game.current_round,
          hostUserId: game.host_user_id,
          playerCount: roomState ? Object.keys(roomState.players).length : 0,
          gamePhase: roomState ? roomState.gamePhase : 'unknown',
          phase2Active: roomState ? roomState.phase2?.active : false,
          currentYear: roomState ? game.currentYear : null,
          createdAt: game.created_at,
          startedAt: game.started_at,
          inMemory: !!roomState
        });
      }
    }
    
    // Also check for rooms in memory only
    for (const [roomId, roomState] of Object.entries(globalState.rooms)) {
      if (!activeGames.find(g => g.gameCode === roomId)) {
        console.log(`  - Memory-only game: ${roomId}`);
        activeGames.push({
          gameCode: roomId,
          gameId: roomState.gameId,
          status: 'memory-only',
          currentRound: roomState.currentRound,
          hostUserId: roomState.hostId,
          playerCount: Object.keys(roomState.players).length,
          gamePhase: roomState.gamePhase,
          phase2Active: roomState.phase2?.active,
          currentYear: roomState.phase2?.currentYear,
          createdAt: new Date(roomState.createdAt).toISOString(),
          inMemory: true
        });
      }
    }
    
    console.log(`Returning ${activeGames.length} games`);
    
    socket.emit('activeGamesResult', { 
      success: true, 
      games: activeGames 
    });
  });
  
  socket.on('disconnect', () => {
    // Find rooms where this socket is a player or observer
    Object.keys(globalState.rooms).forEach(roomId => {
      const room = globalState.rooms[roomId];

      // Mark observer stale (null) in global registry — keeps the key so the
      // fast-update at the top of joinRoom re-registers the new socket ID on reconnect.
      const roomObs = observerRegistry[roomId];
      if (roomObs) {
        for (const [uid, sid] of Object.entries(roomObs)) {
          if (sid === socket.id) {
            roomObs[uid] = null;
            console.log(`Observer ${uid} disconnected from room ${roomId} (marked stale in registry)`);
          }
        }
      }

      const playerid = Object.keys(room.players).find(
        id => room.players[id].socketId === socket.id
      );

      if (playerid) {
        room.players[playerid].disconnected = true;
        room.players[playerid].disconnectedAt = Date.now();
        room.readyPlayers = room.readyPlayers.filter(id => id !== playerid);

        broadcastToRoom(roomId);
        saveState();

        console.log(`Player ${playerid} disconnected from room ${roomId} - keeping in game`);
      }
    });

    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Load games from database on startup
async function initializeFromDatabase() {
  console.log('⏳ Loading active games from database...');

  const games = await queryDatabase('getGames', { status: 'active' });

  if (games && Array.isArray(games)) {
    console.log(`✅ Loaded ${games.length} active game(s) from database`);

    // Convert DB games to room state
    for (const game of games) {
      const gameCode = game.game_code; // e.g., "game_39"

      console.log(`📋 Loading game: ${gameCode}`);

      // Check if we already have this room from the main state file (with yearlyData etc.)
      const existingRoom = globalState.rooms[gameCode];
      if (existingRoom && existingRoom.phase2?.yearlyData && Object.keys(existingRoom.phase2.yearlyData).length > 0) {
        console.log(`   📂 Found existing state from file (yearlyData years: ${Object.keys(existingRoom.phase2.yearlyData).join(', ')}, currentYear: ${existingRoom.phase2.currentYear})`);

        // ALWAYS check DB snapshot for more recent state — the file might be stale
        // (on Render, the file might be from an older deploy or process restart)
        try {
          const snapshots = await queryDatabase('getGameStateSnapshots', { game_code: gameCode });
          if (snapshots && Array.isArray(snapshots) && snapshots.length > 0) {
            // Find snapshot with highest round_or_year (most progress), not just newest by timestamp
            let bestSnap = snapshots[0];
            let bestProgress = parseInt(bestSnap.round_or_year) || 0;
            for (const snap of snapshots) {
              const progress = parseInt(snap.round_or_year) || 0;
              if (progress > bestProgress ||
                  (progress === bestProgress && snap.snapshot_type === 'year_end' && bestSnap.snapshot_type !== 'year_end') ||
                  (progress === bestProgress && snap.snapshot_type === 'game_complete')) {
                bestSnap = snap;
                bestProgress = progress;
              }
            }
            const latestMeta = bestSnap;
            const snapshotYear = latestMeta.current_year ? parseInt(latestMeta.current_year) : null;
            const snapshotRound = parseInt(latestMeta.round_or_year) || null;
            const fileYear = existingRoom.phase2.currentYear || 1946;

            console.log(`   📸 Best snapshot: id=${latestMeta.id}, type=${latestMeta.snapshot_type}, round/year=${snapshotRound}, file year=${fileYear}`);

            // If snapshot has more progress than file, restore from snapshot
            const snapshotIsNewer = (snapshotRound && snapshotRound > fileYear) ||
                                    (snapshotYear && snapshotYear > fileYear);
            if (snapshotIsNewer) {
              console.log(`   ⚠️ DB snapshot is newer (year=${snapshotYear || snapshotRound}) than file (year=${fileYear}) — restoring from snapshot`);
              if (latestMeta.id) {
                const fullSnapshot = await queryDatabase('getGameStateSnapshot', { id: latestMeta.id });
                if (fullSnapshot && fullSnapshot.full_state) {
                  const fullState = typeof fullSnapshot.full_state === 'string' ? JSON.parse(fullSnapshot.full_state) : fullSnapshot.full_state;
                  if (fullState && fullState.phase2) {
                    existingRoom.gamePhase = fullState.gamePhase || existingRoom.gamePhase;
                    existingRoom.currentRound = fullState.currentRound || existingRoom.currentRound;
                    existingRoom.scores = fullState.scores || existingRoom.scores;
                    existingRoom.roundHistory = fullState.roundHistory || existingRoom.roundHistory;
                    existingRoom.phase2 = {
                      ...existingRoom.phase2,
                      ...fullState.phase2
                    };
                    console.log(`   ✅ Existing room updated from snapshot: year=${existingRoom.phase2.currentYear}, phase=${existingRoom.gamePhase}, round=${existingRoom.currentRound}`);
                  }
                } else {
                  // Fallback: use metadata year
                  existingRoom.phase2.currentYear = snapshotYear || snapshotRound || fileYear;
                  console.log(`   ✅ Updated currentYear from snapshot metadata: ${existingRoom.phase2.currentYear}`);
                }
              }
            } else {
              console.log(`   ✅ File state is current (year=${fileYear}, snapshot=${snapshotYear || snapshotRound || 'N/A'})`);
            }
          }
        } catch (err) {
          console.log(`   ⚠️ Could not check snapshot for ${gameCode}: ${err.message}`);
        }

        // Update players from database in case they changed
        const players = await queryDatabase('getPlayers', { game_id: game.game_id });
        if (players && Array.isArray(players) && players.length > 0) {
          for (const player of players) {
            const isReady = player.is_ready === 1 || player.is_ready === '1';
            existingRoom.players[player.user_id] = {
              id: player.player_id,
              userId: player.user_id,
              playerId: player.player_id,
              country: normalizeCountryName(player.country_code) || player.country_code,
              ready: isReady,
              score: (parseInt(player.phase1_score) || 0) + (parseInt(player.phase2_score) || 0),
              phase1_score: parseInt(player.phase1_score) || 0,
              phase2_score: parseInt(player.phase2_score) || 0
            };
            if (isReady && !existingRoom.readyPlayers.includes(player.player_id)) {
              existingRoom.readyPlayers.push(player.player_id);
            }
          }
        }
        continue; // Keep existing room state (now with snapshot updates)
      }

      // Create room state from database game (no existing state found)
      const roomState = createGameState(gameCode, `Game ${gameCode}`, game.host_user_id);
      roomState.gameId = game.game_id;
      roomState.hostUserId = game.host_user_id;
      roomState.status = game.status;

      // Restore game state from database
      if (game.current_round) {
        roomState.currentRound = game.current_round;
      }

      // Determine game phase from database
      if (game.game_status === 'completed') {
        roomState.gamePhase = 'complete';
        roomState.gameStarted = true;
      } else if (game.current_round && game.current_round > 0) {
        roomState.gameStarted = true;
        if (game.current_round > 10) {
          // Phase 2
          roomState.gamePhase = 'phase2';
          roomState.phase2.active = true;
          if (game.currentYear) {
            roomState.phase2.currentYear = game.currentYear;
          }
        } else {
          // Phase 1 - assume voting phase by default
          roomState.gamePhase = 'voting';
        }
      }

      console.log(`   Restored state: phase=${roomState.gamePhase}, round=${roomState.currentRound}, year=${roomState.phase2?.currentYear || 'N/A'}`);

      // Load players for this game from database
      const players = await queryDatabase('getPlayers', { game_id: game.game_id });

      if (players && Array.isArray(players) && players.length > 0) {
        console.log(`   Found ${players.length} player(s) in database`);
        for (const player of players) {
          // Key by userId for consistency (so client can find them by userId)
          const isReady = player.is_ready === 1 || player.is_ready === '1';
          roomState.players[player.user_id] = {
            id: player.player_id,
            userId: player.user_id,
            playerId: player.player_id,
            country: normalizeCountryName(player.country_code) || player.country_code,
            ready: isReady,
            score: (parseInt(player.phase1_score) || 0) + (parseInt(player.phase2_score) || 0),
            phase1_score: parseInt(player.phase1_score) || 0,
            phase2_score: parseInt(player.phase2_score) || 0
          };
          if (isReady && !roomState.readyPlayers.includes(player.player_id)) {
            roomState.readyPlayers.push(player.player_id);
          }
          console.log(`   - Player: user_id=${player.user_id}, player_id=${player.player_id}, country=${player.country_code}, ready=${isReady}`);
        }
      } else {
        console.log(`   No players found for game ${gameCode}`);
      }

      // Rebuild room.scores from player data (fallback - always available)
      for (const player of Object.values(roomState.players)) {
        const country = player.country;
        const s = parseInt(player.phase1_score) || 0;
        if (country && s) {
          roomState.scores[country] = (roomState.scores[country] || 0) + s;
        }
      }
      console.log(`   📊 Scores rebuilt from player data:`, roomState.scores);

      // Try to restore full state from game state snapshots in DB
      // IMPORTANT: Don't just use the most recent snapshot by timestamp!
      // The bug that reset games to 1946 also saved new phase_transition snapshots,
      // burying the real year_end snapshots. Pick the snapshot with the HIGHEST year/round.
      try {
        const snapshots = await queryDatabase('getGameStateSnapshots', { game_code: gameCode });
        if (snapshots && Array.isArray(snapshots) && snapshots.length > 0) {
          // Find the snapshot with the highest round_or_year (most game progress)
          // rather than just the most recent by timestamp
          let bestMeta = snapshots[0];
          let bestProgress = parseInt(bestMeta.round_or_year) || 0;
          for (const snap of snapshots) {
            const progress = parseInt(snap.round_or_year) || 0;
            // Prefer higher year/round, or same year but year_end over phase_transition
            if (progress > bestProgress ||
                (progress === bestProgress && snap.snapshot_type === 'year_end' && bestMeta.snapshot_type !== 'year_end') ||
                (progress === bestProgress && snap.snapshot_type === 'game_complete')) {
              bestMeta = snap;
              bestProgress = progress;
            }
          }
          const latestMeta = bestMeta;
          console.log(`   📸 Found ${snapshots.length} snapshot(s), best: id=${latestMeta.id}, type=${latestMeta.snapshot_type}, phase=${latestMeta.phase}, round/year=${latestMeta.round_or_year} (newest by timestamp: id=${snapshots[0].id}, round/year=${snapshots[0].round_or_year})`);

          let latest = latestMeta; // fallback to lightweight data
          if (latestMeta.id) {
            try {
              const fullSnapshot = await queryDatabase('getGameStateSnapshot', { id: latestMeta.id });
              if (fullSnapshot && !fullSnapshot.error) {
                latest = fullSnapshot;
                console.log(`   📸 Fetched full snapshot (id=${latestMeta.id}), has full_state: ${!!latest.full_state}, has yearly_data: ${!!latest.yearly_data}`);
              } else {
                console.log(`   ⚠️ Could not fetch full snapshot by id=${latestMeta.id}, using lightweight data`);
              }
            } catch (fetchErr) {
              console.log(`   ⚠️ Error fetching full snapshot: ${fetchErr.message}`);
            }
          }

          // Try to restore from full_state first (contains everything)
          let fullStateRestored = false;
          if (latest.full_state) {
            try {
              const fullState = typeof latest.full_state === 'string' ? JSON.parse(latest.full_state) : latest.full_state;
              if (fullState && typeof fullState === 'object') {
                // Only restore round/phase from snapshot if it is at least as far as
                // the DB record (game.current_round). A stale snapshot (e.g. round_end
                // for round 1) must NOT overwrite a DB that already shows round 2.
                const dbRound = parseInt(game.current_round) || 0;
                const snapRound = parseInt(fullState.currentRound) || 0;
                const snapAheadOfDB = snapRound >= dbRound;

                if (snapAheadOfDB) {
                  if (fullState.currentRound) roomState.currentRound = fullState.currentRound;
                  if (fullState.gamePhase) roomState.gamePhase = fullState.gamePhase;
                } else {
                  console.log(`   ⚠️ Snapshot round (${snapRound}) is behind DB round (${dbRound}) — keeping DB round/phase (${roomState.gamePhase})`);
                }
                if (fullState.gameStarted !== undefined) roomState.gameStarted = fullState.gameStarted;
                if (fullState.scores) roomState.scores = fullState.scores;
                if (fullState.roundHistory) roomState.roundHistory = fullState.roundHistory;
                if (fullState.votes && snapAheadOfDB) roomState.votes = fullState.votes;

                // Restore Phase 2 state (critical for year progression)
                if (fullState.phase2) {
                  roomState.phase2 = {
                    ...roomState.phase2,
                    currentYear: fullState.phase2.currentYear || roomState.phase2.currentYear,
                    active: fullState.phase2.active !== undefined ? fullState.phase2.active : roomState.phase2.active,
                    yearlyData: fullState.phase2.yearlyData || roomState.phase2.yearlyData || {},
                    policies: fullState.phase2.policies || roomState.phase2.policies || {},
                    achievements: fullState.phase2.achievements || {},
                    crises: fullState.phase2.crises || { active: null, history: [], responses: {} },
                    cumulativeDeployments: fullState.phase2.cumulativeDeployments || {},
                    deploymentHistory: fullState.phase2.deploymentHistory || [],
                    pendingConflictZones: fullState.phase2.pendingConflictZones || {},
                    activeConflicts: fullState.phase2.activeConflicts || [],
                    battleResults: fullState.phase2.battleResults || [],
                    battleDecisions: fullState.phase2.battleDecisions || {},
                    battleOptions: fullState.phase2.battleOptions || {},
                    diplomaticStances: fullState.phase2.diplomaticStances || {},
                    diplomaticPoints: fullState.phase2.diplomaticPoints || {},
                    awaitingDiplomaticResolution: fullState.phase2.awaitingDiplomaticResolution || false,
                    scoreBreakdowns: fullState.phase2.scoreBreakdowns || {},
                    readyPlayers: fullState.phase2.readyPlayers || [],
                    maxYears: fullState.phase2.maxYears || 7
                  };
                  console.log(`   ✅ Full state restored from snapshot: phase=${roomState.gamePhase}, round=${roomState.currentRound}, year=${roomState.phase2.currentYear}, yearlyData years: ${Object.keys(roomState.phase2.yearlyData).join(', ')}`);
                  fullStateRestored = true;
                }

                // Restore players from full_state but merge with DB players (DB has latest scores)
                // Keep DB player data as primary, just fill in missing fields from snapshot
                if (fullState.players) {
                  Object.entries(fullState.players).forEach(([pid, snapshotPlayer]) => {
                    if (roomState.players[pid]) {
                      // Merge snapshot data into DB player (DB is authoritative for scores)
                      roomState.players[pid] = {
                        ...snapshotPlayer,
                        ...roomState.players[pid]
                      };
                    }
                  });
                }
              }
            } catch (parseErr) {
              console.error(`   ⚠️ Failed to parse full_state from snapshot:`, parseErr);
            }
          }

          // Fallback: restore individual fields if full_state wasn't available or failed
          if (!fullStateRestored) {
            // Restore scores from snapshot
            let snapshotScores = latest.scores;
            if (typeof snapshotScores === 'string') {
              try { snapshotScores = JSON.parse(snapshotScores); } catch(e) { snapshotScores = null; }
            }
            if (snapshotScores && typeof snapshotScores === 'object') {
              const hasNonZero = Object.values(snapshotScores).some(v => v > 0);
              if (hasNonZero) {
                roomState.scores = { ...roomState.scores, ...snapshotScores };
                console.log(`   ✅ Scores restored from snapshot:`, roomState.scores);
              }
            }

            // Restore round history from snapshot
            let snapshotHistory = latest.round_history;
            if (typeof snapshotHistory === 'string') {
              try { snapshotHistory = JSON.parse(snapshotHistory); } catch(e) { snapshotHistory = null; }
            }
            if (snapshotHistory && Array.isArray(snapshotHistory) && snapshotHistory.length > 0) {
              roomState.roundHistory = snapshotHistory;
              console.log(`   ✅ Round history restored (${snapshotHistory.length} rounds)`);
            }

            // Restore currentYear from snapshot if in Phase 2
            if (latest.current_year && latest.phase === 2) {
              const snapshotYear = typeof latest.current_year === 'string' ? parseInt(latest.current_year) : latest.current_year;
              if (snapshotYear > roomState.phase2.currentYear) {
                roomState.phase2.currentYear = snapshotYear;
                console.log(`   ✅ Phase 2 year restored from snapshot: ${snapshotYear}`);
              }
            }

            // Restore Phase 2 yearly data from snapshot fields
            if (latest.yearly_data && latest.phase === 2) {
              let yearlyData = latest.yearly_data;
              if (typeof yearlyData === 'string') {
                try { yearlyData = JSON.parse(yearlyData); } catch(e) { yearlyData = null; }
              }
              if (yearlyData && typeof yearlyData === 'object' && Object.keys(yearlyData).length > 0) {
                roomState.phase2.yearlyData = yearlyData;
                console.log(`   ✅ Phase 2 yearlyData restored from snapshot (years: ${Object.keys(yearlyData).join(', ')})`);
              }
            }

            // Restore policies, deployments, crises from snapshot
            if (latest.policies && latest.phase === 2) {
              let policies = latest.policies;
              if (typeof policies === 'string') {
                try { policies = JSON.parse(policies); } catch(e) { policies = null; }
              }
              if (policies) roomState.phase2.policies = policies;
            }
            if (latest.deployments && latest.phase === 2) {
              let deployments = latest.deployments;
              if (typeof deployments === 'string') {
                try { deployments = JSON.parse(deployments); } catch(e) { deployments = null; }
              }
              if (deployments) roomState.phase2.cumulativeDeployments = deployments;
            }
            if (latest.crises && latest.phase === 2) {
              let crises = latest.crises;
              if (typeof crises === 'string') {
                try { crises = JSON.parse(crises); } catch(e) { crises = null; }
              }
              if (crises) roomState.phase2.crises = crises;
            }
            if (latest.diplomatic_points && latest.phase === 2) {
              let diplo = latest.diplomatic_points;
              if (typeof diplo === 'string') {
                try { diplo = JSON.parse(diplo); } catch(e) { diplo = null; }
              }
              if (diplo) roomState.phase2.diplomaticPoints = diplo;
            }

            console.log(`   📊 Fallback restore: phase=${roomState.gamePhase}, round=${roomState.currentRound}, year=${roomState.phase2.currentYear}`);
          }

          // Correct phase if needed
          if (roomState.gamePhase === 'voting' && latest.snapshot_type === 'round_end') {
            const snapshotRound = latest.round_or_year;
            if (snapshotRound === roomState.currentRound) {
              roomState.gamePhase = 'results';
              console.log(`   ✅ Phase corrected to 'results' (round ${snapshotRound} vote was already completed)`);
            }
          }
        } else {
          console.log(`   ⚠️ No game state snapshots found for ${gameCode}`);
        }
      } catch (snapshotErr) {
        console.error(`   ⚠️ Failed to load snapshots for ${gameCode}:`, snapshotErr);
      }

      globalState.rooms[gameCode] = roomState;

      // Try to load Phase 2 state from per-game JSON file (if it exists)
      // On Render, per-game files don't survive restarts, so snapshot restoration above is primary
      const hasPhase2FromSnapshot = roomState.phase2?.yearlyData && Object.keys(roomState.phase2.yearlyData).length > 0;
      const wasInPhase2 = roomState.gamePhase === 'phase2' || roomState.gamePhase === 'complete' || roomState.currentRound >= 11;

      if (wasInPhase2) {
        const savedPhase2State = loadGamePhase2State(gameCode);
        if (savedPhase2State && savedPhase2State.yearlyData && Object.keys(savedPhase2State.yearlyData).length > 0) {
          // Per-game file exists (local dev or non-ephemeral FS) — use it if it has more data than snapshot
          const fileYears = Object.keys(savedPhase2State.yearlyData).length;
          const snapshotYears = hasPhase2FromSnapshot ? Object.keys(roomState.phase2.yearlyData).length : 0;

          if (fileYears >= snapshotYears) {
            if (!roomState.phase2) roomState.phase2 = {};
            roomState.phase2.currentYear = savedPhase2State.currentYear || roomState.phase2.currentYear;
            roomState.phase2.yearlyData = savedPhase2State.yearlyData;
            roomState.phase2.policies = savedPhase2State.policies || roomState.phase2.policies || {};
            roomState.phase2.achievements = savedPhase2State.achievements || {};
            roomState.phase2.crises = savedPhase2State.crises || roomState.phase2.crises || { active: null, history: [], responses: {} };
            roomState.phase2.active = savedPhase2State.active !== undefined ? savedPhase2State.active : true;
            roomState.phase2.cumulativeDeployments = savedPhase2State.cumulativeDeployments || roomState.phase2.cumulativeDeployments || {};
            roomState.phase2.deploymentHistory = savedPhase2State.deploymentHistory || roomState.phase2.deploymentHistory || [];
            roomState.phase2.pendingConflictZones = savedPhase2State.pendingConflictZones || {};
            roomState.phase2.activeConflicts = savedPhase2State.activeConflicts || [];
            roomState.phase2.battleResults = savedPhase2State.battleResults || roomState.phase2.battleResults || [];
            roomState.phase2.battleDecisions = savedPhase2State.battleDecisions || {};
            roomState.phase2.battleOptions = savedPhase2State.battleOptions || {};
            roomState.phase2.diplomaticStances = savedPhase2State.diplomaticStances || {};
            roomState.phase2.diplomaticPoints = savedPhase2State.diplomaticPoints || roomState.phase2.diplomaticPoints || {};
            roomState.phase2.awaitingDiplomaticResolution = savedPhase2State.awaitingDiplomaticResolution || false;
            roomState.phase2.scoreBreakdowns = savedPhase2State.scoreBreakdowns || {};
            console.log(`   ✅ Per-game file overrides snapshot (file has ${fileYears} years vs snapshot ${snapshotYears}) — year: ${roomState.phase2.currentYear}`);
          } else {
            console.log(`   ✅ Keeping snapshot data (${snapshotYears} years) over per-game file (${fileYears} years)`);
          }
        } else if (hasPhase2FromSnapshot) {
          // No per-game file, but snapshot already restored data — keep it
          console.log(`   ✅ No per-game file — using snapshot-restored Phase 2 data (year: ${roomState.phase2.currentYear})`);
        } else {
          // No per-game file AND no snapshot data — last resort, initialize fresh
          console.log(`   ⚠️ No saved Phase 2 state found anywhere — initializing fresh from 1946...`);
          initializePhase2(gameCode);
        }
      }

      console.log(`  ✅ Loaded game: ${gameCode} with ${Object.keys(roomState.players).length} player(s)`);
    }
  } else {
    console.log('ℹ️  No active games found in database');
  }

  // Prune rooms that exist only in the local state file (no DB record).
  // These accumulate as stale test games and should not appear in any game list.
  // ONLY prune if the DB query actually succeeded (Array.isArray check).
  // If DB returned 503 or null, skip pruning to avoid wiping all rooms.
  if (Array.isArray(games)) {
    const dbGameCodes = new Set(games.map(g => g.game_code));
    let pruned = 0;
    for (const roomId of Object.keys(globalState.rooms)) {
      if (!dbGameCodes.has(roomId)) {
        delete globalState.rooms[roomId];
        pruned++;
      }
    }
    if (pruned > 0) {
      console.log(`🧹 Pruned ${pruned} memory-only room(s) with no database record`);
      saveState();
    }
  } else {
    console.log('⚠️ Skipping room prune — DB query failed or returned no data');
  }
}

// Graceful shutdown: save all state before exit
function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal} - saving state before shutdown...`);
  try {
    saveState();
    // Save Phase 2 state for every active room
    Object.keys(globalState.rooms).forEach(roomId => {
      const room = globalState.rooms[roomId];
      if (room && room.phase2 && room.phase2.yearlyData) {
        saveGamePhase2State(roomId);
      }
    });
    console.log('✅ All state saved. Shutting down.');
  } catch (err) {
    console.error('❌ Error during shutdown save:', err);
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// Catch uncaught exceptions - save state before crash
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception - saving state before crash:', err);
  try {
    saveState();
    Object.keys(globalState.rooms).forEach(roomId => {
      const room = globalState.rooms[roomId];
      if (room && room.phase2 && room.phase2.yearlyData) {
        saveGamePhase2State(roomId);
      }
    });
    console.log('✅ Emergency state save complete.');
  } catch (saveErr) {
    console.error('❌ Emergency save failed:', saveErr);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled rejection at:', promise, 'reason:', reason);
  // Don't exit - just log. Save state as precaution.
  try {
    saveState();
    Object.keys(globalState.rooms).forEach(roomId => {
      const room = globalState.rooms[roomId];
      if (room && room.phase2 && room.phase2.yearlyData) {
        saveGamePhase2State(roomId);
      }
    });
  } catch (err) {
    console.error('❌ Precautionary save failed:', err);
  }
});

// Start server
(async () => {
  await initializeFromDatabase();

  // Periodic auto-save every 60 seconds
  setInterval(() => {
    try {
      saveState();
      Object.keys(globalState.rooms).forEach(roomId => {
        const room = globalState.rooms[roomId];
        if (room && room.phase2 && room.phase2.yearlyData) {
          saveGamePhase2State(roomId);
        }
      });
    } catch (err) {
      console.error('❌ Auto-save failed:', err);
    }
  }, 60000);

  server.listen(PORT, '0.0.0.0', () => {
    console.log('🌍 Bretton Woods Multi-Room Server');
    console.log('===================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📂 State file: ${STATE_FILE}`);
    console.log(`👥 Users: ${Object.keys(globalState.users).length}`);
    console.log(`🏠 Rooms: ${Object.keys(globalState.rooms).length}`);
    console.log(`🔄 Auto-save: every 60 seconds`);
    console.log(`🛑 Graceful shutdown: enabled`);
    console.log('===================================');
  });
})();
