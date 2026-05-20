// virtual-players.js
// Country-specific AI strategies for the Bretton Woods simulation.
// Each country has:
//   getVote(round, issue)          → 'A'|'B'|'C'|'D'  (Phase 1)
//   getPolicy(year, econ)          → policy object     (Phase 2)
//   getCrisisResponse(crisis, econ)→ choiceId string
'use strict';

const { crisisEvents } = require('./crisis-events.json');

// ── helpers ──────────────────────────────────────────────────────────────────

// Return the option ID that best matches a preferred list (first match wins).
function prefer(options, ...preferredIds) {
  for (const id of preferredIds) {
    const found = options.find(o => o.id === id);
    if (found) return found.id;
  }
  return options[0]?.id; // fallback: first option
}

// Clamp a value between min and max.
function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }

// ── Phase 1 voting ────────────────────────────────────────────────────────────
// Each country votes according to their historical interests.
// Options map: A=0, B=1, C=2, D=3 → convert index to letter.
const VOTES = {
  //         R1    R2    R3    R4    R5    R6    R7    R8    R9    R10
  USA:      ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'], // dollar hegemony, free trade
  UK:       ['B', 'B', 'B', 'B', 'D', 'B', 'B', 'A', 'B', 'B'], // Keynes plan, adjustable pegs, imperial pref
  USSR:     ['C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C'], // sovereignty, reject US-led system
  France:   ['B', 'B', 'B', 'B', 'C', 'B', 'C', 'B', 'B', 'B'], // reconstruction priority, gradual trade
  China:    ['C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C'], // sovereignty, anti-US hegemony
  India:    ['B', 'B', 'B', 'C', 'C', 'B', 'C', 'B', 'B', 'B'], // non-aligned, development focus
  Argentina:['C', 'C', 'C', 'C', 'D', 'C', 'C', 'B', 'C', 'C'], // sovereignty, commodity inclusion
};

function getVote(country, round) {
  return (VOTES[country] || VOTES['USA'])[round - 1] || 'A';
}

// ── Policy strategies ─────────────────────────────────────────────────────────

