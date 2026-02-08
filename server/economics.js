// server/economics.js - Phase 2 economic calculation engine
//
// All functions take a `room` object directly (the caller does the
// globalState.rooms[roomId] lookup).  This keeps the module free of
// global‐state references and easy to test.

const {
  normalizeCountryName,
  isCommandEconomy,
  areRivals,
  getBaseGDP
} = require('../shared/country-utils');

// ──────────────────────────────────────────────
// Agreement bonus (Phase 1 → Phase 2 bridge)
// ──────────────────────────────────────────────
function calculateAgreementBonus(room) {
  if (!room) return {};

  const bonus = {};
  const roundHistory = room.roundHistory || [];

  Object.values(room.players).forEach(player => {
    const country = normalizeCountryName(player.country);
    let gdpBonus = 0;
    let tradeBonus = 0;
    let cooperationBonus = 0;

    roundHistory.forEach((round) => {
      const playerVote = round.votes[player.userId];
      const winningOption = round.winningOption;
      if (!playerVote || !winningOption) return;

      const issueTitle = round.issueTitle || '';

      if (playerVote === winningOption) {
        cooperationBonus += 0.3;
        if (issueTitle.includes('IMF') || issueTitle.includes('loans')) {
          tradeBonus += 200;
        }
        if (issueTitle.includes('tariff') || issueTitle.includes('trade')) {
          gdpBonus += 0.4;
          tradeBonus += 300;
        }
        if (issueTitle.includes('gold') || issueTitle.includes('currency')) {
          gdpBonus += 0.2;
        }
        if (issueTitle.includes('World Bank') || issueTitle.includes('development')) {
          gdpBonus += 0.3;
        }
      } else {
        cooperationBonus -= 0.1;
      }
    });

    bonus[country] = {
      gdpBonus: gdpBonus + cooperationBonus,
      tradeBonus: tradeBonus,
      description: `Bretton Woods alignment: ${cooperationBonus > 0 ? 'cooperative' : 'isolated'}`
    };
  });

  return bonus;
}

// ──────────────────────────────────────────────
// Exchange rate calculator
// ──────────────────────────────────────────────
function calculateExchangeRate(country, currentYear, policy, previousData, room) {
  const nc = normalizeCountryName(country);

  if (nc === 'USSR') {
    return { rate: null, change: 0, defendable: true };
  }
  if (nc === 'USA') {
    return { rate: 1.00, change: 0, defendable: true };
  }

  const previousRate = previousData.exchangeRate;
  let rateChange = 0;

  // 1. Inflation differential (vs USA)
  const usData = room.phase2.yearlyData[currentYear]?.['USA'];
  const usInflation = usData ? usData.inflation : 3.0;
  const countryInflation = previousData.inflation || 5.0;
  const inflationDiff = countryInflation - usInflation;
  rateChange += inflationDiff * 0.4;

  // 2. Trade balance impact
  const tradeBalance = previousData.tradeBalance || 0;
  if (tradeBalance < -300) {
    rateChange += Math.abs(tradeBalance) * 0.01;
  } else if (tradeBalance > 300) {
    rateChange -= tradeBalance * 0.005;
  }

  // 3. Interest rate differential
  if (policy && policy.interestRate) {
    const usInterestRate = 2.5;
    const rateDiff = policy.interestRate - usInterestRate;
    rateChange -= rateDiff * 0.3;
  }

  // 4. Gold reserves (confidence factor)
  const goldReserves = previousData.goldReserves || 1000;
  if (goldReserves < 500) {
    rateChange += 4.0;
  } else if (goldReserves > 15000) {
    rateChange -= 1.0;
  }

  // 5. Government deficit
  if (policy && policy.governmentSpending) {
    const gdp = policy.gdp || 100000;
    const deficit = (policy.governmentSpending - (policy.taxRevenue || 0)) / gdp * 100;
    if (deficit > 5) {
      rateChange += deficit * 0.3;
    }
  }

  // Historical event triggers
  if (nc === 'UK' && currentYear === 1949) {
    rateChange -= 30.5;
    console.log(`🚨 HISTORICAL EVENT: UK Sterling Crisis 1949 - Forced 30% devaluation`);
  }
  if (nc === 'France' && currentYear === 1948) {
    rateChange += 79.9;
    console.log(`🚨 HISTORICAL EVENT: France 1948 Devaluation - 80% currency collapse`);
  }
  if (nc === 'France' && currentYear === 1949) {
    rateChange += 63.3;
    console.log(`🚨 HISTORICAL EVENT: France 1949 Devaluations - Currency crisis continues`);
  }
  if (nc === 'India' && currentYear === 1949) {
    rateChange += 18.0;
    console.log(`📊 India adjusts to sterling devaluation`);
  }

  // Calculate new rate
  let newRate;
  if (nc === 'UK') {
    newRate = previousRate * (1 + rateChange / 100);
  } else {
    newRate = previousRate * (1 + rateChange / 100);
  }

  const defendable = Math.abs(rateChange) < 10;

  if (Math.abs(rateChange) > 1 && Math.abs(rateChange) < 10) {
    console.log(`⚠️  ${country}: Exchange rate pressure (${rateChange.toFixed(1)}%) - intervention required`);
  }

  return {
    rate: Math.max(0.01, newRate),
    change: rateChange,
    defendable: defendable
  };
}

