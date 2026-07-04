// deployment-impacts.js - Strategic Military Deployment System
// Calculates economic, diplomatic, and crisis effects based on WHERE troops are deployed

/**
 * DEPLOYMENT REGIONS AND STRATEGIC VALUE
 * Each region has different strategic importance and economic impact
 */
const REGIONS = {
  'Eastern Europe': {
    tradeValue: 800,           // Trade route value (millions USD)
    resourceValue: 600,         // Natural resources
    strategicImportance: 9,     // 1-10 scale
    controlBonus: {            // Bonuses for controlling region
      gdp: 0.5,
      influence: 15
    },
    rivals: ['USSR', 'USA', 'UK'], // Countries competing here
    requiredForce: {
      army: 500000,            // Minimum army needed for control
      airForce: 50000
    }
  },
  'Western Europe': {
    tradeValue: 1200,
    resourceValue: 800,
    strategicImportance: 10,
    controlBonus: { gdp: 0.8, influence: 20 },
    rivals: ['USA', 'UK', 'France', 'USSR'],
    requiredForce: { army: 300000, airForce: 40000 }
  },
  'East Asia': {
    tradeValue: 1000,
    resourceValue: 700,
    strategicImportance: 9,
    controlBonus: { gdp: 0.6, influence: 18 },
    rivals: ['USA', 'USSR', 'China'],
    requiredForce: { army: 600000, navy: 150000 }
  },
  'Southeast Asia': {
    tradeValue: 900,
    resourceValue: 500,
    strategicImportance: 7,
    controlBonus: { gdp: 0.4, influence: 12 },
    rivals: ['USA', 'UK', 'France', 'China'],
    requiredForce: { army: 200000, navy: 100000 }
  },
  'Middle East': {
    tradeValue: 1500,          // Oil!
    resourceValue: 2000,        // Massive oil reserves
    strategicImportance: 10,
    controlBonus: { gdp: 1.2, influence: 25 },
    rivals: ['USA', 'UK', 'USSR', 'France'],
    requiredForce: { army: 300000, airForce: 50000 }
  },
  'Mediterranean': {
    tradeValue: 1100,
    resourceValue: 400,
    strategicImportance: 8,
    controlBonus: { gdp: 0.5, influence: 15 },
    rivals: ['USA', 'UK', 'USSR', 'France'],
    requiredForce: { navy: 200000, airForce: 30000 }
  },
  'Atlantic Ocean': {
    tradeValue: 2000,          // Major trade routes
    resourceValue: 200,
    strategicImportance: 9,
    controlBonus: { gdp: 0.3, influence: 10, tradeBonus: 1000 },
    rivals: ['USA', 'UK', 'USSR'],
    requiredForce: { navy: 300000, airForce: 40000 }
  },
  'Pacific Ocean': {
    tradeValue: 1800,
    resourceValue: 300,
    strategicImportance: 9,
    controlBonus: { gdp: 0.3, influence: 10, tradeBonus: 900 },
    rivals: ['USA', 'USSR', 'China'],
    requiredForce: { navy: 400000, airForce: 50000 }
  },
  'Indian Ocean': {
    tradeValue: 1300,
    resourceValue: 400,
    strategicImportance: 7,
    controlBonus: { gdp: 0.2, influence: 8, tradeBonus: 600 },
    rivals: ['UK', 'USA', 'USSR', 'India'],
    requiredForce: { navy: 200000 }
  },
  'Central Asia': {
    tradeValue: 400,
    resourceValue: 600,
    strategicImportance: 6,
    controlBonus: { gdp: 0.3, influence: 10 },
    rivals: ['USSR', 'China'],
    requiredForce: { army: 300000 }
  },
  // South Asia split into India + Pakistan for historical accuracy
  'Latin America': {
    tradeValue: 800,
    resourceValue: 900,
    strategicImportance: 6,
    controlBonus: { gdp: 0.5, influence: 15 },
    rivals: ['USA', 'Argentina'],
    requiredForce: { army: 200000, navy: 100000 }
  },
  'Africa': {
    tradeValue: 600,
    resourceValue: 1200,        // Rich in resources
    strategicImportance: 6,
    controlBonus: { gdp: 0.4, influence: 12 },
    rivals: ['UK', 'France', 'USA'],
    requiredForce: { army: 250000 }
  },
  // --- New regions for historical accuracy (1946-1952) ---
  'Greece & Turkey': {
    tradeValue: 600,
    resourceValue: 300,
    strategicImportance: 9,      // Truman Doctrine (1947) - critical Cold War flashpoint
    controlBonus: { gdp: 0.4, influence: 15 },
    rivals: ['USA', 'UK', 'USSR'],
    requiredForce: { army: 200000, airForce: 30000 }
  },
  'Iran': {
    tradeValue: 800,
    resourceValue: 1500,         // Oil reserves
    strategicImportance: 8,      // Soviet withdrawal crisis 1946, oil nationalization 1951
    controlBonus: { gdp: 0.6, influence: 15 },
    rivals: ['USSR', 'UK', 'USA'],
    requiredForce: { army: 200000 }
  },
  'Taiwan': {
    tradeValue: 400,
    resourceValue: 200,
    strategicImportance: 8,      // Nationalist retreat 1949, US defense commitment
    controlBonus: { gdp: 0.3, influence: 12 },
    rivals: ['USA', 'China'],
    requiredForce: { army: 300000, navy: 100000 }
  },
  'Pakistan': {
    tradeValue: 400,
    resourceValue: 300,
    strategicImportance: 7,      // Created Aug 1947, First Kashmir War 1947-48
    controlBonus: { gdp: 0.3, influence: 10 },
    rivals: ['UK', 'India'],
    requiredForce: { army: 250000 }
  },
  'Berlin': {
    tradeValue: 200,
    resourceValue: 100,
    strategicImportance: 10,     // Berlin Blockade 1948-49, symbolic Cold War prize
    controlBonus: { gdp: 0.2, influence: 20 },
    rivals: ['USA', 'UK', 'France', 'USSR'],
    requiredForce: { army: 50000, airForce: 20000 }
  },
  'Germany': {
    tradeValue: 900,
    resourceValue: 700,
    strategicImportance: 9,      // Divided occupation zones
    controlBonus: { gdp: 0.6, influence: 18 },
    rivals: ['USA', 'UK', 'France', 'USSR'],
    requiredForce: { army: 300000 }
  },
  'Korea': {
    tradeValue: 300,
    resourceValue: 200,
    strategicImportance: 10,     // Korean War 1950-53
    controlBonus: { gdp: 0.3, influence: 15 },
    rivals: ['USA', 'USSR', 'China'],
    requiredForce: { army: 400000, airForce: 50000 }
  },
  'Suez Canal': {
    tradeValue: 1400,
    resourceValue: 100,
    strategicImportance: 9,      // Vital trade chokepoint
    controlBonus: { gdp: 0.5, influence: 15, tradeBonus: 800 },
    rivals: ['UK', 'France', 'USA'],
    requiredForce: { army: 100000, navy: 50000 }
  },
  'Indochina': {
    tradeValue: 500,
    resourceValue: 400,
    strategicImportance: 8,      // First Indochina War 1946-54
    controlBonus: { gdp: 0.3, influence: 12 },
    rivals: ['France', 'China', 'USA'],
    requiredForce: { army: 300000 }
  },
  'India': {
    tradeValue: 700,
    resourceValue: 500,
    strategicImportance: 7,
    controlBonus: { gdp: 0.4, influence: 12 },
    rivals: ['UK', 'India'],
    requiredForce: { army: 400000 }
  }
};

