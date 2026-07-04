// shared/country-utils.js
// Shared country normalization utilities for both server and client.
// Node.js: const { normalizeCountryName } = require('./shared/country-utils');
// Browser: <script src="/shared/country-utils.js"></script> -> window.CountryUtils

(function (exports) {
  // Canonical country names used throughout the game
  var COUNTRIES = ['USA', 'UK', 'USSR', 'France', 'China', 'India', 'Argentina'];

  // All known aliases mapping to canonical names
  var COUNTRY_ALIASES = {
    // USSR variations
    'USS': 'USSR',
    'SUN': 'USSR',
    'SOV': 'USSR',
    'Soviet Union': 'USSR',
    'Soviet': 'USSR',
    // USA variations
    'US': 'USA',
    'United States': 'USA',
    'America': 'USA',
    // UK variations
    'GB': 'UK',
    'GBR': 'UK',
    'Great Britain': 'UK',
    'United Kingdom': 'UK',
    'Britain': 'UK',
    'England': 'UK',
    // China variations
    'CHN': 'China',
    'PRC': 'China',
    'CHI': 'China',
    "People's Republic of China": 'China',
    'Republic of China': 'China',
    // France variations
    'FRA': 'France',
    'French': 'France',
    // India variations
    'IND': 'India',
    'India (British Raj)': 'India',
    'British Raj': 'India',
    // Argentina variations
    'ARG': 'Argentina'
  };

  // Map canonical names back to themselves so lookups always succeed
  COUNTRIES.forEach(function (c) { COUNTRY_ALIASES[c] = c; });

  // Historical GDP values ($millions, 1946 nominal USD)
  // Sources: Maddison Project, World Bank historical, BEA
  var COUNTRY_GDP = {
    'USA': 228000,    // $228B - post-war peak, demobilizing from $263B wartime
    'UK': 55000,      // $55B - war-exhausted, running on American loans
    'USSR': 65000,    // $65B est. - war-devastated, ~40% of pre-war destroyed
    'France': 28000,  // $28B - recovering from occupation, ~55% of 1938 level
    'China': 22000,   // $22B est. - civil war starting, hyperinflation beginning
    'India': 24000,   // $24B est. - colonial economy, pre-independence
    'Argentina': 14000 // $14B - wartime prosperity, commodity export surplus
  };

  // Cold War rivalries (order-independent pairs)
  var RIVALRIES = [
    ['USA', 'USSR'],
    ['UK', 'USSR'],
    ['France', 'USSR']
  ];

  // Bretton Woods initial exchange rates (local currency per USD, 1946)
  // Sources: IMF Articles of Agreement (1945), central bank records
  var INITIAL_EXCHANGE_RATES = {
    'USA': 1.00,       // Anchor currency, $35/oz gold
    'UK': 4.03,        // £1 = $4.03 (Bretton Woods peg, devalued to $2.80 in 1949)
    'USSR': null,      // Ruble not convertible, no Bretton Woods participation
    'France': 119.11,  // 119 francs per dollar (old franc, devalued repeatedly 1946-48)
    'China': 3350,     // 3,350 yuan per dollar (official rate, hyperinflation starting)
    'India': 3.31,     // 3.31 rupees per dollar (pegged via sterling)
    'Argentina': 4.23  // 4.23 pesos per dollar (Perón-era controlled rate)
  };

  // Initial unemployment rates (%, 1946)
  // Sources: BLS, UK ONS, ILO estimates
  var INITIAL_UNEMPLOYMENT = {
    'USA': 3.9,      // Low but rising as 12M soldiers demobilize
    'UK': 2.5,       // Near full employment, labor shortages in some sectors
    'USSR': 0,       // Official: 0% (command economy, forced labor)
    'France': 5.0,   // Reconstruction labor demand offset by disruption
    'China': 8.0,    // Massive rural underemployment, urban dislocation
    'India': 7.5,    // Colonial economy, huge rural underemployment
    'Argentina': 3.8  // Near full employment, booming exports
  };

  // Initial inflation rates (%, 1946)
  // Sources: BLS CPI, Bank of England, scholarly estimates
  var INITIAL_INFLATION = {
    'USA': 18.1,     // Post-war price controls lifted -> prices surged
    'UK': 7.4,       // Rationing contained prices, but pressure building
    'USSR': 0,       // Official: 0% (state-controlled prices, actual shortages severe)
    'France': 52.0,  // Near-hyperinflation, franc losing value rapidly
    'China': 230.0,  // Hyperinflation beginning (would reach 1000%+ by 1948)
    'India': 12.5,   // Post-war commodity prices, food scarcity
    'Argentina': 17.7 // Perón spending on industrialization, wage increases
  };

  /**
   * Normalize any country name/code to its canonical form.
   * Returns the input unchanged if no alias is found.
   */
  function normalizeCountryName(name) {
    if (!name) return '';
    var trimmed = (typeof name === 'string') ? name.trim() : String(name);
    return COUNTRY_ALIASES[trimmed] || trimmed;
  }

  /**
   * Check if a country has a command economy in a given year.
   */
  function isCommandEconomy(country, year) {
    var normalized = normalizeCountryName(country);
    if (normalized === 'USSR') return true;
    if (normalized === 'China' && year >= 1949) return true;
    return false;
  }

  /**
   * Check if two countries are rivals (order-independent).
   */
  function areRivals(countryA, countryB) {
    var a = normalizeCountryName(countryA);
    var b = normalizeCountryName(countryB);
    return RIVALRIES.some(function (pair) {
      return (pair[0] === a && pair[1] === b) || (pair[0] === b && pair[1] === a);
    });
  }

  /**
   * Get GDP for a country ($millions, 1946 baseline).
   */
  function getBaseGDP(country) {
    return COUNTRY_GDP[normalizeCountryName(country)] || 32000;
  }

  /**
   * Get initial exchange rate for a country.
   */
  function getInitialExchangeRate(country) {
    var rate = INITIAL_EXCHANGE_RATES[normalizeCountryName(country)];
    return rate !== undefined ? rate : 1.0;
  }

  /**
   * Get initial unemployment rate for a country.
   */
  function getInitialUnemployment(country) {
    return INITIAL_UNEMPLOYMENT[normalizeCountryName(country)] || 5.0;
  }

  /**
   * Get initial inflation rate for a country.
   */
  function getInitialInflation(country) {
    return INITIAL_INFLATION[normalizeCountryName(country)] || 20.0;
  }

  // Public API
  exports.COUNTRIES = COUNTRIES;
  exports.COUNTRY_ALIASES = COUNTRY_ALIASES;
  exports.COUNTRY_GDP = COUNTRY_GDP;
  exports.RIVALRIES = RIVALRIES;
  exports.INITIAL_EXCHANGE_RATES = INITIAL_EXCHANGE_RATES;
  exports.INITIAL_UNEMPLOYMENT = INITIAL_UNEMPLOYMENT;
  exports.INITIAL_INFLATION = INITIAL_INFLATION;
  exports.normalizeCountryName = normalizeCountryName;
  exports.isCommandEconomy = isCommandEconomy;
  exports.areRivals = areRivals;
  exports.getBaseGDP = getBaseGDP;
  exports.getInitialExchangeRate = getInitialExchangeRate;
  exports.getInitialUnemployment = getInitialUnemployment;
  exports.getInitialInflation = getInitialInflation;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.CountryUtils = {}));
