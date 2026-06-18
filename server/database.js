// server/database.js - Database API client
const axios = require('axios');

const DB_API = {
  url: 'https://jucovy.com/api.php',
  apiKey: 'bretton-woods-secret-key-2024'
};

async function queryDatabase(action, data = {}) {
  try {
    const payload = {
      action,
      api_key: DB_API.apiKey,
      ...data
    };

    console.log(`📤 DB Request [${action}]:`, JSON.stringify(data));

    const response = await axios.post(DB_API.url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });

    const result = response.data;
    console.log(`📥 DB Response [${action}]:`, JSON.stringify(result).substring(0, 300));

    if (result && result.success) {
      return result.data || result;
    } else {
      console.error(`❌ DB Error [${action}]:`, result?.error || result?.message || JSON.stringify(result));
      return null;
    }
  } catch (error) {
    console.error(`❌ API Error [${action}]:`, error.message);
    return null;
  }
}

module.exports = { queryDatabase, DB_API };