/**
 * Calculate regional control based on deployments
 * Returns which country controls each region and by how much
 */
function calculateRegionalControl(deployments, year) {
  const control = {};
  
  // Group deployments by region
  const regionDeployments = {};
  deployments
    .filter(d => d.year === year)
    .forEach(d => {
      if (!regionDeployments[d.region]) {
        regionDeployments[d.region] = [];
      }
      regionDeployments[d.region].push(d);
    });
  
  // Calculate control for each region
  Object.keys(REGIONS).forEach(region => {
    const regionData = REGIONS[region];
    const deploymentsHere = regionDeployments[region] || [];
    
    if (deploymentsHere.length === 0) {
      control[region] = { controller: null, strength: 0, contested: false };
      return;
    }
    
    // Calculate military strength for each country
    const countryStrength = {};
    deploymentsHere.forEach(d => {
      if (!countryStrength[d.country]) {
        countryStrength[d.country] = 0;
      }
      
      // Calculate effective strength based on deployment type
      let strength = 0;
      
      // Army strength (varies by region type)
      if (d.branch === 'army' || !d.branch) {
        strength += d.troops * 1.0;
      }
      
      // Navy strength (critical for ocean/coastal regions)
      if (d.branch === 'navy') {
        const isNavalRegion = region.includes('Ocean') || region === 'Mediterranean';
        strength += d.troops * (isNavalRegion ? 2.0 : 0.5);
      }
      
      // Air Force strength (force multiplier)
      if (d.branch === 'airForce') {
        strength += d.troops * 1.5;
      }
      
      countryStrength[d.country] += strength;
    });
    
    // Find strongest country
    const countries = Object.keys(countryStrength);
    if (countries.length === 0) {
      control[region] = { controller: null, strength: 0, contested: false };
      return;
    }
    
    countries.sort((a, b) => countryStrength[b] - countryStrength[a]);
    const strongest = countries[0];
    const secondStrongest = countries[1];
    
    // Check if region is contested (within 30% strength)
    const contested = secondStrongest && 
      countryStrength[secondStrongest] > countryStrength[strongest] * 0.7;
    
    // Check if controller meets minimum force requirements
    const meetsRequirements = checkForceRequirements(
      deploymentsHere.filter(d => d.country === strongest),
      regionData.requiredForce
    );
    
    control[region] = {
      controller: meetsRequirements ? strongest : null,
      strength: countryStrength[strongest],
      contested: contested,
      competitors: countries,
      competitorStrength: countryStrength
    };
  });
  
  return control;
}