// ──────────────────────────────────────────────
// Main yearly economics calculation
// ──────────────────────────────────────────────
function calculateYearEconomics(room) {
  if (!room) return;

  const currentYear = room.phase2.currentYear;
  const policies = room.phase2.policies[currentYear] || {};
  const prevYearData = room.phase2.yearlyData[currentYear];

  if (!prevYearData) return;

  const nextYear = currentYear + 1;
  room.phase2.yearlyData[nextYear] = {};

  const agreementBonuses = calculateAgreementBonus(room);

  // STEP 1: Global averages
  const allCountries = Object.values(room.players).map(p => normalizeCountryName(p.country));
  let globalAvgTariff = 0;
  let globalAvgExchangeRate = 0;
  let globalAvgInterestRate = 0;
  let countriesWithPolicies = 0;

  allCountries.forEach(country => {
    const policy = policies[country];
    if (policy) {
      globalAvgTariff += policy.tariffRate;
      globalAvgExchangeRate += policy.exchangeRate;
      globalAvgInterestRate += policy.centralBankRate;
      countriesWithPolicies++;
    }
  });

  if (countriesWithPolicies > 0) {
    globalAvgTariff /= countriesWithPolicies;
    globalAvgExchangeRate /= countriesWithPolicies;
    globalAvgInterestRate /= countriesWithPolicies;
  }

  // STEP 2: Per-country calculations
  const tempResults = {};

  Object.values(room.players).forEach(player => {
    const country = normalizeCountryName(player.country);
    const policy = policies[country];
    const prevData = prevYearData[country];

    if (!policy || !prevData) {
      const defaultData = prevData || {
        gdp: 100, gdpGrowth: 0, goldReserves: 1000, unemployment: 5,
        tradeBalance: 0, inflation: 5, industrialOutput: 100,
        military: { army: 500000, navy: 100000, airForce: 50000, total: 650000 }
      };
      tempResults[country] = {
        ...defaultData,
        gdpGrowth: -2.0,
        industrialOutput: (defaultData.industrialOutput || 100) * 0.98
      };
      return;
    }

    const policyIsCommand = policy.isCommandEconomy || false;

    let centralBankRate, exchangeRate, tariffRate;
    if (policyIsCommand) {
      centralBankRate = 0;
      exchangeRate = 1.0;
      tariffRate = 50;
    } else {
      centralBankRate = policy.centralBankRate || 3.0;
      exchangeRate = policy.exchangeRate || 1.0;
      tariffRate = policy.tariffRate || 10;
    }

    const militarySpending = policy.militarySpending || 5;
    const armySize = policy.armySize || prevData.military.army;
    const navySize = policy.navySize || prevData.military.navy;
    const airForceSize = policy.airForceSize || prevData.military.airForce;
    const totalMilitary = armySize + navySize + airForceSize;

    let gdpGrowth = 4.0;
    let tradeBalance = prevData.tradeBalance;
    let industrialOutput = prevData.industrialOutput || 100;
    let inflation = prevData.inflation;
    let unemployment = prevData.unemployment;

    // === MILITARY ECONOMIC IMPACT ===
    const milSpending = militarySpending || 5;
    const armyCost = armySize * 0.001;
    const navyCost = navySize * 0.004;
    const airForceCost = airForceSize * 0.006;
    const totalMilitaryCost = armyCost + navyCost + airForceCost;

    const gdp = getBaseGDP(country);
    const effectiveMilSpending = (totalMilitaryCost / gdp) * 100;

    if (effectiveMilSpending > 10) {
      gdpGrowth -= (effectiveMilSpending - 10) * 0.15;
    }
    if (effectiveMilSpending >= 5 && effectiveMilSpending <= 8) {
      gdpGrowth += 0.3;
    }

    const laborForceImpact = (totalMilitary / 1000000) * -0.2;
    gdpGrowth += laborForceImpact;

    if (navySize > 100000) {
      tradeBalance += (navySize / 100000) * 150;
    }
    if (airForceSize > 200000) {
      gdpGrowth -= 0.3;
    }

    const optimalCBRate = 3.0;
    const cbRateDeviation = Math.abs(centralBankRate - optimalCBRate);
    gdpGrowth -= cbRateDeviation * 0.5;

    // === DYNAMIC TRADE EFFECTS ===
    let tradeCompetitiveness = 0;

    allCountries.forEach(otherCountry => {
      if (otherCountry === country) return;
      const otherPolicy = policies[otherCountry];
      if (!otherPolicy) return;

      const exchangeRateDiff = otherPolicy.exchangeRate - exchangeRate;
      tradeCompetitiveness += exchangeRateDiff * 0.3;

      const theirTariffImpact = (otherPolicy.tariffRate - 15) * -3;
      tradeBalance += theirTariffImpact;

      if (tariffRate < 20 && otherPolicy.tariffRate < 20) {
        tradeBalance += 100;
        gdpGrowth += 0.2;
      }

      if (exchangeRate < 0.8 && otherPolicy.exchangeRate > 1.1) {
        gdpGrowth -= 0.5;
      }

      // === MILITARY TENSION & ARMS RACE ===
      const otherMilSpending = otherPolicy.militarySpending || 5;
      const otherArmySize = otherPolicy.armySize || 500000;
      const otherNavySize = otherPolicy.navySize || 100000;
      const otherAirForceSize = otherPolicy.airForceSize || 100000;
      const otherTotalMilitary = otherArmySize + otherNavySize + otherAirForceSize;

      const isRival = areRivals(country, otherCountry);

      if (isRival) {
        if (otherTotalMilitary > totalMilitary * 1.5) {
          gdpGrowth -= 0.3;
          tradeBalance -= 200;
        }
        if ((country === 'UK' || country === 'USA') && otherNavySize > navySize * 1.3) {
          tradeBalance -= 300;
        }
        if (otherMilSpending > 12) {
          if (milSpending < otherMilSpending - 3) {
            gdpGrowth -= 0.4;
          }
        }
      }

      const milSpendingDiff = Math.abs(milSpending - otherMilSpending);
      if (milSpendingDiff < 3 && milSpending < 10) {
        tradeBalance += 50;
      }
    });

    if (tariffRate > 15) {
      tradeBalance -= (tariffRate - 15) * 15;
    }

    gdpGrowth += tradeCompetitiveness;

    // === GLOBAL ECONOMIC SYNCHRONIZATION ===
    if (globalAvgInterestRate > 6) {
      gdpGrowth -= 1.5;
    }
    if (globalAvgInterestRate < 2) {
      gdpGrowth += 1.0;
    }

    // === TRADE BLOC EFFECTS ===
    const tariffDeviation = Math.abs(tariffRate - globalAvgTariff);
    if (tariffDeviation < 10) {
      gdpGrowth += 0.3;
    }

    // === CAPITAL FLOWS ===
    if (centralBankRate > globalAvgInterestRate + 2) {
      tradeBalance += 500;
    } else if (centralBankRate < globalAvgInterestRate - 2) {
      tradeBalance -= 300;
    }

    // Bretton Woods agreement bonuses
    const bwBonus = agreementBonuses[country] || { gdpBonus: 0, tradeBonus: 0 };
    gdpGrowth += bwBonus.gdpBonus;
    tradeBalance += bwBonus.tradeBonus;

    // Country-specific modifiers
    if (isCommandEconomy(country, currentYear)) {
      if (policy.isCommandEconomy) {
        const planTarget = policy.fiveYearPlanTarget || 8;
        const heavyIndustry = policy.heavyIndustryAllocation || 60;
        const foreignTrade = policy.foreignTradeOrientation || 50;
        const planPriority = policy.planFulfillmentPriority || 70;

        if (planTarget > 10) {
          gdpGrowth += (planTarget - 10) * 0.3;
          inflation += (planTarget - 10) * 0.5;
        }
        if (heavyIndustry > 60) {
          industrialOutput *= 1.01 + ((heavyIndustry - 60) / 100);
        }
        if (foreignTrade < 30) {
          tradeBalance -= 400;
          gdpGrowth += 0.3;
        } else if (foreignTrade > 70) {
          tradeBalance += 600;
          gdpGrowth += 0.5;
        } else {
          tradeBalance += 100;
        }
        if (planPriority > 80) {
          gdpGrowth += 0.4;
          inflation += 1.0;
        } else if (planPriority < 60) {
          gdpGrowth -= 0.3;
          inflation -= 0.5;
        }
      }

      if (currentYear >= 1948) {
        gdpGrowth -= 0.5;
        tradeBalance -= 200;
      }
      gdpGrowth += 0.8;
      tradeBalance += 300;
      if (policy.isCommandEconomy && (policy.planFulfillmentPriority || 70) > 70) {
        gdpGrowth += 0.5;
        industrialOutput *= 1.03;
      }
    }

    if (country === 'China') {
      if (currentYear <= 1949) {
        const warIntensity = { 1946: -0.5, 1947: -0.8, 1948: -1.2, 1949: -1.5 };
        gdpGrowth += (warIntensity[currentYear] || -0.5);
        tradeBalance -= (currentYear - 1945) * 100;
      }
      gdpGrowth += 0.3;
      tradeBalance += 200;
      if (currentYear >= 1949 && policy.isCommandEconomy) {
        const planTarget = policy.fiveYearPlanTarget || 8;
        const foreignTrade = policy.foreignTradeOrientation || 40;
        const planPriority = policy.planFulfillmentPriority || 75;
        if (planTarget > 12) {
          gdpGrowth += (planTarget - 12) * 0.2;
          inflation += (planTarget - 12) * 0.8;
        }
        if (foreignTrade < 30) {
          tradeBalance -= 200;
          gdpGrowth += 0.2;
        } else if (foreignTrade > 70) {
          tradeBalance += 200;
        }
        if (planPriority > 80) {
          gdpGrowth += 0.5;
          inflation += 0.8;
        }
        if (currentYear >= 1950) {
          gdpGrowth += 1.0;
          tradeBalance += 150;
        } else {
          gdpGrowth -= 0.5;
        }
      }
      if (currentYear >= 1950 && policy.isCommandEconomy) {
        gdpGrowth += 0.8;
        industrialOutput *= 1.04;
      }
    }

    if (country === 'India' && currentYear >= 1947) {
      gdpGrowth += 1.0;
    }
    if (country === 'France') {
      if (currentYear >= 1948) {
        gdpGrowth += 1.2;
        tradeBalance += 400;
      }
      gdpGrowth += 0.5;
    }
    if (country === 'UK') {
      if (currentYear >= 1948) {
        gdpGrowth += 0.6;
        tradeBalance += 250;
      }
      tradeBalance += 200;
    }
    if (country === 'USA') {
      tradeBalance += 400;
    }

    // === ARGENTINA SPECIAL MECHANICS ===
    if (country === 'Argentina') {
      if (currentYear <= 1950) {
        tradeBalance += 800;
        gdpGrowth += 0.8;
      } else {
        tradeBalance += 300;
      }
      const usaPolicy = policies['USA'];
      const ussrPolicy = policies['USSR'];
      if (usaPolicy && ussrPolicy) {
        let thirdPositionScore = 0;
        if (policy.tariffRate) {
          const usaTariff = usaPolicy.tariffRate || 10;
          const diffFromUSA = Math.abs(policy.tariffRate - usaTariff);
          const diffFromUSSR = policy.isCommandEconomy ? 0 : 20;
          if (diffFromUSA > 10 && diffFromUSSR > 10) {
            thirdPositionScore += 1;
          }
        }
        if (policy.exchangeRate && policy.exchangeRate !== 1.0) {
          thirdPositionScore += 1;
        }
        if (thirdPositionScore > 0) {
          gdpGrowth += thirdPositionScore * 0.3;
        }
      }
      if (policy.governmentSpending && policy.governmentSpending > 30) {
        unemployment -= (policy.governmentSpending - 30) * 0.05;
      }
      industrialOutput *= 1.02;
      if (currentYear <= 1948) {
        tradeBalance += 200;
      }
    }

    // Random shock
    const randomShock = (Math.random() - 0.5) * 2;
    gdpGrowth += randomShock;

    // === INFLATION ===
    if (country === 'China' && currentYear >= 1948 && currentYear <= 1949) {
      inflation += 3.0;
    }
    if (country === 'Argentina') {
      if (policy.governmentSpending && policy.governmentSpending > 30) {
        inflation += (policy.governmentSpending - 30) * 0.15;
      }
      if (currentYear >= 1951) {
        inflation += 2.0;
      }
      inflation += 1.0;
    }
    if (centralBankRate < 2.0) {
      inflation += (2.0 - centralBankRate) * 2.0;
    } else if (centralBankRate > 5.0) {
      inflation -= (centralBankRate - 5.0) * 1.5;
    }
    if (globalAvgInterestRate < 2.5) {
      inflation += 1.5;
    }
    if (exchangeRate < 0.9) {
      inflation += (0.9 - exchangeRate) * 5;
    }
    inflation = Math.max(0, inflation + (Math.random() - 0.5) * 3);

    // === UNEMPLOYMENT ===
    if (country === 'China' && currentYear <= 1949) {
      unemployment += (currentYear - 1945) * 0.5;
    }
    if (gdpGrowth > 3.0) {
      unemployment -= (gdpGrowth - 3.0) * 0.3;
    } else if (gdpGrowth < 2.0) {
      unemployment += (2.0 - gdpGrowth) * 0.4;
    }
    if (tariffRate > 30) {
      unemployment -= 0.5;
      gdpGrowth -= 0.3;
    }
    unemployment = Math.max(0, Math.min(15, unemployment));

    // === INDUSTRIAL OUTPUT ===
    industrialOutput *= (1 + gdpGrowth / 100);

    // === GOLD RESERVES ===
    let goldReserves = prevData.goldReserves;
    if (tradeBalance > 0) {
      goldReserves += tradeBalance * 0.01;
    } else {
      goldReserves += tradeBalance * 0.02;
    }
    goldReserves = Math.max(0, goldReserves);

    // Exchange rate
    const exchangeRateResult = calculateExchangeRate(country, currentYear, policy, prevData, room);
    if (exchangeRateResult.change > 5) {
      tradeBalance += exchangeRateResult.change * 5;
      gdpGrowth += exchangeRateResult.change * 0.05;
    } else if (exchangeRateResult.change < -5) {
      tradeBalance += exchangeRateResult.change * 5;
      inflation += exchangeRateResult.change * 0.1;
    }
    if (exchangeRateResult.change > 10) {
      inflation += exchangeRateResult.change * 0.15;
    }

    tempResults[country] = {
      gdpGrowth: Math.round(gdpGrowth * 10) / 10,
      goldReserves: Math.round(goldReserves),
      unemployment: Math.round(unemployment * 10) / 10,
      tradeBalance: Math.round(tradeBalance),
      inflation: Math.round(inflation * 10) / 10,
      industrialOutput: Math.round(industrialOutput),
      exchangeRate: Math.round(exchangeRateResult.rate * 100) / 100,
      exchangeRateChange: Math.round(exchangeRateResult.change * 10) / 10,
      militarySpending: milSpending,
      military: { army: armySize, navy: navySize, airForce: airForceSize, total: totalMilitary }
    };
  });

  // STEP 3: Save results
  Object.keys(tempResults).forEach(country => {
    room.phase2.yearlyData[nextYear][country] = tempResults[country];
  });

  console.log(`Calculated economics for year ${nextYear} with cross-country dynamics`);
}

