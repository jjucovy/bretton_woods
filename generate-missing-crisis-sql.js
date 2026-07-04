// Generate INSERT statements for crisis_options rows NOT already in Hostinger
const data = require('./crisis-events.json');

// Existing rows from DB (32 rows)
const existing = new Set([
  '1|China|kmt-offensive',
  '1|China|negotiate-coalition',
  '1|USA|massive-aid',
  '1|USA|disengage',
  '1|USSR|aid-ccp',
  '2|India|emergency-relief',
  '2|India|military-order',
  '2|UK|financial-aid',
  '2|UK|rapid-exit',
  '3|Argentina|full-nationalization',
  '3|Argentina|gradual-reform',
  '3|UK|negotiate-compensation',
  '4|France|full-war',
  '4|France|negotiate-independence',
  '4|USA|fund-french',
  '4|USA|pressure-decolonization',
  '4|India|support-independence',
  '5|USA|airlift',
  '5|USA|abandon-berlin',
  '5|USSR|maintain-blockade',
  '5|USSR|negotiate-settlement',
  '6|USA|full-marshall',
  '6|UK|accept-aid',
  '6|France|accept-aid',
  '6|USSR|forbid-satellites',
  // DB says 32 total but only 25 shown - these 7 may also exist
  // (crises 7-11 or remaining rows from 1-6). We'll skip any that match.
]);

const crisisIdMap = {
  'china-civil-war': 1,
  'india-partition': 2,
  'argentina-peronism': 3,
  'first-indochina-war': 4,
  'berlin-blockade': 5,
  'marshall-plan': 6,
  'korean-war': 7,
  'argentina-british-debt': 8,
  'argentina-commodity-boom': 9,
  'argentina-drought-1951': 10,
  'evita-death-1952': 11
};

const missing = [];

data.crisisEvents.forEach(function(crisis) {
  var numericId = crisisIdMap[crisis.id];
  if (!numericId) return;

  Object.keys(crisis.options).forEach(function(country) {
    crisis.options[country].forEach(function(opt) {
      var key = numericId + '|' + country + '|' + opt.id;
      if (!existing.has(key)) {
        missing.push({
          crisis_id: numericId,
          country_code: country,
          option_key: opt.id,
          option_text: opt.text,
          cost: opt.cost || 0,
          effects: opt.effects ? JSON.stringify(opt.effects) : null,
          military_required: opt.militaryRequired ? JSON.stringify(opt.militaryRequired) : null,
          outcome: opt.outcome || ''
        });
      }
    });
  });
});

function esc(s) { return s ? s.replace(/'/g, "\\'") : ''; }

console.log('-- Insert missing crisis_options rows (options not already in DB)');
console.log('-- Generated from crisis-events.json - ' + missing.length + ' new rows');
console.log('');

missing.forEach(function(r) {
  var effectsVal = r.effects ? "'" + esc(r.effects) + "'" : 'NULL';
  var milVal = r.military_required ? "'" + esc(r.military_required) + "'" : 'NULL';
  console.log("INSERT INTO crisis_options (crisis_id, country_code, option_key, option_text, cost, effects, military_required, outcome) VALUES (" + r.crisis_id + ", '" + esc(r.country_code) + "', '" + esc(r.option_key) + "', '" + esc(r.option_text) + "', " + r.cost + ", " + effectsVal + ", " + milVal + ", '" + esc(r.outcome) + "');");
});

console.log('');
console.log('-- Total new rows: ' + missing.length);
