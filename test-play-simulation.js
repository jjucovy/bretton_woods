#!/usr/bin/env node
// test-play-simulation.js
// Full automated play-through of the Bretton Woods simulation.
// Requires the server to be running with the mock database:
//   node server-test-entry.js
'use strict';

const { io } = require('socket.io-client');
const gameDataFile = require('./game-data.json');

const SERVER_URL = 'http://localhost:65002';
const COUNTRIES = ['USA', 'UK', 'USSR', 'France', 'China', 'India', 'Argentina'];
const ROOM_NAME  = `sim_test_${Date.now()}`;

// ── helpers ──────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else       { console.error(`  ❌ FAIL: ${msg}`); failed++; }
}
function section(msg) { console.log(`\n${'─'.repeat(62)}\n${msg}`); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Connect and return a socket with a promise-based request helper.
function connect(label) {
  const socket = io(SERVER_URL, { transports: ['websocket'] });
  socket._label = label;
  // Listen for stateUpdate so any handler can await it
  socket._stateUpdates = [];
  socket._stateListeners = [];
  socket.on('stateUpdate', state => {
    socket._stateUpdates.push(state);
    socket._stateListeners.splice(0).forEach(fn => fn(state));
  });

  socket.nextState = () => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: stateUpdate timeout`)), 10000);
    socket._stateListeners.push(state => { clearTimeout(t); resolve(state); });
  });

  socket.req = (event, data, responseEvent) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timeout for ${responseEvent}`)), 10000);
    socket.once(responseEvent, payload => { clearTimeout(t); resolve(payload); });
    socket.emit(event, data);
  });

  return new Promise(resolve => socket.once('connect', () => resolve(socket)));
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Attempt to advance a year; if crises block it, force-resolve then retry.
// Uses stateUpdate sequence counting to avoid race conditions.
async function advanceYearWithCrisisHandling(hostClient, roomId, hostId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const beforeCount = hostClient._stateUpdates.length;

    // Race: either a stateUpdate (new state arrives) or advanceYearError
    const outcome = await new Promise(resolve => {
      let done = false;
      const finish = val => { if (!done) { done = true; resolve(val); } };

      const timeout = setTimeout(() => finish({ timeout: true }), 12000);

      const errHandler = e => { clearTimeout(timeout); finish({ error: e }); };
      hostClient.once('advanceYearError', errHandler);

      // Poll for new stateUpdate (arrival after beforeCount)
      const poll = setInterval(() => {
        if (hostClient._stateUpdates.length > beforeCount) {
          clearInterval(poll);
          clearTimeout(timeout);
          hostClient.off('advanceYearError', errHandler);
          finish({ state: hostClient._stateUpdates[hostClient._stateUpdates.length - 1] });
        }
      }, 100);

      hostClient.emit('advanceYear', { roomId, playerId: hostId, playerid: hostId, userId: hostId });
    });

    if (outcome.state) return outcome.state;
    if (outcome.timeout) throw new Error('advanceYear: timed out waiting for state');

    const err = outcome.error;
    if (!err.message?.includes('Crisis')) throw new Error(`advanceYear error: ${err.message}`);

    // Crisis is blocking — force-resolve
    console.log(`\n    ⚡ Crisis detected — force-resolving (attempt ${attempt + 1})`);
    const lastState = hostClient._stateUpdates[hostClient._stateUpdates.length - 1];
    const activeCrises = lastState?.phase2?.crises?.active;
    const crisisList = Array.isArray(activeCrises)
      ? activeCrises : (activeCrises ? [activeCrises] : []);

    if (crisisList.length > 0) {
      for (const crisis of crisisList) {
        if (!crisis?.id) continue;
        const beforeResolve = hostClient._stateUpdates.length;
        hostClient.emit('resolveCrisis', {
          roomId, playerId: hostId, playerid: hostId, userId: hostId, crisisId: crisis.id
        });
        // Wait for the resolve stateUpdate
        await new Promise(r => {
          const t = setTimeout(r, 3000);
          const poll = setInterval(() => {
            if (hostClient._stateUpdates.length > beforeResolve) {
              clearInterval(poll); clearTimeout(t); r();
            }
          }, 100);
        });
      }
    } else {
      const beforeResolve = hostClient._stateUpdates.length;
      hostClient.emit('resolveCrisis', { roomId, playerId: hostId, playerid: hostId, userId: hostId });
      await new Promise(r => {
        const t = setTimeout(r, 3000);
        const poll = setInterval(() => {
          if (hostClient._stateUpdates.length > beforeResolve) {
            clearInterval(poll); clearTimeout(t); r();
          }
        }, 100);
      });
    }

    await delay(200); // brief pause before retry
  }
  throw new Error('advanceYear: too many crisis retries');
}

