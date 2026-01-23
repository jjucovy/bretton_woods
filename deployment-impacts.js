// deployment-impacts.js - Strategic Military Deployment System
// Calculates economic, diplomatic, and crisis effects based on WHERE troops are deployed

const REGIONS = {
  'Eastern Europe': { tradeValue: 800, resourceValue: 600, strategicImportance: 9, controlBonus: { gdp: 0.5, influence: 15 }, rivals: ['USSR', 'USA', 'UK'], requiredForce: { army: 500000, airForce: 50000 } },
  'Western Europe': { tradeValue: 1200, resourceValue: 800, strategicImportance: 10, controlBonus: { gdp: 0.8, influence: 20 }, rivals: ['USA', 'UK', 'France', 'USSR'], requiredForce: { army: 300000, airForce: 40000 } },
  'East Asia': { tradeValue: 1000, resourceValue: 700, strategicImportance: 9, controlBonus: { gdp: 0.6, influence: 18 }, rivals: ['USA', 'USSR', 'China'], requiredForce: { army: 600000, navy: 150000 } },
  'Southeast Asia': { tradeValue: 900, resourceValue: 500, strategicImportance: 7, controlBonus: { gdp: 0.4, influence: 12 }, rivals: ['USA', 'UK', 'France', 'China'], requiredForce: { army: 200000, navy: 100000 } },
  'Middle East': { tradeValue: 1500, resourceValue: 2000, strategicImportance: 10, controlBonus: { gdp: 1.2, influence: 25 }, rivals: ['USA', 'UK', 'USSR', 'France'], requiredForce: { army: 300000, airForce: 50000 } },
  'Mediterranean': { tradeValue: 1100, resourceValue: 400, strategicImportance: 8, controlBonus: { gdp: 0.5, influence: 15 }, rivals: ['USA', 'UK', 'USSR', 'France'], requiredForce: { navy: 200000, airForce: 30000 } },
  'Atlantic Ocean': { tradeValue: 2000, resourceValue: 200, strategicImportance: 9, controlBonus: { gdp: 0.3, influence: 10, tradeBonus: 1000 }, rivals: ['USA', 'UK', 'USSR'], requiredForce: { navy: 300000, airForce: 40000 } },
  'Pacific Ocean': { tradeValue: 1800, resourceValue: 300, strategicImportance: 9, controlBonus: { gdp: 0.3, influence: 10, tradeBonus: 900 }, rivals: ['USA', 'USSR', 'China'], requiredForce: { navy: 400000, airForce: 50000 } },
  'Indian Ocean': { tradeValue: 1300, resourceValue: 400, strategicImportance: 7, controlBonus: { gdp: 0.2, influence: 8, tradeBonus: 600 }, rivals: ['UK', 'USA', 'USSR', 'India'], requiredForce: { navy: 200000 } },
  'Central Asia': { tradeValue: 400, resourceValue: 600, strategicImportance: 6, controlBonus: { gdp: 0.3, influence: 10 }, rivals: ['USSR', 'China'], requiredForce: { army: 300000 } },
  'South Asia': { tradeValue: 700, resourceValue: 500, strategicImportance: 7, controlBonus: { gdp: 0.4, influence: 12 }, rivals: ['UK', 'India', 'China'], requiredForce: { army: 400000 } },
  'Latin America': { tradeValue: 800, resourceValue: 900, strategicImportance: 6, controlBonus: { gdp: 0.5, influence: 15 }, rivals: ['USA', 'Argentina'], requiredForce: { army: 200000, navy: 100000 } },
  'Africa': { tradeValue: 600, resourceValue: 1200, strategicImportance: 6, controlBonus: { gdp: 0.4, influence: 12 }, rivals: ['UK', 'France', 'USA'], requiredForce: { army: 250000 } }
};

function calculateRegionalControl(deployments, year) {
  const control = {};
  if (!Array.isArray(deployments)) return control;

  const regionDeployments = {};
  deployments.filter(d => d && d.year === year).forEach(d => {
    if (!regionDeployments[d.region]) regionDeployments[d.region] = [];
    regionDeployments[d.region].push(d);
  });

  Object.keys(REGIONS).forEach(region => {
    const deploymentsHere = regionDeployments[region] || [];
    if (deploymentsHere.length === 0) {
      control[region] = { controller: null, strength: 0, contested: false };
      return;
    }

    const countryStrength = {};
    deploymentsHere.forEach(d => {
      if (!countryStrength[d.country]) countryStrength[d.country] = 0;
      let strength = 0;
      if (d.branch === 'army' || !d.branch) strength += d.troops * 1.0;
      if (d.branch === 'navy') strength += d.troops * (region.includes('Ocean') || region === 'Mediterranean' ? 2.0 : 0.5);
      if (d.branch === 'airForce') strength += d.troops * 1.5;
      countryStrength[d.country] += strength;
    });

    const countries = Object.keys(countryStrength).sort((a, b) => countryStrength[b] - countryStrength[a]);
    if (countries.length === 0) {
      control[region] = { controller: null, strength: 0, contested: false };
      return;
    }

    const strongest = countries[0];
    const contested = countries[1] && countryStrength[countries[1]] > countryStrength[strongest] * 0.7;
    const meetsRequirements = checkForceRequirements(deploymentsHere.filter(d => d.country === strongest), REGIONS[region].requiredForce);

    control[region] = { controller: meetsRequirements ? strongest : null, strength: countryStrength[strongest], contested, competitors: countries, competitorStrength: countryStrength };
  });
  return control;
}

