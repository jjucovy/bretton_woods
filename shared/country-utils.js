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

  // Historical GDP values ($millions, 1946)
  var COUNTRY_GDP = {
    'USA': 210000,
    'UK': 61000,
    'USSR': 126000,
    'France': 37000,
    'China': 45000,
    'India': 55000,
    'Argentina': 32000
  };

  // Cold War rivalries (order-independent pairs)
  var RIVALRIES = [
    ['USA', 'USSR'],
    ['UK', 'USSR'],
    ['France', 'USSR']
  ];

  // Bretton Woods initial exchange rates (local currency per USD)
  var INITIAL_EXCHANGE_RATES = {
    'USA': 1.00,
    'UK': 4.03,
    'USSR': null,  // Not convertible
    'France': 119.11,
    'China': 3.35,
    'India': 3.31,
    'Argentina': 3.50
  };

  // Initial unemployment rates (%, 1946)
  var INITIAL_UNEMPLOYMENT = {
    'USA': 3.9,
    'UK': 2.5,
    'USSR': 0,
    'France': 4.5,
    'China': 6.0,
    'India': 7.0,
    'Argentina': 5.0
  };

  // Initial inflation rates (%, 1946)
  var INITIAL_INFLATION = {
    'USA': 8.3,
    'UK': 3.1,
    'USSR': 0,
    'France': 50.0,
    'China': 300.0,
    'India': 20.0,
    'Argentina': 20.0
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
