<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "http://www.w3.org/TR/REC-html40/loose.dtd">
<html>

<body>
    <p>// server-multiroom.js - Bretton Woods Multi-Room Server (FIXED)
        const express = require('express');
        const http = require('http');
        const socketIo = require('socket.io');
        const path = require('path');
        const fs = require('fs');
        const crypto = require('crypto');

        // Database module for MySQL persistence
        const db = require('./db');

        // Country code to full name mapping for voting checks
        // FIXED: Consistent mapping that works with both database and game data
        const COUNTRY_CODE_TO_NAME = {
        'USA': 'USA',
        'UK': 'UK',
        'USS': 'USSR', // Database code
        'USSR': 'USSR', // Game data code (for compatibility)
        'FRA': 'France',
        'CHN': 'China',
        'China': 'China', // For compatibility
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
        return await operation(...args);
        } catch (err) {
        console.warn(`[DB Sync] ${operation.name || 'operation'} failed: ${err.message}`);
        return null;
        }
        }

        // Cache for user IDs (username -&gt; user_id from MySQL)
        const userIdCache = {};

        // FIXED: Consistent player ID generation
        function normalizePlayerId(playerId) {
        // If already has prefix, return as-is
        if (playerId.startsWith('player_db_') || playerId.startsWith('player_')) {
        return playerId;
        }
        // If it's just a number (user_id from DB), add prefix
        if (!isNaN(playerId)) {
        return `player_db_${playerId}`;
        }
        return playerId;
        }

        // Get MySQL user_id for a username
        async function getUserId(username) {
        if (userIdCache[username]) return userIdCache[username];
        try {
        const user = await db.getUser(username);
        if (user &amp;&amp; user.user_id) {
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

        // Serve game HTML as the main page
        app.get('/', (req, res) =&gt; {
        res.sendFile(path.join(__dirname, 'index.html'));
        });

        // Diagnostic endpoint
        app.get('/debug/users', (req, res) =&gt; {
        const userList = Object.entries(globalState.users).map(([username, data]) =&gt; ({
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

        // Serve static files
        app.use(express.static(__dirname));

        // Multi-room game state
        let globalState = {
        users: {},
        rooms: {},
        roomList: []
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
        maxYears: 7,
        policies: {},
        yearlyData: {},
        achievements: {},
        crises: {
        active: null,
        history: [],
        responses: {}
        }
        },
        maxPlayers: 7,
        createdAt: Date.now(),
        autoAdvance: true,
        autoAdvanceDelay: 5000
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

        console.log('&#9989; Multi-room state loaded from file');
        console.log(` - Users: ${Object.keys(globalState.users).length}`);
        console.log(` - Rooms: ${Object.keys(globalState.rooms).length}`);
        } else {
        console.log('&#128221; No saved state found, using defaults');
        }
        } catch (err) {
        console.error('&#10060; Error loading state:', err);
        console.log('&#9888;&#65039; Using default state');
        }
        }

        function saveState() {
        try {
        if (fs.existsSync(STATE_FILE)) {
        const backupFile = STATE_FILE.replace('.json', '-backup.json');
        fs.copyFileSync(STATE_FILE, backupFile);
        }

        fs.writeFileSync(STATE_FILE, JSON.stringify(globalState, null, 2));
        console.log('&#128190; Multi-room state saved');
        } catch (err) {
        console.error('&#10060; Error saving state:', err);
        }
        }

        // Load state on startup
        loadState();

        // Try to load users from MySQL if local state is empty
        async function loadUsersFromDB(retries = 3) {
        if (Object.keys(globalState.users).length === 0) {
        console.log('&#128202; Attempting to load users from MySQL...');
        for (let attempt = 1; attempt {
        globalState.users[user.username] = {
        password: user.password_hash,
        playerId: `player_db_${user.user_id}`,
        userId: user.user_id, // FIXED: Store userId for easy lookups
        createdAt: user.created_at ? new Date(user.created_at).getTime() : Date.now(),
        role: (user.is_teacher === '1' || user.is_teacher === 1) ? 'superadmin' : 'player'
        };
        });
        if (users.length &gt; 0) {
        console.log(`&#9989; Loaded ${users.length} users from MySQL`);
        saveState();
        } else {
        console.log('&#8505;&#65039; No users in MySQL database yet');
        }
        return;
        } catch (err) {
        console.warn(`&#9888;&#65039; MySQL connection attempt ${attempt}/${retries} failed: ${err.message}`);
        if (attempt setTimeout(resolve, 5000));
        }
        }
        }
        console.log('&#8505;&#65039; MySQL unavailable - server will use local state and sync when DB is available');
        } else {
        console.log(`&#8505;&#65039; Using ${Object.keys(globalState.users).length} users from local state`);
        }
        }

        loadUsersFromDB();

        // ============================================
        // EXPORT/IMPORT GAME STATE
        // ============================================

        app.get('/api/export-state/:roomId', (req, res) =&gt; {
        const { roomId } = req.params;
        const room = globalState.rooms[roomId];

        if (!room) {
        return res.status(404).json({ error: 'Room not found' });
        }

        const exportData = {
        exportedAt: new Date().t</p>
</body>

</html>
