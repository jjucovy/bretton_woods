// DEPLOYMENT SYSTEM INTEGRATION GUIDE
// How to integrate deployment-impacts.js into server-multiroom.js

// ============================================
// STEP 1: Add import at top of file (after db require)
// ============================================

// Add this line after: const db = require('./db');
const deploymentSystem = require('./deployment-impacts');

// ============================================
// STEP 2: Update deployTroops handler to use new branch system
// ============================================

// REPLACE the existing deployTroops handler with:
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
  
  // NEW: Validate deployment has required fields
  if (!deployment.branch || !['army', 'navy', 'airForce'].includes(deployment.branch)) {
    socket.emit('deploymentError', { message: 'Invalid military branch' });
    return;
  }
  
  if (!deployment.region || !deploymentSystem.REGIONS[deployment.region]) {
    socket.emit('deploymentError', { message: 'Invalid region' });
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
  
  // NEW: Use deployment system to detect conflicts
  const conflicts = deploymentSystem.detectDeploymentConflicts(
    room.phase2.deployments, 
    room.phase2.currentYear
  );
  
  // Store conflicts
  room.phase2.conflicts = conflicts;
  
  if (conflicts.length > 0) {
    const relevantConflict = conflicts.find(c => c.region === deployment.region);
    if (relevantConflict) {
      console.log(`⚠️ CONFLICT (${relevantConflict.level}): ${relevantConflict.description}`);
      
      // Send alert to all players in conflict
      relevantConflict.countries.forEach(country => {
        const conflictPlayer = Object.values(room.players).find(p => p.country === country);
        if (conflictPlayer?.socketId) {
          io.to(conflictPlayer.socketId).emit('conflictAlert', {
            region: deployment.region,
            level: relevantConflict.level,
            message: `Military tension in ${deployment.region}!`
          });
        }
      });
    }
  }
  
  console.log(`${player.country} deployed ${deployment.troops} ${deployment.branch} to ${deployment.region}`);
  
  // Sync deployment to MySQL
  (async () => {
    const username = Object.keys(globalState.users).find(u => globalState.users[u].playerId === playerId);
    const userId = username ? await getUserId(username) : null;
    if (userId) {
      await dbSync(db.saveDeployment, room.gameCode, userId, {
        country: deployment.country,
        region: deployment.region,
        branch: deployment.branch,
        troops: deployment.troops,
        year: room.phase2.currentYear
      });
      console.log(`📊 Deployment synced to MySQL: ${username} (${deployment.region})`)
    }
  })();
  
  broadcastToRoom(roomId);
  saveState();
});

// ============================================
// STEP 3: Integrate deployment effects into calculateYearEconomics
// ============================================

// FIND the section in calculateYearEconomics that says:
// "// Store results"
// tempResults[country] = { ... }

// REPLACE that entire section with:

    // NEW: Apply deployment effects BEFORE storing results
    const deploymentEffects = deploymentSystem.applyDeploymentEffects(
      room,
      country,
      room.phase2.deployments || [],
      tempResults[country],
      currentYear
    );
    
    // Add deployment bonuses to economics
    tempResults[country].gdpGrowth += deploymentEffects.gdpGrowth;
    tempResults[country].tradeBalance += deploymentEffects.tradeBalance;
    
    // Store deployment details for display
    tempResults[country].deploymentBonuses = {
      gdpBonus: deploymentEffects.gdpGrowth,
      tradeBonus: deploymentEffects.tradeBalance,
      influence: deploymentEffects.influence,
      details: deploymentEffects.details,
      regionalControl: deploymentEffects.regionalControl
    };
    
    console.log(`   📍 Deployment effects for ${country}:`, {
      gdp: deploymentEffects.gdpGrowth.toFixed(2),
      trade: Math.round(deploymentEffects.tradeBalance),
      details: deploymentEffects.details.join('; ')
    });
    
    // Store all results (keep existing code)
    // tempResults[country] = { ... existing fields ... };

// ============================================
// STEP 4: Add deployment info to crisis responses
// ============================================

// FIND the submitCrisisResponse handler

// ADD this code after the line:
// if (!choice) { console.log(...); return; }

  // NEW: Check deployment bonuses for crisis response
  const deploymentBonus = deploymentSystem.getCrisisDeploymentBonus(
    country,
    crisis,
    room.phase2.deployments || [],
    deploymentSystem.calculateRegionalControl(room.phase2.deployments || [], currentYear)
  );
  
  // Apply deployment bonus to crisis effects
  if (deploymentBonus.responseBonus > 0) {
    console.log(`${country} gets +${deploymentBonus.responseBonus} diplomatic points from deployments`);
    
    // Add to diplomatic points (will be scored later)
    if (!room.phase2.crisisDeploymentBonuses) {
      room.phase2.crisisDeploymentBonuses = {};
    }
    room.phase2.crisisDeploymentBonuses[country] = 
      (room.phase2.crisisDeploymentBonuses[country] || 0) + deploymentBonus.responseBonus;
  }

// ============================================
// STEP 5: Add deployment influence to Phase 2 scoring
// ============================================

// FIND the calculatePhase2Scores function

// ADD this code in the scoring loop (after the breakdown.brettonWoods section):

      // NEW: Deployment influence points
      if (room.phase2.deployments) {
        const influence = deploymentSystem.calculateDiplomaticInfluence(
          room.phase2.deployments,
          deploymentSystem.calculateRegionalControl(room.phase2.deployments, 1952),
          1952
        );
        
        if (influence[country]) {
          const influencePoints = influence[country].total;
          breakdown.deploymentInfluence = influencePoints;
          score += influencePoints;
          
          console.log(`   ${country} deployment influence: ${influencePoints} pts (${influence[country].controlledRegions.length} regions controlled)`);
        }
      }
      
      // Crisis deployment bonuses
      if (room.phase2.crisisDeploymentBonuses && room.phase2.crisisDeploymentBonuses[country]) {
        const crisisBonus = room.phase2.crisisDeploymentBonuses[country] * 2; // 2 pts per bonus
        breakdown.crisisDeploymentBonus = crisisBonus;
        score += crisisBonus;
      }

// ============================================
// STEP 6: Add API endpoint to view deployment map
// ============================================

// ADD this new endpoint before the socket.io connection handler:

app.get('/api/deployment-map/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = globalState.rooms[roomId];
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const currentYear = room.phase2?.currentYear || 1946;
  const deployments = room.phase2?.deployments || [];
  
  // Calculate regional control
  const regionalControl = deploymentSystem.calculateRegionalControl(deployments, currentYear);
  
  // Calculate diplomatic influence
  const influence = deploymentSystem.calculateDiplomaticInfluence(
    deployments, 
    regionalControl, 
    currentYear
  );
  
  // Get conflicts
  const conflicts = deploymentSystem.detectDeploymentConflicts(deployments, currentYear);
  
  res.json({
    year: currentYear,
    regions: deploymentSystem.REGIONS,
    control: regionalControl,
    influence: influence,
    conflicts: conflicts,
    deployments: deployments.filter(d => d.year === currentYear)
  });
});

// ============================================
// COMPLETE INTEGRATION
// ============================================

// After all these changes:
// 1. Deployments will affect GDP growth and trade balance
// 2. Regional control gives bonuses
// 3. Naval deployments protect trade routes
// 4. Conflicts are properly detected
// 5. Crisis responses get deployment bonuses
// 6. Final scoring includes deployment influence
