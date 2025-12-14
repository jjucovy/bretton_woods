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
      achievements: {}
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
  console.log('📝 Creating main game room...');
  globalState.rooms[SINGLE_ROOM_ID] = createGameState(
    SINGLE_ROOM_ID,
    'Bretton Woods 1944',
    null // No specific host in single-room mode
  );
  updateRoomList();
  saveState();
  console.log('✅ Main game room auto-created:', SINGLE_ROOM_ID);
} else {
  console.log('✅ Main game room already exists:', SINGLE_ROOM_ID);
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
      industrialOutput: initialData.industrialOutput
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
    const militarySize = policy.militarySize || 500000;
    
    // Base growth rate (post-war boom)
    let gdpGrowth = 4.0;
    
    // === MILITARY ECONOMIC IMPACT ===
    // Military spending as % of GDP
    const milSpending = militarySpending || 5;
    const milSize = militarySize || 500000;
    
    // High military spending drains civilian economy
    if (milSpending > 10) {
      gdpGrowth -= (milSpending - 10) * 0.15; // Each % above 10 hurts growth
    }
    
    // But some military spending stimulates industry (Keynesian effect)
    if (milSpending >= 5 && milSpending <= 8) {
      gdpGrowth += 0.3; // Optimal military-industrial stimulus
    }
    
    // Large standing army reduces civilian workforce
    const laborForceImpact = (milSize / 1000000) * -0.2; // Per million troops
    gdpGrowth += laborForceImpact;
    
    // Central bank rate impact
    const optimalCBRate = 3.0;
    const cbRateDeviation = Math.abs(centralBankRate - optimalCBRate);
    gdpGrowth -= cbRateDeviation * 0.5;
    
    // === DYNAMIC TRADE EFFECTS ===
    // Calculate trade competitiveness vs other countries
    let tradeCompetitiveness = 0;
    let tradeBalance = prevData.tradeBalance;
    
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
      const otherMilSize = otherPolicy.militarySize || 500000;
      
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
        if (otherMilSize > milSize * 1.5) {
          gdpGrowth -= 0.3; // Lost influence hurts economy
          tradeBalance -= 200; // Less favorable trade terms
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
      militarySize: milSize
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
    
    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Only jjucovy@gmail.com is the super admin
    const isSuperAdmin = username.toLowerCase() === 'jjucovy@gmail.com' || username.toLowerCase() === 'jjucovy';
    
    globalState.users[username] = {
      password: hashPassword(password),
      playerId: playerId,
      createdAt: Date.now(),
      role: isSuperAdmin ? 'superadmin' : 'player'
    };
    
    socket.emit('registerResult', { 
      success: true, 
      playerId: playerId,
      username: username,
      role: isSuperAdmin ? 'superadmin' : 'player'
    });
    
    saveState();
    console.log(`User registered: ${username} (${isSuperAdmin ? 'SUPER ADMIN' : 'player'})`);
  });
  
  // Login existing user
  socket.on('login', ({ username, password }) => {
    console.log('=== LOGIN REQUEST ===');
    console.log('Username:', username);
    
    if (!username || !password) {
      socket.emit('loginResult', { success: false, message: 'Username and password required' });
      return;
    }
    
    const user = globalState.users[username];
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
    
    socket.emit('loginResult', { 
      success: true, 
      playerId: user.playerId, 
      username: username,
      role: role
    });
    
    console.log(`User logged in: ${username} (${role})`);
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
    
    console.log(`Room created: ${roomName} (${roomId}) by ${playerId}`);
  });
  
  // Join existing room
  socket.on('joinRoom', ({ roomId }) => {
    if (!globalState.rooms[roomId]) {
      socket.emit('joinRoomResult', { success: false, message: 'Room not found' });
      return;
    }
    
    socket.join(roomId);
    socket.emit('joinRoomResult', { 
      success: true, 
      roomId: roomId 
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
  socket.on('startGame', ({ roomId, playerId }) => {
    console.log('=== START GAME REQUEST ===');
    console.log('Room ID:', roomId);
    console.log('Player ID:', playerId);
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
    console.log('Is superadmin:', isSuperAdmin);
    
    if (!isSuperAdmin) {
      console.log('ERROR: Not superadmin');
      socket.emit('startGameResult', { 
        success: false, 
        message: `Only the administrator can start games. Your role: ${user ? user.role : 'not found'}` 
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
    room.gamePhase = 'voting';
    room.currentRound = 1;
    
    console.log('SUCCESS: Game started!');
    socket.emit('startGameResult', { success: true });
    broadcastToRoom(roomId);
    broadcastRoomList();
    saveState();
    
    console.log(`Game started in room ${roomId} by superadmin`);
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
      
      // Determine winning option (most votes)
      let winningOption = 'a';
      let maxVotes = voteTally.a;
      if (voteTally.b > maxVotes) {
        winningOption = 'b';
        maxVotes = voteTally.b;
      }
      if (voteTally.c > maxVotes) {
        winningOption = 'c';
        maxVotes = voteTally.c;
      }
      
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
        room.scores[country] = (room.scores[country] || 0) + points;
      });
      
      // Store results
      room.voteTally = voteTally;
      room.roundScores = roundScores;
      room.gamePhase = 'results';
      
      console.log(`Round ${room.currentRound} results:`, { 
        voteTally, 
        winningOption: room.roundOutcome 
      });
    }
    
    broadcastToRoom(roomId);
    saveState();
  });
  
  // Advance to next round (admin only)
  socket.on('advanceRound', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    const isSuperAdmin = user && user.role === 'superadmin';
    
    if (!isSuperAdmin) {
      console.log('Advance round rejected: not superadmin');
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
    const room = globalState.rooms[roomId];
    if (!room || !room.phase2.active) return;
    
    const player = room.players[playerId];
    if (!player) return;
    
    const currentYear = room.phase2.currentYear;
    if (!room.phase2.policies[currentYear]) {
      room.phase2.policies[currentYear] = {};
    }
    
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
    
    console.log(`Player ${playerId} (${player.country}) submitted policy for ${currentYear}`);
    
    // Mark ready
    if (!room.readyPlayers.includes(playerId)) {
      room.readyPlayers.push(playerId);
    }
    
    broadcastToRoom(roomId);
    saveState();
  });
  
  // PHASE 2: Advance to next year
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
    
    console.log(`${player.country} deployed ${deployment.troops} troops to ${deployment.region}`);
    
    broadcastToRoom(roomId);
    saveState();
  });

  socket.on('advanceYear', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    const isSuperAdmin = user && user.role === 'superadmin';
    
    if (!isSuperAdmin) {
      console.log('Advance year rejected: not superadmin');
      return;
    }
    
    if (!room.phase2.active) return;
    
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
    calculateYearEconomics(roomId);
    
    // Advance year
    room.phase2.currentYear++;
    room.readyPlayers = [];
    
    console.log(`Advanced to year ${room.phase2.currentYear}`);
    
    // Check if we've reached the final year
    if (room.phase2.currentYear >= 1952) {
      console.log('Reached final year 1952. Next advance will complete Phase 2.');
    }
    
    broadcastToRoom(roomId);
    saveState();
  });
  
  // SUPERADMIN ONLY: Reset room
  socket.on('resetRoom', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    const isSuperAdmin = user && user.role === 'superadmin';
    
    if (!isSuperAdmin) {
      socket.emit('resetRoomResult', { success: false, message: 'Only the administrator can reset games' });
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

// Start server
server.listen(PORT, () => {
  console.log('🌍 Bretton Woods Multi-Room Server');
  console.log('===================================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📂 State file: ${STATE_FILE}`);
  console.log(`👥 Users: ${Object.keys(globalState.users).length}`);
  console.log(`🏠 Rooms: ${Object.keys(globalState.rooms).length}`);
  console.log('===================================');
});
