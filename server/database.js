// server/database.js - Database API client

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

    console.log(`📤 DB Request [${action}]:`, JSON.stringify(data, null, 2));

    const response = await fetch(DB_API.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    if (!text || text.trim() === '') {
      console.error(`❌ DB Error [${action}]: Empty response from API`);
      return null;
    }

    let result;
    try {
      result = JSON.parse(text);
    } catch (parseError) {
      console.error(`❌ DB Error [${action}]: Invalid JSON response:`, text.substring(0, 200));
      return null;
    }

    console.log(`📥 DB Response [${action}]:`, JSON.stringify(result).substring(0, 200));

    if (result.success) {
      return result.data || result;
    } else {
      console.error(`❌ DB Error [${action}]:`, result.error || result.message);
      return null;
    }
  } catch (error) {
    console.error(`❌ API Error [${action}]:`, error.message);
    return null;
  }
}

module.exports = { queryDatabase, DB_API };