/**
 * Check if deployments meet force requirements
 */
function checkForceRequirements(deployments, requirements) {
  const forces = { army: 0, navy: 0, airForce: 0 };
  
  deployments.forEach(d => {
    const branch = d.branch || 'army';
    forces[branch] += d.troops;
  });
  
  return (!requirements.army || forces.army >= requirements.army) &&
         (!requirements.navy || forces.navy >= requirements.navy) &&
         (!requirements.airForce || forces.airForce >= requirements.airForce);
}

/**
 * Calculate economic benefits from deployments
 */
function calculateDeploymentEconomics(country, deployments, regionalControl, yearData) {
  const benefits = {
    gdpGrowth: 0,
    tradeBalance: 0,
    resourceBonus: 0,
    influence: 0,
    details: []
  };
  
  // For each region this country controls
  Object.entries(regionalControl).forEach(([region, control]) => {
    if (control.controller !== country) return;
    
    const regionData = REGIONS[region];
    
    // Apply control bonuses
    if (regionData.controlBonus.gdp) {
      benefits.gdpGrowth += regionData.controlBonus.gdp;
      benefits.details.push(`${region} control: +${regionData.controlBonus.gdp}% GDP`);
    }
    
    if (regionData.controlBonus.tradeBonus) {
      benefits.tradeBalance += regionData.controlBonus.tradeBonus;
      benefits.details.push(`${region} trade routes: +$${regionData.controlBonus.tradeBonus}M`);
    }
    
    if (regionData.controlBonus.influence) {
      benefits.influence += regionData.controlBonus.influence;
    }
    
    // Resource extraction bonus (reduced if contested)
    const contestedPenalty = control.contested ? 0.5 : 1.0;
    const resourceBonus = regionData.resourceValue * contestedPenalty * 0.15;
    benefits.resourceBonus += resourceBonus;
    benefits.tradeBalance += resourceBonus;
    benefits.details.push(`${region} resources: +$${Math.round(resourceBonus)}M${control.contested ? ' (contested)' : ''}`);
  });
  
  // Naval protection of trade routes
  const navalDeployments = deployments.filter(d => 
    d.country === country && 
    d.branch === 'navy' &&
    (d.region.includes('Ocean') || d.region === 'Mediterranean')
  );
  
  navalDeployments.forEach(d => {
    const protection = Math.min(d.troops / 50000, 10) * 100; // Up to $1000M
    benefits.tradeBalance += protection;
    benefits.details.push(`${d.region} naval protection: +$${Math.round(protection)}M`);
  });
  
  // Overextension penalty (too many deployments)
  const countryDeployments = deployments.filter(d => d.country === country);
  if (countryDeployments.length > 5) {
    const penalty = (countryDeployments.length - 5) * 0.2;
    benefits.gdpGrowth -= penalty;
    benefits.details.push(`Overextension penalty: -${penalty}% GDP`);
  }
  
  return benefits;
}

