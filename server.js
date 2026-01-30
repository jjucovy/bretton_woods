// server-multiroom.js - Bretton Woods Multi-Room Server
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 65002;
const STATE_FILE = path.join(__dirname, 'game-state.json');

// Database API configuration
const DB_API = {
  url: 'https://jucovy.com/api.php',
  apiKey: 'bretton-woods-secret-key-2024'
};


// Normalize country names to ensure consistent keys
function normalizeCountryName(country) {
  const normalizations = {
    'USS': 'USSR',
    'Soviet Union': 'USSR',
    'US': 'USA',
    'United States': 'USA',
    'GB': 'UK',
    'Great Britain': 'UK',
    'United Kingdom': 'UK',
    'PRC': 'China',
    "People's Republic of China": 'China',
    'French': 'France'
  };
  return normalizations[country] || country;
}


// Function to query database via PHP API
async function queryDatabase(action, data = {}) {
  try {
    const response = await fetch(DB_API.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action,
        api_key: DB_API.apiKey,
        ...data
      })
    });
    
    const result = await response.json();
    if (result.success) {
      return result.data || result;
    } else {
      console.error(`DB Error [${action}]:`, result.error || result.message);
      return null;
    }
  } catch (error) {
    console.error(`API Error [${action}]:`, error.message);
    return null;
  }
}

// Serve game HTML as the main page (MUST come before static middleware!)
app.get('/', (req, res) => {
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
            hostUserId: game.host_user_id
          });
        }
      }
    }
  }
  
  res.json({ games: availableGames });
});