function checkForceRequirements(deployments, requirements) {
  const forces = { army: 0, navy: 0, airForce: 0 };
  deployments.forEach(d => { const branch = d.branch || 'army'; forces[branch] += d.troops; });
  return (!requirements.army || forces.army >= requirements.army) && (!requirements.navy || forces.navy >= requirements.navy) && (!requirements.airForce || forces.airForce >= requirements.airForce);
}

function calculateDeploymentEconomics(country, deployments, regionalControl, yearData) {
  const benefits = { gdpGrowth: 0, tradeBalance: 0, resourceBonus: 0, influence: 0, details: [] };
  Object.entries(regionalControl).forEach(([region, control]) => {
    if (control.controller !== country) return;
    const rd = REGIONS[region];
    if (rd.controlBonus.gdp) { benefits.gdpGrowth += rd.controlBonus.gdp; benefits.details.push(`${region}: +${rd.controlBonus.gdp}% GDP`); }
    if (rd.controlBonus.influence) { benefits.influence += rd.controlBonus.influence; benefits.details.push(`${region}: +${rd.controlBonus.influence} influence`); }
    if (rd.controlBonus.tradeBonus) { benefits.tradeBalance += rd.controlBonus.tradeBonus; benefits.details.push(`${region}: +${rd.controlBonus.tradeBonus}M USD`); }
    benefits.resourceBonus += rd.resourceValue * 0.01;
  });
  return benefits;
}

function calculateDeploymentCosts(country, deployments, yearData) {
  const costs = { totalCost: 0, gdpImpact: 0, details: [] };
  if (!Array.isArray(deployments)) return costs;
  deployments.filter(d => d && d.country === country).forEach(d => {
    const cost = d.troops * 0.001 * (d.branch === 'navy' ? 1.5 : (d.branch === 'airForce' ? 2.0 : 1.0));
    costs.totalCost += cost;
    costs.details.push(`${d.branch} in ${d.region}: ${cost.toFixed(1)}M USD`);
  });
  costs.gdpImpact = -(costs.totalCost * 0.15);
  return costs;
}

function getCrisisDeploymentBonus(crisisRegion, country, deployments, regionalControl) {
  if (!Array.isArray(deployments)) return 0;
  if (regionalControl[crisisRegion] && regionalControl[crisisRegion].controller === country) return 20;
  if (deployments.some(d => d && d.country === country && d.region === crisisRegion)) return 10;
  return 5;
}

function calculateDiplomaticInfluence(country, deployments, regionalControl, yearData) {
  let influence = 0;
  if (!Array.isArray(deployments)) return influence;
  influence += deployments.filter(d => d && d.country === country).length * 2;
  Object.entries(regionalControl).forEach(([region, control]) => { if (control.controller === country) influence += 5; });
  return influence;
}

function detectDeploymentConflicts(deployments) {
  const conflicts = [];
  if (!Array.isArray(deployments)) return conflicts;
  const regionDeployments = {};
  deployments.filter(d => d && d.region).forEach(d => {
    if (!regionDeployments[d.region]) regionDeployments[d.region] = [];
    regionDeployments[d.region].push(d);
  });
  Object.entries(regionDeployments).forEach(([region, deps]) => {
    const countries = [...new Set(deps.map(d => d.country))];
    if (countries.length > 1) {
      const countryTroops = {};
      deps.forEach(d => { if (!countryTroops[d.country]) countryTroops[d.country] = 0; countryTroops[d.country] += d.troops; });
      conflicts.push({ region, countries, countryTroops, severity: countries.length > 2 ? 'high' : 'medium' });
    }
  });
  return conflicts;
}

function applyDeploymentEffects(room, country, deployments, yearData, currentYear) {
  const effects = { gdpGrowth: 0, tradeBalance: 0, influence: 0, details: [] };
  if (!Array.isArray(deployments)) return effects;
  const rc = calculateRegionalControl(deployments, currentYear);
  const econ = calculateDeploymentEconomics(country, deployments, rc, yearData);
  effects.gdpGrowth += econ.gdpGrowth;
  effects.tradeBalance += econ.tradeBalance;
  effects.influence += econ.influence;
  effects.details.push(...econ.details);
  const costs = calculateDeploymentCosts(country, deployments, yearData);
  effects.gdpGrowth += costs.gdpImpact;
  effects.tradeBalance -= costs.totalCost * 0.5;
  effects.details.push(...costs.details);
  effects.regionalControl = rc;
  return effects;
}

function calculateDeploymentImpacts(deployments, country, region, troops, yearlyData) {
  if (!country || !region || !troops) return null;
  try {
    const deps = Array.isArray(deployments) ? deployments : [];
    return {
      region, troops,
      regionalControl: calculateRegionalControl(deps, 1946),
      economics: calculateDeploymentEconomics(country, deps, {}, yearlyData),
      costs: calculateDeploymentCosts(country, deps, yearlyData),
      crisisBonus: getCrisisDeploymentBonus(region, country, deps, {}),
      influence: calculateDiplomaticInfluence(country, deps, {}, yearlyData)
    };
  } catch (err) {
    console.error('Error calculating impacts:', err.message);
    return null;
  }
}

module.exports = { REGIONS, calculateRegionalControl, checkForceRequirements, calculateDeploymentEconomics, calculateDeploymentCosts, getCrisisDeploymentBonus, calculateDiplomaticInfluence, detectDeploymentConflicts, applyDeploymentEffects, calculateDeploymentImpacts };
