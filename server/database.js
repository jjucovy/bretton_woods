// server/database.js - Database API client
const axios = require('axios');
const qs = require('qs');

const DB_API = {
  url: 'https://jucovy.com/api.php',
  apiKey: 'bretton-woods-secret-key-2024'
};

// Build URL with key as query param — avoids body-parsing issues on the PHP host
function apiUrl() {
  return `${DB_API.url}?key=${DB_API.apiKey}`;
}

async function queryDatabase(action, data = {}) {
  try {
    const payload = {
      action,
      api_key: DB_API.apiKey,
      ...data
    };

    console.log(`📤 DB Request [${action}]:`, JSON.stringify(data));

    const response = await axios.post(apiUrl(), payload, {
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

// Same as queryDatabase but sends form-encoded data (for PHP handlers that read $_POST)
async function queryDatabaseForm(action, data = {}) {
  try {
    const payload = {
      action,
      api_key: DB_API.apiKey,
      ...data
    };

    console.log(`📤 DB Form Request [${action}]:`, JSON.stringify(data));

    const response = await axios.post(apiUrl(), qs.stringify(payload), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });

    const result = response.data;
    console.log(`📥 DB Form Response [${action}]:`, JSON.stringify(result).substring(0, 300));

    if (result && result.success) {
      return result.data || result;
    } else {
      console.error(`❌ DB Form Error [${action}]:`, result?.error || result?.message || JSON.stringify(result));
      return null;
    }
  } catch (error) {
    console.error(`❌ DB Form API Error [${action}]:`, error.message);
    return null;
  }
}

module.exports = { queryDatabase, queryDatabaseForm, DB_API };