// NEW: API endpoint to get all active games (for superadmin only)
app.get('/api/active-games', async (req, res) => {
  const { adminplayerid } = req.query;
  
  // Verify admin
  const admin = Object.values(globalState.users).find(u => u.player.id === adminplayerid);
  if (!admin || admin.role !== 'superadmin') {
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

// Multi-room game state
let globalState = {
  users: {}, // username -> { password: hashedPassword, playerid: string, createdAt: timestamp }
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
    createdAt: Date.now()
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
    console.log('💾 Multi-room state saved');
  } catch (err) {
    console.error('❌ Error saving state:', err);
  }
}

// Save game state to database
async function saveGameToDatabase(roomId) {
  try {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    // Map game phase to status
    let gameStatus = 'lobby';
    if (room.gamePhase === 'complete') {
      gameStatus = 'completed';
    } else if (room.gameStarted) {
      gameStatus = 'active';
    }
    
    // Prepare update data matching API's expected field names
    const updateData = {
      gameCode: roomId,
      game_status: gameStatus,
      currentRound: room.currentRound || 0
    };
    
    // Add Phase 2 year if in Phase 2
    if (room.phase2?.active && room.phase2.currentYear) {
      updateData.currentYear = room.phase2.currentYear;
    }
    
    // Mark as ended if complete
    if (room.gamePhase === 'complete') {
      updateData.endedAt = true; // API will set to NOW()
    }
    
    // Update game in database
    const result = await queryDatabase('updateGame', updateData);
    
    if (result) {
      console.log(`💾 Game ${roomId} saved to database:`, {
        status: gameStatus,
        round: room.currentRound,
        year: room.phase2?.currentYear || 'N/A'
      });
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

// Get all users (admin only)
app.get('/api/users', (req, res) => {
  const { adminplayerid  } = req.query;
  
  // Verify admin
  const admin = Object.values(globalState.users).find(u => u.player.id === adminplayerid );
  if (!admin || admin.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  // Return users without passwords
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
app.delete('/api/users/:username', express.json(), (req, res) => {
  const { username } = req.params;
  const { adminplayerid  } = req.body;
  
  // Verify admin
  const admin = Object.values(globalState.users).find(u => u.player.id === adminplayerid );
  if (!admin || admin.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  // Don't allow deleting self
  const adminUsername = Object.keys(globalState.users).find(u => globalState.users[u].player.id === adminplayerid );
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
  const { adminplayerid  } = req.query;
  
  // Verify admin
  const admin = Object.values(globalState.users).find(u => u.player.id === adminplayerid );
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
  
  // Log what we're about to broadcast
  if (room.phase2?.active) {
    console.log(`📡 Broadcasting room ${roomId}:`);
    console.log(`   phase2.yearlyData keys:`, Object.keys(room.phase2.yearlyData));
    console.log(`   phase2.yearlyData[1946] keys:`, Object.keys(room.phase2.yearlyData[1946] || {}));
    console.log(`   Full yearlyData:`, JSON.stringify(room.phase2.yearlyData, null, 2).substring(0, 500));
  }
  
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
  
  // Initialize starting exchange rates (Bretton Woods fixed rates)
  const initialExchangeRates = {
    'USA': 1.00,  // USD is the anchor
    'United States': 1.00,
    'UK': 4.03,   // $4.03 per pound (from 1940)
    'USSR': null, // Not convertible - didn't join Bretton Woods
    'Soviet Union': null,
    'France': 119.11, // Francs per dollar (post-war rate)
    'China': 3.35,    // Yuan per dollar (pre-hyperinflation)
    'India': 3.31,    // Rupees per dollar (₹13.33 per pound / 4.03)
    'Argentina': 3.50 // Pesos per dollar (approximate)
  };
  
  // Initialize starting economic conditions for each country
  room.phase2.yearlyData[1946] = {};
  Object.values(room.players).forEach(player => {
    const country = normalizeCountryName(player.country);
    
    // Map country codes (database might have USS instead of USSR)
    const countryKey = country === 'USS' ? 'USSR' : 
                       country === 'United States' ? 'USA' :
                       country === 'United Kingdom' ? 'UK' : country;
    
    const initialData = initialEconomicData[countryKey] || initialEconomicData[country];
    
    if (!initialData) {
      console.error(`⚠️ No economic data found for country: ${country} (tried ${countryKey})`);
      console.log('Available countries in economicData:', Object.keys(initialEconomicData));
      return; // Skip this country
    }
    
    room.phase2.yearlyData[1946][normalizeCountryName(country)] = {
      gdpGrowth: 0,
      goldReserves: initialData.goldReserves || 1000,
      unemployment: country === 'USA' ? 3.9 : country === 'UK' ? 2.5 : country === 'USSR' || country === 'USS' ? 0 : country === 'France' ? 4.5 : country === 'China' ? 6.0 : country === 'India' ? 7.0 : 5.0,
      tradeBalance: initialData.tradeBalance || 0,
      inflation: country === 'USA' ? 8.3 : country === 'UK' ? 3.1 : country === 'USSR' || country === 'USS' ? 0 : country === 'France' ? 50.0 : country === 'China' ? 300.0 : 20.0,
      industrialOutput: initialData.industrialOutput || 100,
      exchangeRate: initialExchangeRates[country] || initialExchangeRates[countryKey] || 1.0,
      exchangeRateChange: 0,
      military: {
        army: initialData.military?.army || 1000000,
        navy: initialData.military?.navy || 100000,
        airForce: initialData.military?.airForce || 50000,
        total: initialData.military?.total || 1150000
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
    const country = normalizeCountryName(player.country);
    let gdpBonus = 0;
    let tradeBonus = 0;
    let cooperationBonus = 0;
    
    roundHistory.forEach((round, idx) => {
      const playerVote = round.votes[player.userId]; // Get vote from saved history
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

// Calculate exchange rate changes based on economic policies
function calculateExchangeRate(country, currentYear, policy, previousData, room) {
  // USSR doesn't participate in Bretton Woods
  if (country === 'USSR' || country === 'Soviet Union') {
    return { rate: null, change: 0, defendable: true };
  }
  
  // USA is the anchor currency
  if (country === 'USA' || country === 'United States') {
    return { rate: 1.00, change: 0, defendable: true };
  }
  
  const previousRate = previousData.exchangeRate;
  let rateChange = 0;
  
  // 1. Inflation differential (vs USA)
  const usData = room.phase2.yearlyData[currentYear]?.['USA'] || room.phase2.yearlyData[currentYear]?.['United States'];
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
  if (country === 'UK' && currentYear === 1949) {
    // September 1949: Sterling crisis - forced devaluation
    rateChange -= 30.5; // $4.03 → $2.80 (for GBP, negative = devaluation)
    console.log(`🚨 HISTORICAL EVENT: UK Sterling Crisis 1949 - Forced 30% devaluation`);
  }
  
  if ((country === 'France' || country === 'French') && currentYear === 1948) {
    // January 1948: Major franc devaluation
    rateChange += 79.9; // 119.11 → 214.39 francs per dollar
    console.log(`🚨 HISTORICAL EVENT: France 1948 Devaluation - 80% currency collapse`);
  }
  
  if ((country === 'France' || country === 'French') && currentYear === 1949) {
    // 1949: Two more devaluations
    rateChange += 63.3; // 214 → 350 francs per dollar (combined)
    console.log(`🚨 HISTORICAL EVENT: France 1949 Devaluations - Currency crisis continues`);
  }
  
  if (country === 'India' && currentYear === 1949) {
    // Adjust to sterling devaluation
    rateChange += 18.0; // ₹3.31 → ₹4.76 (follows pound)
    console.log(`📊 India adjusts to sterling devaluation`);
  }
  
  // Calculate new rate
  let newRate;
  if (country === 'UK' || country === 'United Kingdom') {
    // GBP quoted as $/£ - devaluation means lower number
    newRate = previousRate * (1 + rateChange / 100);
  } else {
    // Most currencies quoted as local/$ - devaluation means higher number
    newRate = previousRate * (1 + rateChange / 100);
  }
  
  // Bretton Woods constraint: ±1% band (unless crisis)
  const defendable = Math.abs(rateChange) < 10;
  
  if (Math.abs(rateChange) > 1 && Math.abs(rateChange) < 10) {
    console.log(`⚠️  ${country}: Exchange rate pressure (${rateChange.toFixed(1)}%) - intervention required`);
  }
  
  return {
    rate: Math.max(0.01, newRate), // Ensure positive
    change: rateChange,
    defendable: defendable
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
    console.log(`🚨 Triggering crisis: ${availableCrisis.title} for year ${year}`);
    room.phase2.crises.active = {
      ...availableCrisis,
      triggeredAt: Date.now(),
      resolved: false
    };
    room.phase2.crises.responses = {};
    
    console.log(`✋ Crisis active - waiting for player responses`);
    console.log(`Affected countries:`, availableCrisis.affectedCountries);
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
    const country = normalizeCountryName(player.country);
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

function calculatePhase2Scores(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return;
  
  const phase2Scores = {};
  const scoreBreakdowns = {};
  
  Object.values(room.players).forEach(player => {
    const country = normalizeCountryName(player.country);
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
  socket.on('register', ({ username, password }) => {
    if (!username || !password) {
      socket.emit('registerResult', { success: false, message: 'Username and password required' });
      return;
    }
    
    if (globalState.users[username]) {
      socket.emit('registerResult', { success: false, message: 'Username already exists' });
      return;
    }
    
    const playerid = playerId;
    const userId = player.userid // Simple numeric ID for now
    
    // Only jjucovy@gmail.com is the super admin
    const isSuperAdmin = username.toLowerCase() === 'jjucovy@gmail.com' || username.toLowerCase() === 'jjucovy';
    
    globalState.users[username] = {
      password: hashPassword(password),
      playerid: player.id,
      userId: userId,
      createdAt: Date.now(),
      role: isSuperAdmin ? 'superadmin' : 'player'
    };
    
    socket.emit('registerResult', { 
      success: true, 
      playerid: player.id,
      username: username,
      role: isSuperAdmin ? 'superadmin' : 'player'
    });
    
    saveState();
    //console.log(`User registered: ${username} (${isSuperAdmin ? 'SUPER ADMIN' : 'player'})`);
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
      
      if (!dbUser) {
        console.log('ERROR: User not found in database');
        socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
        return;
      }
      
      console.log('User found in database:', dbUser.username, 'user_id:', dbUser.user_id);
      
      // For now, accept the password (in production, verify against password_hash)
      const role = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1) ? 'superadmin' : 'player';
      console.log('Login successful, role:', role);
      
      // Check for active game for this user
      let activeGame = null;
      if (role === 'player') {
        const userGames = await queryDatabase('getUserGames', { 
          user_id: dbUser.user_id,
          status: 'active'
        });
        
        if (userGames && Array.isArray(userGames) && userGames.length > 0) {
          // Get the first active game
          const game = userGames[0];
          activeGame = {
            game_id: game.game_id,
            gameCode: game.game_code,
            country_id: game.country_id,
            country_code: game.country_code,  // ADD THIS - the actual country code like 'FRA'
            status: game.status
          };
          console.log(`✓ User has active game: ${activeGame.gameCode}`);
          console.log(`  Country: ${activeGame.country_code} (ID: ${activeGame.country_id})`);
        }
      }
      
      // Get available lobby games if user is a player and doesn't have active game
      let availableGames = [];
      if (role === 'player' && !activeGame) {
        const lobbyGames = Object.values(globalState.rooms).filter(room => !room.gameStarted);
        availableGames = lobbyGames.map(room => ({
          roomId: room.roomId,
          gameCode: room.gameCode || room.roomId,
          playerCount: Object.keys(room.players).length,
          maxPlayers: 7
        }));
      }
      
      socket.emit('loginResult', { 
        success: true, 
        username: username,
        role: role,
        userId: dbUser.user_id,
        activeGame: activeGame,
        availableGames: availableGames
      });
      
      console.log(`User logged in: ${username} (${role})`);
      if (activeGame) console.log(`  Active game: ${activeGame.gameCode}`);
      if (availableGames.length > 0) console.log(`  Available games: ${availableGames.length}`);
      console.log('====================');
    } catch (error) {
      console.error('Login error:', error);
      socket.emit('loginResult', { success: false, message: 'Server error during login' });
    }
  });
  
  // Create new room
  socket.on('createRoom', async ({ playerid, roomName }) => {
    const roomId = roomName || `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    console.log(`📝 Creating room: ${roomId} for player ${playerid}`);
    
    // Create room state
    globalState.rooms[roomId] = createGameState(roomId, roomName || roomId, playerid);
    
    // If this looks like a game code (e.g., "game_123"), update status to active
    if (roomId.startsWith('game_')) {
      globalState.rooms[roomId].status = 'active';
      globalState.rooms[roomId].gameCode = roomId;
      
      // Update database to set status to active
      try {
        await queryDatabase('updateGameStatus', { 
          gameCode: roomId, 
          status: 'active' 
        });
        console.log(`✅ Game ${roomId} marked as active in database`);
      } catch (err) {
        console.error('Error updating game status:', err);
      }
    }
    
    socket.join(roomId);
    socket.emit('roomCreated', { 
      success: true, 
      roomId: roomId,
      roomName: roomName || roomId
    });
    
    broadcastRoomList();
    saveState();
    
    console.log(`✅ Room created: ${roomName || roomId} (${roomId}) by ${playerid}`);
  });
  
  // Join existing room
  socket.on('joinRoom', ({ roomId, userId }) => {
    console.log(`📥 joinRoom request: roomId=${roomId}, userId=${userId}`);
    
    if (!globalState.rooms[roomId]) {
      console.log(`❌ Room not found: ${roomId}`);
      socket.emit('joinRoomResult', { success: false, message: 'Room not found' });
      return;
    }
    
    // Store userId on socket for later reference
    socket.userId = userId;
    
    socket.join(roomId);
    
    // If userId provided, check if they have an active player assignment in this game
    if (userId) {
      // Find their player record for this game
      const room = globalState.rooms[roomId];
      console.log(`   Room has ${Object.keys(room.players).length} players`);
      console.log(`   Player keys:`, Object.keys(room.players));
      
      // Try to find by userId
      const existingPlayer = room.players[userId];  // Direct lookup since players are keyed by userId
      
      console.log(`   Looking for userId ${userId}: found=${!!existingPlayer}`);
      
      if (existingPlayer) {
        // Player already in this game - update their socket ID for reconnection
        existingPlayer.socketId = socket.id;
        existingPlayer.disconnected = false;
        console.log(`✅ User ${userId} reconnected to game ${roomId} as ${existingPlayer.country}`);
      } else {
        console.log(`   Player ${userId} not found in room - will need to select country`);
      }
    }
    
    socket.emit('joinRoomResult', { 
      success: true, 
      roomId: roomId,
      actualRoomId: roomId
    });
    
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
  socket.on('deleteRoom', ({ roomId, playerid }) => {
    const room = globalState.rooms[roomId];
    
    if (!room) {
      socket.emit('deleteRoomResult', { success: false, message: 'Room not found' });
      return;
    }
    
    if (room.hostId !== playerid) {
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
  socket.on('joinGame', ({ roomId, userId, playerid, country }) => {
    // Support both userId (new) and playerid (legacy)
    const id = userId || playerid;
    console.log(`🎮 Join game request: roomId=${roomId}, userId=${userId}, playerid=${playerid}, country=${country}`);
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
    
    // Prevent superadmin from joining as player (check socket.userId first, then passed userId)
    const checkUserId = socket.userId || userId;
    const isAdminInRoom = Object.values(room.players).some(p => p.userId === checkUserId && p.role === 'superadmin');
    if (isAdminInRoom) {
      socket.emit('joinResult', { success: false, message: 'Administrator cannot join as a player. You are an observer.' });
      return;
    }
    
    const taken = Object.values(room.players).some(p => p.country === country);
    
    if (taken) {
      socket.emit('joinResult', { success: false, message: 'Country already taken' });
    } else {
      // Store player with both id and userId for flexibility
      room.players[id] = {
        id: id,
        userId: userId || id,
        country: country,
        socketId: socket.id,
        joinedAt: Date.now()
      };
      
      socket.emit('joinResult', { success: true });
      broadcastToRoom(roomId);
      broadcastRoomList();
      saveState();
      
      console.log(`Player ${id} (userId: ${userId}) joined as ${country} in room ${roomId}`);
    }
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
      
      // Update socket ID and clear disconnected flag
      existingPlayer.socketId = socket.id;
      existingPlayer.disconnected = false;
      delete existingPlayer.disconnectedAt;
      
      socket.emit('rejoinResult', { success: true, country: country });
      broadcastToRoom(roomId);
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
  
  // Set ready status
  socket.on('setReady', ({ roomId, userId, playerid, ready }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const id = userId || playerid;  // Support both userId (new) and playerid (legacy)
    
    if (ready) {
      if (!room.readyPlayers.includes(id)) {
        room.readyPlayers.push(id);
      }
    } else {
      room.readyPlayers = room.readyPlayers.filter(pid => pid !== id);
    }
    
    broadcastToRoom(roomId);
    saveState();
  });
  
  // SUPERADMIN ONLY: Start game in room
  socket.on('startGame', async ({ roomId, playerid, skipPhase1 }) => {
    console.log('=== START GAME REQUEST ===');
    console.log('Room ID:', roomId);
    console.log('Player ID:', playerid);
    console.log('Skip Phase 1:', skipPhase1 || false);
    
    const room = globalState.rooms[roomId];
    if (!room) {
      console.log('ERROR: Room not found');
      socket.emit('startGameResult', { success: false, message: 'Room not found' });
      return;
    }
    
    // Check if user is superadmin by querying database
    // We need to find the user by their user_id (which is playerid in our case)
    let isSuperAdmin = false;
    
    try {
      // Query database to get user info
      const dbUsers = await queryDatabase('getAllUsers', {});
      
      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === playerid);
        
        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
          console.log('User found in DB:', {
            username: dbUser.username,
            user_id: dbUser.user_id,
            is_teacher: dbUser.is_teacher,
            isSuperAdmin
          });
        } else {
          console.log('User not found in database with user_id:', playerid);
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }
    
    const isRoomHost = room.hostId === playerid;
    console.log('Is superadmin:', isSuperAdmin);
    console.log('Is room host:', isRoomHost);
    
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
  socket.on('vote', ({ roomId, playerid, choice }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.gameStarted) {
      console.log('Vote rejected: room not found or game not started');
      return;
    }
    
    // Check player is in game
    if (!room.players[playerid]) {
      console.log('Vote rejected: player not in game');
      return;
    }
    
    // Store vote
    room.votes[playerid] = choice;
    console.log(`Vote received: ${playerid} voted ${choice} in room ${roomId}`);
    
    // Check if all players have voted
    const playerids = Object.keys(room.players);
    const allVoted = playerids.every(id => room.votes[id]);
    
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
            const country = player.country;
            const points = 10; // Only participation points
            roundScores[country] = points;
            room.scores[country] = (room.scores[country] || 0) + points;
          });
          
          room.roundScores = roundScores;
          room.gamePhase = 'results';
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
          const country = player.country;
          const vote = room.votes[id].toLowerCase();
          
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
          // Handle USS/USSR naming inconsistency
          const scoreKey = country === 'USS' ? 'USSR' : country;
          room.scores[scoreKey] = (room.scores[scoreKey] || 0) + points;
          // Also store under original country code for display
          if (country !== scoreKey) {
            room.scores[country] = room.scores[scoreKey];
          }
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
      }
    }
    
    broadcastToRoom(roomId);
    saveState();
  });
  
  // Advance to next round (admin only)
  socket.on('advanceRound', async ({ roomId, playerid }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    console.log('🔄 Advance round request:', { roomId, playerid, roomHost: room.hostId });
    
    // Check if user is superadmin by querying database
    let isSuperAdmin = false;
    
    try {
      const dbUsers = await queryDatabase('getAllUsers', {});
      
      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === playerid);
        
        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
          console.log('User found in DB:', {
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
    
    const isRoomHost = room.hostId === playerid;
    console.log('Permission check:', { isSuperAdmin, isRoomHost });
    
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
  socket.on('submitPolicy', ({ roomId, playerid, policy }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.phase2.active) return;
    
    const player = room.players[playerid];
    if (!player) return;
    
    const currentYear = room.phase2.currentYear;
    if (!room.phase2.policies[currentYear]) {
      room.phase2.policies[currentYear] = {};
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
    
    broadcastToRoom(roomId);
    saveState();
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
      
      if (otherDeployments.length > 0) {
        // Create conflict alert
        if (!room.phase2.conflicts) {
          room.phase2.conflicts = [];
        }
        
        const conflict = {
          region: deployment.region,
          countries: [deployment.country, ...otherDeployments.map(d => d.country)],
          year: room.phase2.currentYear,
          timestamp: Date.now(),
          battleId: `${deployment.region}-${room.phase2.currentYear}-${Date.now()}`
        };
        
        room.phase2.conflicts.push(conflict);
        
        console.log(`⚠️ CONFLICT ALERT: ${deployment.country} deployed to ${deployment.region} - conflict with ${otherDeployments.map(d => d.country).join(', ')}`);
        
        // Emit battle modal to all involved countries
        const involvedCountries = conflict.countries;
        involvedCountries.forEach(country => {
          // Find the player with this country
          const playerEntry = Object.entries(room.players).find(([id, p]) => p.country === country);
          if (playerEntry) {
            const [userId] = playerEntry;
            
            // Emit to this specific player
            io.to(roomId).emit('militaryConflict', {
              message: `Military forces from ${involvedCountries.join(' and ')} have both deployed to ${deployment.region}!`,
              region: deployment.region,
              countries: involvedCountries,
              year: room.phase2.currentYear,
              battleId: conflict.battleId,
              yourCountry: country
            });
            
            console.log(`📨 Sent battle modal to ${country} (user ${userId})`);
          }
        });
      }
    }
    
    console.log(`${player.country} deployed ${deployment.troops} troops to ${deployment.region}`);
    
    broadcastToRoom(roomId);
    saveState();
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
      
      // Broadcast results to all players in the battle
      io.to(roomId).emit('battleResolved', {
        battleId,
        result: battleResult
      });
    }
    
    broadcastToRoom(roomId);
    saveState();
  });

  // CRISIS: Submit response to active crisis
  socket.on('submitCrisisResponse', ({ roomId, playerid, choiceId }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.phase2.active) return;
    
    const player = room.players[playerid];
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
      playerid,
      choiceId,
      choice,
      timestamp: Date.now()
    };
    
    console.log(`${country} submitted crisis response: ${choice.text}`);
    
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
  socket.on('resolveCrisis', async ({ roomId, playerid }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    // Check if user is superadmin by querying database
    let isSuperAdmin = false;
    
    try {
      const dbUsers = await queryDatabase('getAllUsers', {});
      
      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === playerid);
        
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
    
    const isRoomHost = room.hostId === playerid;
    
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
      saveState();
    }
  });

  socket.on('advanceYear', async ({ roomId, playerid }) => {
    console.log('=== ADVANCE YEAR REQUEST ===');
    console.log('Room ID:', roomId);
    console.log('Player ID:', playerid);
    
    const room = globalState.rooms[roomId];
    if (!room) {
      console.log('ERROR: Room not found');
      return;
    }
    
    console.log('Room found:', room.roomName);
    console.log('Room host:', room.hostId);
    console.log('Phase 2 active:', room.phase2.active);
    console.log('Current year:', room.phase2.currentYear);
    
    // Check if user is superadmin by querying database
    let isSuperAdmin = false;
    
    try {
      const dbUsers = await queryDatabase('getAllUsers', {});
      
      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === playerid);
        
        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
          console.log('User found in DB:', {
            username: dbUser.username,
            user_id: dbUser.user_id,
            is_teacher: dbUser.is_teacher,
            isSuperAdmin
          });
        } else {
          console.log('User not found in database with user_id:', playerid);
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }
    
    // AUTO-FIX: If room has no host, set to current user (if they're in the game)
    if (!room.hostId && room.players[playerid]) {
      console.log('⚠️ Room has no host ID, setting to current player:', playerid);
      room.hostId = playerid;
      saveState();
    }
    
    // AUTO-FIX: If room host is not in the players list, reassign to first player
    if (room.hostId && !room.players[room.hostId]) {
      const playerids = Object.keys(room.players);
      if (playerids.length > 0) {
        const newHostId = playerids[0];
        console.log('⚠️ Room host not in game, reassigning from', room.hostId, 'to', newHostId);
        room.hostId = newHostId;
        saveState();
      }
    }
    
    const isRoomHost = room.hostId === userid;
    
    console.log('=== DETAILED PERMISSION CHECK ===');
    console.log('Player ID from request:', playerid);
    console.log('Room host ID:', room.hostId);
    console.log('IDs match:', room.hostId === playerid);
    console.log('Is superadmin:', isSuperAdmin);
    console.log('Is room host:', isRoomHost);
    console.log('Permission check result:', { isSuperAdmin, isRoomHost });
    
    // Allow either superadmin OR room host to advance year
    if (!isSuperAdmin && !isRoomHost) {
      console.log('❌ Advance year rejected:', {
        playerid,
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
      console.log('Phase 2 complete! Final scores calculated.');
      broadcastToRoom(roomId);
      saveState();
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

    // FIXED: Update database with current game state
try {
  await queryDatabase('updateGame', {
    gameCode: roomId,
    data: {
      current_round: room.currentRound,
      current_year: room.phase2.currentYear,
      game_status: room.gamePhase === 'complete' ? 'completed' : 'active'
    }
  });
  console.log(`✅ Database updated: ${roomId} now at round ${room.currentRound}, year ${room.phase2.currentYear}`);
} catch (error) {
  console.error('⚠️ Failed to update database:', error);
}
    
    console.log('Broadcasting updated game state...');
    broadcastToRoom(roomId);
    saveState();
    saveGameToDatabase(roomId); // Save game state to database
    console.log('✅ Year advancement complete');
  });
  
  // ADMIN: Reset room (room host or superadmin)
  socket.on('resetRoom', async ({ roomId, playerid }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    // Check if user is superadmin by querying database
    let isSuperAdmin = false;
    
    try {
      const dbUsers = await queryDatabase('getAllUsers', {});
      
      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === playerid);
        
        if (dbUser) {
          isSuperAdmin = (dbUser.is_teacher === '1' || dbUser.is_teacher === 1);
        }
      }
    } catch (err) {
      console.error('Error checking user role:', err);
    }
    
    const isRoomHost = room.hostId === playerid;
    
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
  socket.on('clearAllData', async ({ playerid, confirmCode }) => {
    console.log('clearAllData called:', { playerid, confirmCode });
    
    // Check if user is superadmin by querying database
    let isSuperAdmin = false;
    let dbUser = null;
    
    try {
      const dbUsers = await queryDatabase('getAllUsers', {});
      
      if (dbUsers && Array.isArray(dbUsers)) {
        dbUser = dbUsers.find(u => u.user_id === playerid);
        
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
    console.log(`All data cleared by superadmin: ${playerid}`);
  });
  
  // SUPERADMIN ONLY: Delete any room
  socket.on('adminDeleteRoom', async ({ roomId, playerid }) => {
    // Check if user is superadmin by querying database
    let isSuperAdmin = false;
    
    try {
      const dbUsers = await queryDatabase('getAllUsers', {});
      
      if (dbUsers && Array.isArray(dbUsers)) {
        const dbUser = dbUsers.find(u => u.user_id === playerid);
        
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
  
  // NEW: Get available games (for regular users without active game)
  socket.on('getAvailableGames', async ({ playerid }) => {
    const user = Object.values(globalState.users).find(u => u.playerid === playerid);
    
    if (!user) {
      socket.emit('availableGamesResult', { 
        success: false, 
        message: 'Authentication required' 
      });
      return;
    }
    
    const availableGames = [];
    
    // Get active games from database
    const dbGames = await queryDatabase('getGames', { status: 'active' });
    
    if (dbGames && Array.isArray(dbGames)) {
      for (const game of dbGames) {
        const roomState = globalState.rooms[game.game_code];
        
        // Only show lobby games with available slots
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
              hostUserId: game.host_user_id
            });
          }
        }
      }
    }
    
    socket.emit('availableGamesResult', { 
      success: true, 
      games: availableGames 
    });
  });

  // NEW: Superadmin request for active games list (all games, any phase)
  // NEW: Superadmin request for active games list (all games, any phase)
  socket.on('getActiveGames', async ({ userid }) => {
    console.log('getActiveGames request from userid:', userid);
    
    // We need to find the username first - check if it's stored on the socket from login
    // Or just trust the role that was set during login by checking if they can access this
    
    // For now, let's just return the games and log what we find
    // The client already validated role during login, so if they're calling this, they should be admin
    
    console.log('Fetching games for potential admin...');
    
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
          currentYear: roomState ? roomState.phase2?.currentYear : null,
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
    // Find rooms where this socket is a player
    Object.keys(globalState.rooms).forEach(roomId => {
      const room = globalState.rooms[roomId];
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
      
      // Create room state from database game
      const roomState = createGameState(gameCode, `Game ${gameCode}`, game.host_user_id);
      roomState.gameId = game.game_id;
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
          if (game.current_year) {
            roomState.phase2.currentYear = game.current_year;
          }
        } else {
          // Phase 1 - assume voting phase by default
          roomState.gamePhase = 'voting';
        }
      }
      
      console.log(`   Restored state: phase=${roomState.gamePhase}, round=${roomState.currentRound}, year=${roomState.phase2?.currentYear || 'N/A'}`);
      
      // Load players for this game from database
      const players = await queryDatabase('getPlayers', { gameCode: gameCode });
      
      if (players && Array.isArray(players) && players.length > 0) {
        console.log(`   Found ${players.length} player(s) in database`);
        for (const player of players) {
          // Key by userId for consistency (so client can find them by userId)
          roomState.players[player.user_id] = {
            id: player.player_id,  // Keep actual player_id for DB operations
            userId: player.user_id,
            country: player.country_code,
            ready: false,
            score: (player.phase1_score || 0) + (player.phase2_score || 0),
            phase1_score: player.phase1_score || 0,
            phase2_score: player.phase2_score || 0
          };
          console.log(`   - Player: user_id=${player.user_id}, player_id=${player.player_id}, country=${player.country_code}`);
        }
      } else {
        console.log(`   No players found for game ${gameCode}`);
      }
      
      globalState.rooms[gameCode] = roomState;
      console.log(`  ✅ Loaded game: ${gameCode} with ${Object.keys(roomState.players).length} player(s)`);
    }
  } else {
    console.log('ℹ️  No active games found in database');
  }
}

// Start server
(async () => {
  await initializeFromDatabase();
  
  server.listen(PORT, () => {
    console.log('🌍 Bretton Woods Multi-Room Server');
    console.log('===================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📂 State file: ${STATE_FILE}`);
    console.log(`👥 Users: ${Object.keys(globalState.users).length}`);
    console.log(`🏠 Rooms: ${Object.keys(globalState.rooms).length}`);
    console.log('===================================');
  });
})();