function getPolicy(country, year, econ) {
  // econ: { gdpGrowth, inflation, unemployment, tradeBalance, exchangeRate }
  // Falls back to sensible defaults if econ not available.
  const inf  = econ?.inflation    ?? 5;
  const unemp = econ?.unemployment ?? 5;
  const tb   = econ?.tradeBalance ?? 0;
  const gdpG = econ?.gdpGrowth    ?? 3;

  switch (country) {

    case 'USA': {
      // Anchor currency: dollar stays at 1.00, free trade, adjust rates vs inflation
      let rate = 3.0;
      if (inf > 7)  rate = clamp(rate + (inf - 7) * 0.3, 3.0, 6.0); // tighten on high inflation
      if (unemp > 6) rate = clamp(rate - 0.5, 1.5, rate);            // ease on unemployment
      return {
        centralBankRate:   parseFloat(rate.toFixed(1)),
        exchangeRate:      1.00,
        tariffRate:        10,   // USA pushes free trade
        governmentSpending: unemp > 5 ? 22 : 18,
      };
    }

    case 'UK': {
      // Defend sterling; devalue modestly if severe trade deficit
      const baseRate = econ?.exchangeRate ?? 4.03;
      let xr = year >= 1949 ? 2.80 : baseRate; // historical 1949 devaluation
      let rate = 3.5;
      if (inf > 8)  rate = Math.min(rate + 0.5, 5.0);
      if (tb < -400) rate = Math.max(rate - 0.3, 2.0); // ease to stimulate exports
      return {
        centralBankRate:   parseFloat(rate.toFixed(1)),
        exchangeRate:      parseFloat(xr.toFixed(2)),
        tariffRate:        20,  // imperial preference maintained
        governmentSpending: 25, // welfare state building
      };
    }

    case 'France': {
      // High inflation reality; devalue franc aggressively
      const baseRate = econ?.exchangeRate ?? 119.11;
      // Historical: 1948 devaluation to ~214, 1949 to ~350
      let xr = baseRate;
      if (year === 1948) xr = 214;
      if (year >= 1949)  xr = 350;
      let rate = 2.5;
      if (inf > 15) rate = Math.min(rate + 0.5, 4.0);
      return {
        centralBankRate:   parseFloat(rate.toFixed(1)),
        exchangeRate:      parseFloat(xr.toFixed(2)),
        tariffRate:        25,
        governmentSpending: 30, // reconstruction spending
      };
    }

    case 'India': {
      // Rupee follows sterling; focus on industrialisation
      const baseRate = econ?.exchangeRate ?? 3.31;
      let xr = year >= 1949 ? 4.76 : baseRate; // follows sterling devaluation
      return {
        centralBankRate:   3.0,
        exchangeRate:      parseFloat(xr.toFixed(2)),
        tariffRate:        35,  // infant industry protection
        governmentSpending: 20,
      };
    }

    case 'Argentina': {
      // Perón: high spending, nationalisation, commodity export focus
      let rate = 3.0;
      if (inf > 20) rate = Math.min(rate + 0.5, 5.0);
      return {
        centralBankRate:   parseFloat(rate.toFixed(1)),
        exchangeRate:      4.23,
        tariffRate:        40,  // high protectionism
        governmentSpending: clamp(28 + (unemp > 4 ? 4 : 0), 24, 36),
      };
    }

    case 'USSR': {
      // Command economy: maximise industry, autarky
      const industryTarget = clamp(45 + (gdpG < 3 ? 10 : 0), 40, 65);
      const milTarget      = clamp(20 - (gdpG < 1 ? 5 : 0), 10, 25);
      const agriTarget     = clamp(25 - (gdpG < 0 ? 5 : 0), 15, 30);
      const consTarget     = 100 - industryTarget - milTarget - agriTarget;
      return {
        productionTargets: {
          industry:    industryTarget,
          military:    milTarget,
          agriculture: agriTarget,
          consumer:    Math.max(consTarget, 5),
        },
        laborMobilization: clamp(75 + (gdpG < 2 ? 5 : 0), 65, 90),
        priceControls: true,
        foreignTrade:  'minimal',
      };
    }

    case 'China': {
      // Pre-1949: nationalist market; 1949+ command economy
      if (year >= 1949) {
        return {
          productionTargets: { industry: 50, military: 20, agriculture: 20, consumer: 10 },
          laborMobilization: 80,
          priceControls: true,
          foreignTrade:  'minimal',
        };
      }
      // Nationalist China: high tariffs, inflation fighting
      return {
        centralBankRate:   5.0,  // fight hyperinflation
        exchangeRate:      3350, // pegged official rate (collapsing in reality)
        tariffRate:        30,
        governmentSpending: 15,
      };
    }

    default:
      return { centralBankRate: 3.0, exchangeRate: 1.0, tariffRate: 15, governmentSpending: 20 };
  }
}

// ── Crisis response strategies ────────────────────────────────────────────────

