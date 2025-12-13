#!/usr/bin/env node
// test-countries.js - Verify all 7 countries are present

const fs = require('fs');
const path = require('path');

console.log('\n🔍 VERIFYING BRETTON WOODS COUNTRIES\n');
console.log('='.repeat(60));

const gameDataPath = path.join(__dirname, 'game-data.json');

if (!fs.existsSync(gameDataPath)) {
  console.error('\n❌ ERROR: game-data.json not found!');
  process.exit(1);
}

const gameData = JSON.parse(fs.readFileSync(gameDataPath, 'utf8'));
const countries = gameData.countries;
const economicData = gameData.economicData;

console.log('\n📊 COUNTRIES IN game-data.json:\n');

const expectedCountries = ['USA', 'UK', 'USSR', 'France', 'China', 'India', 'Argentina'];
let allPresent = true;

expectedCountries.forEach((code, idx) => {
  const country = countries[code];
  const hasEconomic = economicData[code] !== undefined;
  
  if (country) {
    console.log(`${idx + 1}. ✅ ${code.padEnd(10)} - ${country.name.padEnd(25)} (${country.color})`);
    if (!hasEconomic) {
      console.log(`   ⚠️  WARNING: No economic data for ${code}`);
      allPresent = false;
    }
  } else {
    console.log(`${idx + 1}. ❌ ${code.padEnd(10)} - MISSING!`);
    allPresent = false;
  }
});

console.log('\n' + '='.repeat(60));

if (allPresent) {
  console.log('\n✅ SUCCESS! All 7 countries present with economic data\n');
  process.exit(0);
} else {
  console.log('\n❌ ERROR: Some countries are missing!\n');
  process.exit(1);
}