/**
 * Calculate deployment costs
 */
function calculateDeploymentCosts(country, deployments, yearData) {
  const costs = {
    maintenanceCost: 0,
    logisticsCost: 0,
    totalCost: 0,
    details: []
  };
  
  const countryDeployments = deployments.filter(d => d.country === country);
  
  countryDeployments.forEach(d => {
    // Base maintenance (higher for distant deployments)
    const distanceFactor = getDistanceFactor(country, d.region);
    const baseCost = d.troops * distanceFactor * 0.5; // $0.5-2 per soldier
    
    // Branch-specific costs
    let branchMultiplier = 1.0;
    if (d.branch === 'navy') branchMultiplier = 4.0;
    if (d.branch === 'airForce') branchMultiplier = 6.0;
    
    const maintenance = baseCost * branchMultiplier;
    costs.maintenanceCost += maintenance;
    
    // Logistics cost (supply lines)
    const logistics = (d.troops / 10000) * distanceFactor * 50;
    costs.logisticsCost += logistics;
  });
  
  costs.totalCost = costs.maintenanceCost + costs.logisticsCost;
  
  // Convert to GDP impact (cost as % of military spending)
  const gdpImpact = -(costs.totalCost / 10000) * 0.1;
  costs.gdpImpact = gdpImpact;
  costs.details.push(`Deployment costs: ${Math.round(costs.totalCost)}M = ${Math.abs(gdpImpact).toFixed(1)}% GDP`);
  
  return costs;
}

/**
 * Get distance factor (1.0 = near, 2.0 = far)
 */