// crisis: the active crisis object (from server stateUpdate, has .id, .options)
// econ:   this country's current economic data
function getCrisisResponse(country, crisis, econ) {
  const def = crisisEvents.find(e => e.id === crisis.id);
  const options = (crisis.options?.[country] || def?.options?.[country]) ?? [];
  if (options.length === 0) return null;

  const tb   = econ?.tradeBalance ?? 0;
  const inf  = econ?.inflation    ?? 5;
  const gdpG = econ?.gdpGrowth    ?? 3;

  switch (crisis.id) {

    case 'china-civil-war':
      if (country === 'China')     return prefer(options, 'negotiate-coalition', 'kmt-offensive');
      if (country === 'USA')       return prefer(options, 'massive-aid', 'disengage');
      if (country === 'USSR')      return prefer(options, 'aid-ccp', 'diplomatic-support');
      if (country === 'UK')        return prefer(options, 'protect-hong-kong', 'commercial-neutrality');
      if (country === 'India')     return prefer(options, 'non-aligned-mediation', 'focus-domestic');
      break;

    case 'india-partition':
      if (country === 'India')  return prefer(options, 'emergency-relief', 'military-order');
      if (country === 'UK')     return prefer(options, 'financial-aid', 'rapid-exit');
      break;

    case 'argentina-peronism':
      if (country === 'Argentina') return prefer(options, 'gradual-reform', 'full-nationalization');
      if (country === 'UK')        return prefer(options, 'negotiate-compensation', 'protest-nationalization');
      if (country === 'USA')       return prefer(options, 'economic-pressure', 'accept-peronism');
      break;

    case 'first-indochina-war':
      if (country === 'France')    return prefer(options, 'full-war', 'negotiate-independence');
      if (country === 'USA')       return prefer(options, 'fund-french', 'pressure-decolonization');
      if (country === 'USSR')      return prefer(options, 'aid-viet-minh', 'cautious-support');
      if (country === 'India')     return prefer(options, 'support-independence', 'quiet-diplomacy');
      break;

    case 'berlin-blockade':
      if (country === 'USA')    return prefer(options, 'airlift', 'abandon-berlin');
      if (country === 'UK')     return prefer(options, 'support-airlift', 'diplomatic-pressure');
      if (country === 'France') return prefer(options, 'allow-airlift-access', 'limited-support');
      if (country === 'USSR')   return prefer(options, 'maintain-blockade', 'negotiate-settlement');
      break;

    case 'marshall-plan':
      if (country === 'USA')    return prefer(options, 'full-marshall', 'reduced-marshall');
      if (country === 'UK')     return prefer(options, 'accept-with-conditions', 'accept-aid');
      if (country === 'France') return prefer(options, 'accept-with-autonomy', 'accept-aid');
      if (country === 'USSR')   return prefer(options, 'forbid-satellites', 'counter-offer');
      break;

    case 'korean-war':
      if (country === 'USA')       return prefer(options, 'full-intervention', 'accept-unification');
      if (country === 'UK')        return prefer(options, 'full-intervention', 'accept-unification');
      if (country === 'USSR')      return prefer(options, 'support-north', 'limited-involvement');
      if (country === 'China')     return prefer(options, 'enter-war', 'border-defense');
      if (country === 'France')    return prefer(options, 'token-forces', 'focus-indochina');
      if (country === 'India')     return prefer(options, 'non-aligned-mediation', 'condemn-aggression');
      if (country === 'Argentina') return prefer(options, 'sell-supplies', 'stay-neutral');
      break;

    case 'argentina-british-debt':
      if (country === 'Argentina') {
        // If economy is strong, demand payment; if weak, negotiate
        return prefer(options,
          tb > 500 ? 'demand-full-payment' : 'negotiate-railways',
          'extend-credit'
        );
      }
      if (country === 'UK')  return prefer(options, 'offer-railways', 'request-us-loan');
      if (country === 'USA') return prefer(options, 'stay-out', 'pressure-argentina');
      break;

    case 'argentina-commodity-boom':
      if (country === 'Argentina') return prefer(options, 'maximize-prices', 'fair-prices', 'food-aid');
      if (country === 'USA')       return prefer(options, 'compete-prices', 'let-market-decide');
      if (country === 'UK')        return prefer(options, 'buy-argentine', 'seek-us-aid');
      if (country === 'France')    return prefer(options, 'bilateral-deal', 'colonial-agriculture');
      if (country === 'India')     return prefer(options, 'export-competition', 'solidarity');
      break;

    case 'argentina-drought-1951':
      if (country === 'Argentina') {
        return prefer(options,
          gdpG < 0 ? 'borrow-abroad' : 'austerity',
          'maintain-spending'
        );
      }
      if (country === 'USA') return prefer(options, 'offer-aid', 'exploit-weakness');
      if (country === 'UK')  return prefer(options, 'return-favor', 'exploit-leverage');
      break;

    case 'evita-death-1952':
      if (country === 'Argentina') return prefer(options, 'state-funeral', 'foundation-continues', 'political-reform');
      if (country === 'USA')       return prefer(options, 'condolences', 'exploit-instability');
      if (country === 'UK')        return prefer(options, 'trade-overture', 'condolences');
      break;
  }

  // Unknown crisis: pick first option
  return options[0]?.id ?? null;
}

module.exports = { getVote, getPolicy, getCrisisResponse };
