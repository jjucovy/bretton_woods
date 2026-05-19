// server-test-entry.js - Boots server.js with an in-memory database mock.
// Usage: node server-test-entry.js
'use strict';

const path = require('path');
const Module = require('module');

// Resolve both paths so require.cache keying works correctly
const realDbPath  = path.resolve(__dirname, 'server/database.js');
const mockDbPath  = path.resolve(__dirname, 'server/database-mock.js');

// Load the mock first so it gets its own cache entry
require(mockDbPath);

// Alias the real path to the already-loaded mock
require.cache[realDbPath] = require.cache[mockDbPath];

// Boot the server — it will pick up the aliased module on its require('./server/database')
require('./server.js');