function getDistanceFactor(country, region) {
  const distanceMap = {
    'USA': {
      'Western Europe': 1.5, 'Eastern Europe': 2.0, 'East Asia': 1.8, 'Southeast Asia': 1.7,
      'Middle East': 1.8, 'Mediterranean': 1.6, 'Atlantic Ocean': 1.0, 'Pacific Ocean': 1.2,
      'Indian Ocean': 2.0, 'Central Asia': 2.0, 'South Asia': 1.9, 'Latin America': 1.0, 'Africa': 1.7
    },
    'USSR': {
      'Western Europe': 1.2, 'Eastern Europe': 1.0, 'East Asia': 1.3, 'Southeast Asia': 1.6,
      'Middle East': 1.2, 'Mediterranean': 1.4, 'Atlantic Ocean': 1.8, 'Pacific Ocean': 1.5,
      'Indian Ocean': 1.7, 'Central Asia': 1.0, 'South Asia': 1.3, 'Latin America': 2.0, 'Africa': 1.6
    },
    'UK': {
      'Western Europe': 1.0, 'Eastern Europe': 1.3, 'East Asia': 1.9, 'Southeast Asia': 1.6,
      'Middle East': 1.3, 'Mediterranean': 1.1, 'Atlantic Ocean': 1.0, 'Pacific Ocean': 1.9,
      'Indian Ocean': 1.4, 'Central Asia': 1.8, 'South Asia': 1.5, 'Latin America': 1.6, 'Africa': 1.2
    },
    'France': {
      'Western Europe': 1.0, 'Eastern Europe': 1.4, 'East Asia': 2.0, 'Southeast Asia': 1.5,
      'Middle East': 1.3, 'Mediterranean': 1.0, 'Atlantic Ocean': 1.1, 'Pacific Ocean': 2.0,
      'Indian Ocean': 1.6, 'Central Asia': 1.9, 'South Asia': 1.7, 'Latin America': 1.7, 'Africa': 1.1
    },
    'China': {
      'Western Europe': 2.0, 'Eastern Europe': 1.8, 'East Asia': 1.0, 'Southeast Asia': 1.1,
      'Middle East': 1.6, 'Mediterranean': 2.0, 'Atlantic Ocean': 2.0, 'Pacific Ocean': 1.2,
      'Indian Ocean': 1.5, 'Central Asia': 1.2, 'South Asia': 1.3, 'Latin America': 2.0, 'Africa': 1.8
    },
    'India': {
      'Western Europe': 1.8, 'Eastern Europe': 1.9, 'East Asia': 1.5, 'Southeast Asia': 1.2,
      'Middle East': 1.3, 'Mediterranean': 1.7, 'Atlantic Ocean': 1.9, 'Pacific Ocean': 1.6,
      'Indian Ocean': 1.0, 'Central Asia': 1.4, 'South Asia': 1.0, 'Latin America': 2.0, 'Africa': 1.4
    },
    'Argentina': {
      'Western Europe': 1.7, 'Eastern Europe': 2.0, 'East Asia': 2.0, 'Southeast Asia': 2.0,
      'Middle East': 2.0, 'Mediterranean': 1.8, 'Atlantic Ocean': 1.3, 'Pacific Ocean': 1.5,
      'Indian Ocean': 2.0, 'Central Asia': 2.0, 'South Asia': 2.0, 'Latin America': 1.0, 'Africa': 1.6
    }
  };
  
  return distanceMap[country]?.[region] || 1.5;
}

/**
 * Calculate crisis response modifiers based on deployments
 */
function getCrisisDeploymentBonus(country, crisis, deployments, regionalControl) {
  const bonus = {
    responseBonus: 0,
    availableOptions: [],
    blockedOptions: [],
    details: []
  };
  
  // If crisis has a region, check if country has forces there
  if (crisis.region) {
    const control = regionalControl[crisis.region];
    const deployed = deployments.some(d => 
      d.country === country && 
      d.region === crisis.region &&
      d.troops > 0
    );
    
    if (deployed) {
      bonus.responseBonus += 10; // Faster response time
      bonus.details.push(`Forces already in ${crisis.region}: +10 diplomatic points`);
    }
    
    // If country controls the region, major bonus
    if (control?.controller === country) {
      bonus.responseBonus += 25;
      bonus.details.push(`Controls ${crisis.region}: +25 diplomatic points`);
    }
    
    // If region is contested, penalty
    if (control?.contested) {
      bonus.responseBonus -= 5;
      bonus.details.push(`Contested region: -5 diplomatic points`);
    }
  }
  
  // Check if deployments unlock special crisis options
  // (This would be defined in crisis events with deployment requirements)
  if (crisis.deploymentOptions) {
    crisis.deploymentOptions.forEach(opt => {
      const hasDeployment = deployments.some(d =>
        d.country === country &&
        d.region === opt.requiredRegion &&
        d.troops >= opt.requiredTroops &&
        (!opt.requiredBranch || d.branch === opt.requiredBranch)
      );
      
      if (hasDeployment) {
        bonus.availableOptions.push(opt.id);
        bonus.details.push(`Unlocked option: ${opt.text}`);
      }
    });
  }
  
  return bonus;
}

/**
 * Calculate diplomatic influence from military presence
 */
