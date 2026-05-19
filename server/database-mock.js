// server/database-mock.js - In-memory database mock for local testing
'use strict';

const store = {
  users: {},   // username -> { user_id, username, password_hash, is_teacher, email }
  games: {},   // game_code -> game record
  players: {}, // `${user_id}-${game_code}` -> player record
};

let nextId = 1;
function newId() { return String(nextId++); }

async function queryDatabase(action, data = {}) {
  console.log(`📤 DB Mock [${action}]`);
  try {
    switch (action) {

      case 'createUser': {
        const existing = Object.values(store.users).find(u => u.username === data.username);
        if (existing) return { exists: true, user_id: existing.user_id };
        const user_id = newId();
        store.users[data.username] = {
          user_id,
          username: data.username,
          password_hash: data.password,
          email: data.email || '',
          is_teacher: data.role === 'teacher' ? 1 : 0,
          display_name: data.displayName || data.username,
        };
        return { user_id };  // server checks result?.user_id
      }

      case 'getUser': {
        const user = data.username
          ? store.users[data.username]
          : Object.values(store.users).find(u => u.user_id === String(data.user_id));
        if (!user) return null;
        return { ...user, password: user.password_hash };
      }

      case 'getAllUsers':
        return Object.values(store.users);

      case 'createGame': {
        const game_id = newId();
        store.games[data.game_code] = {
          game_id,
          game_code: data.game_code,
          status: 'active',
          host_user_id: data.host_user_id,
          current_round: 1,
          created_at: new Date().toISOString(),
          started_at: null,
        };
        return { game_id };
      }

      case 'getGame': {
        if (data.gameCode) return store.games[data.gameCode] || null;
        if (data.game_id) {
          return Object.values(store.games).find(g => g.game_id === String(data.game_id)) || null;
        }
        return null;
      }

      case 'getGames': {
        const list = Object.values(store.games);
        if (data.status) return list.filter(g => g.status === data.status);
        return list;
      }

      case 'updateGame':
      case 'updateGameStatus':
      case 'saveGameState':
      case 'updateGameState':
        if (data.game_code && store.games[data.game_code]) {
          Object.assign(store.games[data.game_code], data);
        }
        return { affected: 1 };

      case 'deleteGame':
        delete store.games[data.game_code];
        return { affected: 1 };

      case 'addPlayer': {
        const key = `${data.user_id}-${data.game_code}`;
        store.players[key] = {
          user_id: String(data.user_id),
          game_id: data.game_id,
          game_code: data.game_code,
          country_id: data.country_id || data.country,
          status: 'active',
        };
        return { affected: 1 };
      }

      case 'getPlayers': {
        return Object.values(store.players).filter(p => p.game_code === data.gameCode);
      }

      case 'getPlayerActiveGame': {
        const uid = String(data.userId);
        const entries = Object.values(store.players).filter(p => p.user_id === uid);
        if (entries.length === 0) return null;
        const enriched = entries.map(e => ({
          ...e,
          status: store.games[e.game_code]?.status || 'active',
        }));
        return enriched.length === 1 ? enriched[0] : enriched;
      }

      case 'removePlayer': {
        const keys = Object.keys(store.players).filter(k =>
          store.players[k].user_id === String(data.userId) &&
          store.players[k].game_code === data.game_code
        );
        keys.forEach(k => delete store.players[k]);
        return { affected: keys.length };
      }

      case 'saveSnapshot':
        return { snapshot_id: newId() };

      case 'getSnapshots':
        return [];

      case 'logVote':
      case 'logPolicy':
      case 'logEvent':
      case 'createGameLog':
        return { log_id: newId() };

      default:
        console.log(`   [mock] unhandled action: ${action}`);
        return null;
    }
  } catch (err) {
    console.error(`❌ DB Mock error [${action}]:`, err.message);
    return null;
  }
}

module.exports = { queryDatabase, DB_API: { url: 'mock', apiKey: 'mock' }, _store: store };