// ── main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n🎮 BRETTON WOODS — FULL SIMULATION PLAY-THROUGH');
  console.log('='.repeat(62));

  // ── 0. Connect ────────────────────────────────────────────────
  section('PHASE 0: Connecting clients');
  const clients = {};
  for (const c of COUNTRIES) clients[c] = await connect(c);
  assert(true, `${COUNTRIES.length} WebSocket clients connected`);

  // ── 1. Register & Login ───────────────────────────────────────
  section('PHASE 1: Register & Login');
  const ids = {};   // country → userId (string from DB mock)
  const ts = Date.now();

  for (const c of COUNTRIES) {
    const username = `player_${c.toLowerCase()}_${ts}`;
    const password = 'testpass123';

    const reg = await clients[c].req(
      'register', { username, password, email: `${username}@test.com` }, 'registerResult'
    );
    assert(reg.success, `${c}: registered (${username})`);

    const login = await clients[c].req('login', { username, password }, 'loginResult');
    assert(login.success, `${c}: logged in  →  userId=${login.playerid || login.userId}`);
    ids[c] = login.playerid || login.userId;
  }

  // ── 2. Create Room ────────────────────────────────────────────
  section('PHASE 2: Create room (host = USA)');
  const hostId = ids['USA'];
  const roomResult = await clients['USA'].req(
    'createRoom', { playerId: hostId, roomName: ROOM_NAME, userId: hostId }, 'roomCreated'
  );
  assert(roomResult.success, 'Room created');
  const roomId = roomResult.roomId;
  assert(!!roomId, `Room ID = "${roomId}"`);

  // ── 3. Join Room ──────────────────────────────────────────────
  section('PHASE 3: All players join the room');
  for (const c of COUNTRIES) {
    // USA already in room as creator
    if (c !== 'USA') {
      const jr = await clients[c].req(
        'joinRoom', { roomId, userId: ids[c] }, 'joinRoomResult'
      );
      assert(jr.success, `${c}: joined room`);
      await delay(80);
    }
  }

  // ── 4. Select Countries (joinGame) ────────────────────────────
  section('PHASE 4: Select countries');
  for (const c of COUNTRIES) {
    const jg = await clients[c].req(
      'joinGame',
      { roomId, userId: ids[c], playerid: ids[c], country: c },
      'joinResult'
    );
    assert(jg.success, `${c}: selected country`);
    await delay(80);
  }

  // ── 5. Ready Up & Start ───────────────────────────────────────
  section('PHASE 5: Ready up & start game');
  for (const c of COUNTRIES) {
    clients[c].emit('setReady', { roomId, userId: ids[c], playerid: ids[c], ready: true });
    await delay(60);
  }
  console.log('  ✅ All players set ready');

  await delay(300);

  const startResult = await clients['USA'].req(
    'startGame',
    { roomId, playerId: hostId, playerid: hostId, userId: hostId },
    'startGameResult'
  );
  assert(startResult.success, 'Game started (Phase 1)');
  await delay(400);

  // ── 6. Phase 1: 10 Voting Rounds ─────────────────────────────
  section('PHASE 6: Phase 1 — 10 rounds of voting');
  const issues = gameDataFile.issues || [];
  assert(issues.length === 10, `game-data.json has 10 issues (found ${issues.length})`);

  for (let round = 0; round < 10; round++) {
    const title = issues[round]?.title || `Issue ${round + 1}`;
    process.stdout.write(`  Round ${round + 1}/10: ${title.substring(0, 45)} … `);

    // All 7 players vote
    for (const c of COUNTRIES) {
      // Create some variety: USA+UK vote A, others vote B (or A if round is even)
      const choice = (c === 'USA' || c === 'UK' || round % 2 === 0) ? 'A' : 'B';
      clients[c].emit('vote', {
        roomId,
        playerId: ids[c], playerid: ids[c], userId: ids[c],
        choice
      });
      await delay(40);
    }
    await delay(300); // let server tally
    console.log('voted');

    // Advance to next round (host only; on round 10 this also triggers Phase 2)
    // We listen for stateUpdate to confirm the advance
    const statePromise = clients['USA'].nextState();
    clients['USA'].emit('advanceRound', {
      roomId, playerId: hostId, playerid: hostId, userId: hostId
    });
    const state = await statePromise;
    assert(
      state.currentRound === round + 2 || state.gamePhase === 'phase2',
      `Round ${round + 2} confirmed (phase=${state.gamePhase}, round=${state.currentRound})`
    );
    await delay(200);
  }

  // ── 7. Phase 2: 7 Economic Years ─────────────────────────────
  section('PHASE 7: Phase 2 — Economic management (1946–1952)');

  // Wait until server broadcasts Phase 2 state
  let p2state = clients['USA']._stateUpdates.slice(-1)[0];
  if (!p2state || p2state.gamePhase !== 'phase2') {
    p2state = await clients['USA'].nextState();
  }
  assert(p2state?.gamePhase === 'phase2', `Phase 2 active (phase=${p2state?.gamePhase})`);

  for (let yi = 0; yi < 7; yi++) {
    const year = 1946 + yi;
    process.stdout.write(`  Year ${year} (${yi + 1}/7): submitting policies … `);

    for (const c of COUNTRIES) {
      const isCE = (c === 'USSR' || c === 'China');
      const policy = isCE
        ? {
            productionTargets: { agriculture: 25, industry: 50, military: 15, consumer: 10 },
            laborMobilization: 70,
            priceControls: true,
            foreignTrade: 'minimal'
          }
        : {
            interestRate: 2.5 + (yi * 0.2),
            exchangeRate: c === 'USA' ? 35 : c === 'UK' ? 4.0 : 3.5,
            tariffRate: 15,
            governmentSpending: 20
          };
      clients[c].emit('submitPolicy', { roomId, playerid: ids[c], policy });
      await delay(50);
    }
    await delay(500);
    console.log('done');

    // Advance year — if a crisis blocks it, force-resolve then retry
    process.stdout.write(`  Year ${year}: advancing … `);
    const yearState = await advanceYearWithCrisisHandling(clients['USA'], roomId, hostId);
    assert(
      yearState.phase2?.currentYear === year + 1 || yearState.gamePhase === 'complete',
      `Year ${year} resolved (now year=${yearState.phase2?.currentYear}, phase=${yearState.gamePhase})`
    );
    await delay(300);
  }

  // ── 8. Final State Check ─────────────────────────────────────
  section('PHASE 8: Final state verification');
  const finalState = clients['USA']._stateUpdates.slice(-1)[0];
  assert(finalState !== null && finalState !== undefined, 'Final state received');
  assert(
    finalState?.gamePhase === 'complete' || finalState?.phase2?.currentYear >= 1953,
    `Game completed (phase=${finalState?.gamePhase}, year=${finalState?.phase2?.currentYear})`
  );
  assert(
    Object.keys(finalState?.players || {}).length === 7,
    `All 7 players present in final state`
  );

  // Check scores exist for all countries
  for (const c of COUNTRIES) {
    const score = finalState?.scores?.[c];
    assert(score !== undefined, `${c} has a score: ${score}`);
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log('\n' + '='.repeat(62));
  console.log(`\n📊 RESULTS: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('🎉 FULL SIMULATION COMPLETED SUCCESSFULLY!\n');
  } else {
    console.log(`⚠️  ${failed} failure(s) — review output above.\n`);
  }

  for (const c of COUNTRIES) clients[c].disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\n💥 Fatal:', err.message);
  process.exit(1);
});