function calculateDiplomaticInfluence(deployments, regionalControl, year) {
  const influence = {};
  
  // For each country with deployments
  const countries = [...new Set(deployments.map(d => d.country))];
  
  countries.forEach(country => {
    let totalInfluence = 0;
    const regions = [];
    
    // Influence from controlled regions
    Object.entries(regionalControl).forEach(([region, control]) => {
      if (control.controller === country) {
        const regionData = REGIONS[region];
        const influenceGain = regionData.controlBonus.influence || 0;
        totalInfluence += influenceGain;
        regions.push(region);
      }
    });
    
    // Influence from being deployed (even without control)
    const countryDeployments = deployments.filter(d => d.country === country);
    const uniqueRegions = [...new Set(countryDeployments.map(d => d.region))];
    totalInfluence += uniqueRegions.length * 2; // 2 points per region presence
    
    influence[country] = {
      total: totalInfluence,
      controlledRegions: regions,
      deployedRegions: uniqueRegions,
      globalReach: uniqueRegions.length
    };
  });
  
  return influence;
}

/**
 * Detect conflicts from overlapping deployments
 */
function detectDeploymentConflicts(deployments, year) {
  const conflicts = [];
  const regionGroups = {};
  
  // Group by region
  deployments
    .filter(d => d.year === year)
    .forEach(d => {
      if (!regionGroups[d.region]) {
        regionGroups[d.region] = [];
      }
      regionGroups[d.region].push(d);
    });
  
  // Find conflicts
  Object.entries(regionGroups).forEach(([region, deps]) => {
    const countries = [...new Set(deps.map(d => d.country))];
    
    if (countries.length > 1) {
      const regionData = REGIONS[region];
      const isStrategic = regionData && regionData.strategicImportance >= 7;
      
      // Check if these countries are rivals
      const hasRivals = regionData && countries.some(c1 => 
        countries.some(c2 => 
          c1 !== c2 && regionData.rivals.includes(c1) && regionData.rivals.includes(c2)
        )
      );
      
      const conflictLevel = isStrategic && hasRivals ? 'high' : 
                           isStrategic ? 'medium' : 'low';
      
      conflicts.push({
        region,
        countries,
        level: conflictLevel,
        strategicImportance: regionData?.strategicImportance || 0,
        description: `${countries.join(' vs ')} in ${region}`
      });
    }
  });
  
  return conflicts;
}

/**
 * Main function: Apply all deployment effects to year economics
 */
function applyDeploymentEffects(room, country, deployments, yearData, currentYear) {
  const effects = {
    gdpGrowth: 0,
    tradeBalance: 0,
    influence: 0,
    details: []
  };
  
  // Calculate regional control
  const regionalControl = calculateRegionalControl(deployments, currentYear);
  
  // Get economic benefits
  const economics = calculateDeploymentEconomics(country, deployments, regionalControl, yearData);
  effects.gdpGrowth += economics.gdpGrowth;
  effects.tradeBalance += economics.tradeBalance;
  effects.influence += economics.influence;
  effects.details.push(...economics.details);
  
  // Get deployment costs
  const costs = calculateDeploymentCosts(country, deployments, yearData);
  effects.gdpGrowth += costs.gdpImpact;
  effects.tradeBalance -= costs.totalCost * 0.5; // Costs hurt trade balance
  effects.details.push(...costs.details);
  
  // Store regional control info for display
  effects.regionalControl = regionalControl;
  
  return effects;
}


function calculateDeploymentImpacts(country, region, troops, yearlyData) {
  if (!country || !region || !troops) return null;
  
  try {
    return {
      region,
      troops,
      regionalControl: calculateRegionalControl(country, region, troops),
      economics: calculateDeploymentEconomics(country, region, troops, yearlyData),
      costs: calculateDeploymentCosts(troops),
      crisisBonus: getCrisisDeploymentBonus(region, troops),
      influence: calculateDiplomaticInfluence(country, region, troops, yearlyData)
    };
  } catch (err) {
    console.error('Error calculating impacts:', err.message);
    return null;
  }
}
module.exports = {
  REGIONS,
  calculateRegionalControl,
  calculateDeploymentEconomics,
  calculateDeploymentCosts,
  getCrisisDeploymentBonus,
  calculateDiplomaticInfluence,
  detectDeploymentConflicts,
  applyDeploymentEffects
};