// ──────────────────────────────────────────────
// Phase 2 scoring
// ──────────────────────────────────────────────
function calculatePhase2Scores(room) {
  if (!room) return;

  console.log(`\n📊 Calculating Phase 2 scores`);
  console.log(`   Players:`, Object.values(room.players).map(p => `${p.country} -> ${normalizeCountryName(p.country)}`));
  console.log(`   YearlyData years:`, Object.keys(room.phase2.yearlyData || {}));

  const phase2Scores = {};
  const scoreBreakdowns = {};

  Object.values(room.players).forEach(player => {
    const rawCountry = player.country;
    const country = normalizeCountryName(rawCountry);
    console.log(`   Processing player: raw=${rawCountry}, normalized=${country}`);

    let score = 0;
    const breakdown = {
      gdp: 0, inflation: 0, unemployment: 0, trade: 0, stability: 0, brettonWoods: 0
    };

    let totalGDP = 0, totalInflation = 0, totalUnemployment = 0, yearsCount = 0;
    let positiveTradeYears = 0;

    for (let year = 1947; year <= 1952; year++) {
      let data = room.phase2.yearlyData[year]?.[country];
      if (!data && rawCountry !== country) {
        data = room.phase2.yearlyData[year]?.[rawCountry];
      }
      if (data) {
        totalGDP += data.gdpGrowth || 0;
        totalInflation += data.inflation || 0;
        totalUnemployment += data.unemployment || 0;
        if ((data.tradeBalance || 0) > 0) positiveTradeYears++;
        yearsCount++;
      }
    }

    console.log(`   ${country}: found data for ${yearsCount} years`);

    if (yearsCount > 0) {
      const avgGDP = totalGDP / yearsCount;
      const avgInflation = totalInflation / yearsCount;
      const avgUnemployment = totalUnemployment / yearsCount;

      breakdown.gdp = Math.round(avgGDP * 10);
      score += breakdown.gdp;

      if (avgInflation < 3) breakdown.inflation = 50;
      else if (avgInflation < 5) breakdown.inflation = 40;
      else if (avgInflation < 10) breakdown.inflation = 25;
      else if (avgInflation < 20) breakdown.inflation = 10;
      else breakdown.inflation = -10;
      score += breakdown.inflation;

      if (avgUnemployment < 2) breakdown.unemployment = 40;
      else if (avgUnemployment < 4) breakdown.unemployment = 30;
      else if (avgUnemployment < 6) breakdown.unemployment = 15;
      else if (avgUnemployment < 10) breakdown.unemployment = 5;
      else breakdown.unemployment = -5;
      score += breakdown.unemployment;

      breakdown.trade = positiveTradeYears * 8;
      score += breakdown.trade;

      let gdpVariance = 0;
      for (let year = 1947; year <= 1952; year++) {
        const data = room.phase2.yearlyData[year]?.[country];
        if (data) {
          gdpVariance += Math.abs(data.gdpGrowth - avgGDP);
        }
      }
      const avgVariance = gdpVariance / yearsCount;
      if (avgVariance < 1.5) breakdown.stability = 30;
      else if (avgVariance < 3) breakdown.stability = 15;
      else if (avgVariance < 5) breakdown.stability = 5;
      score += breakdown.stability;

      const agreementBonuses = calculateAgreementBonus(room);
      const bwBonus = agreementBonuses[country];
      if (bwBonus) {
        breakdown.brettonWoods = Math.round((bwBonus.gdpBonus + bwBonus.tradeBonus / 100) * 5);
        score += breakdown.brettonWoods;
      }

      if (room.phase2.diplomaticPoints && room.phase2.diplomaticPoints[country]) {
        breakdown.crisisDiplomacy = room.phase2.diplomaticPoints[country] * 2;
        score += breakdown.crisisDiplomacy;
      }
    }

    const finalScore = isNaN(score) ? 0 : Math.round(score);
    phase2Scores[country] = finalScore;
    scoreBreakdowns[country] = breakdown;

    if (!room.scores) room.scores = {};
    const prevScore = typeof room.scores[country] === 'number' ? room.scores[country] : 0;
    room.scores[country] = prevScore + finalScore;

    console.log(`   ${country}: Phase2 score=${finalScore}, Total score=${room.scores[country]}`);
  });

  room.phase2.scoreBreakdowns = scoreBreakdowns;
  console.log(`📊 Final scores:`, room.scores);
  console.log(`Phase 2 final scores:`, phase2Scores);
  console.log(`Score breakdowns:`, scoreBreakdowns);
  return phase2Scores;
}

module.exports = {
  calculateAgreementBonus,
  calculateExchangeRate,
  calculateYearEconomics,
  calculatePhase2Scores
};
