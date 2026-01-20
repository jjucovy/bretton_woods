// deployment-ui.js - Enhanced Deployment Interface
// Add this to your client-side JavaScript

class DeploymentUI {
  constructor(gameState, playerCountry) {
    this.gameState = gameState;
    this.playerCountry = playerCountry;
    this.selectedBranch = 'army';
    this.selectedRegion = null;
  }
  
  /**
   * Render deployment interface
   */
  render() {
    const html = `
      <div class="deployment-panel">
        <h2>🗺️ Military Deployments - Year ${this.gameState.phase2.currentYear}</h2>
        
        <!-- Force Summary -->
        <div class="force-summary">
          <h3>Available Forces (${this.playerCountry})</h3>
          <div class="force-display">
            <div class="force-item">
              <span class="icon">🪖</span>
              <span class="label">Army:</span>
              <span class="value">${this.getAvailableForces('army').toLocaleString()}</span>
            </div>
            <div class="force-item">
              <span class="icon">⚓</span>
              <span class="label">Navy:</span>
              <span class="value">${this.getAvailableForces('navy').toLocaleString()}</span>
            </div>
            <div class="force-item">
              <span class="icon">✈️</span>
              <span class="label">Air Force:</span>
              <span class="value">${this.getAvailableForces('airForce').toLocaleString()}</span>
            </div>
          </div>
        </div>
        
        <!-- Deployment Form -->
        <div class="deployment-form">
          <h3>New Deployment</h3>
          
          <div class="form-group">
            <label>Military Branch:</label>
            <div class="branch-selector">
              <button class="branch-btn ${this.selectedBranch === 'army' ? 'active' : ''}" 
                      onclick="deploymentUI.selectBranch('army')">
                🪖 Army
              </button>
              <button class="branch-btn ${this.selectedBranch === 'navy' ? 'active' : ''}" 
                      onclick="deploymentUI.selectBranch('navy')">
                ⚓ Navy
              </button>
              <button class="branch-btn ${this.selectedBranch === 'airForce' ? 'active' : ''}" 
                      onclick="deploymentUI.selectBranch('airForce')">
                ✈️ Air Force
              </button>
            </div>
          </div>
          
          <div class="form-group">
            <label>Region:</label>
            <select id="deployRegion" onchange="deploymentUI.selectRegion(this.value)">
              <option value="">-- Select Region --</option>
              ${this.renderRegionOptions()}
            </select>
          </div>
          
          <div class="form-group">
            <label>Troops to Deploy:</label>
            <input type="number" id="deployTroops" 
                   min="10000" 
                   max="${this.getAvailableForces(this.selectedBranch)}"
                   step="10000" 
                   value="50000">
            <small>Max: ${this.getAvailableForces(this.selectedBranch).toLocaleString()}</small>
          </div>
          
          ${this.selectedRegion ? this.renderRegionInfo() : ''}
          
          <button class="deploy-btn" onclick="deploymentUI.submitDeployment()">
            Deploy Forces
          </button>
        </div>
        
        <!-- Current Deployments Map -->
        <div class="deployment-map">
          <h3>Global Deployment Map</h3>
          ${this.renderDeploymentMap()}
        </div>
        
        <!-- Regional Control Summary -->
        <div class="control-summary">
          <h3>Regional Control</h3>
          ${this.renderControlSummary()}
        </div>
        
        <!-- Conflicts Alert -->
        ${this.renderConflicts()}
      </div>
    `;
    
    return html;
  }
  
  /**
   * Get available forces for a branch (total - deployed)
   */
  getAvailableForces(branch) {
    const yearData = this.gameState.phase2.yearlyData[this.gameState.phase2.currentYear];
    const countryData = yearData?.[this.playerCountry];
    
    if (!countryData?.military) return 0;
    
    // Total forces
    const total = countryData.military[branch] || 0;
    
    // Subtract deployed forces
    const deployments = this.gameState.phase2.deployments || [];
    const deployed = deployments
      .filter(d => 
        d.country === this.playerCountry && 
        d.branch === branch &&
        d.year === this.gameState.phase2.currentYear
      )
      .reduce((sum, d) => sum + d.troops, 0);
    
    return Math.max(0, total - deployed);
  }
  
  /**
   * Render region dropdown options with strategic value
   */
  renderRegionOptions() {
    const regions = [
      'Eastern Europe', 'Western Europe', 'East Asia', 'Southeast Asia',
      'Middle East', 'Mediterranean', 'Atlantic Ocean', 'Pacific Ocean',
      'Indian Ocean', 'Central Asia', 'South Asia', 'Latin America', 'Africa'
    ];
    
    return regions.map(region => {
      const info = this.getRegionStrategicValue(region);
      return `<option value="${region}">${region} (★${info.importance}/10)</option>`;
    }).join('');
  }
  
  /**
   * Get region strategic value (would come from server)
   */
  getRegionStrategicValue(region) {
    const values = {
      'Western Europe': { importance: 10, trade: 1200 },
      'Middle East': { importance: 10, trade: 1500 },
      'Eastern Europe': { importance: 9, trade: 800 },
      'East Asia': { importance: 9, trade: 1000 },
      'Atlantic Ocean': { importance: 9, trade: 2000 },
      'Pacific Ocean': { importance: 9, trade: 1800 },
      'Mediterranean': { importance: 8, trade: 1100 },
      'Southeast Asia': { importance: 7, trade: 900 },
      'South Asia': { importance: 7, trade: 700 },
      'Indian Ocean': { importance: 7, trade: 1300 },
      'Central Asia': { importance: 6, trade: 400 },
      'Latin America': { importance: 6, trade: 800 },
      'Africa': { importance: 6, trade: 600 }
    };
    return values[region] || { importance: 5, trade: 500 };
  }
  
  /**
   * Render region information panel
   */
  renderRegionInfo() {
    if (!this.selectedRegion) return '';
    
    const info = this.getRegionStrategicValue(this.selectedRegion);
    const control = this.getRegionalControl(this.selectedRegion);
    
    return `
      <div class="region-info">
        <h4>${this.selectedRegion}</h4>
        <div class="region-stats">
          <div class="stat">
            <label>Strategic Importance:</label>
            <div class="importance-bar">
              ${'★'.repeat(info.importance)}${'☆'.repeat(10 - info.importance)}
            </div>
          </div>
          <div class="stat">
            <label>Trade Value:</label>
            <span>$${info.trade}M annually</span>
          </div>
          <div class="stat">
            <label>Current Control:</label>
            <span class="${control.contested ? 'contested' : ''}">
              ${control.controller || 'Neutral'}
              ${control.contested ? ' (Contested!)' : ''}
            </span>
          </div>
          ${this.renderDeploymentRecommendation()}
        </div>
      </div>
    `;
  }
  
  /**
   * Get who controls a region
   */
  getRegionalControl(region) {
    // This would come from server state
    const deployments = this.gameState.phase2.deployments || [];
    const regionDeps = deployments.filter(d => 
      d.region === region && 
      d.year === this.gameState.phase2.currentYear
    );
    
    if (regionDeps.length === 0) {
      return { controller: null, contested: false };
    }
    
    // Simple calculation - most troops
    const countryStrength = {};
    regionDeps.forEach(d => {
      countryStrength[d.country] = (countryStrength[d.country] || 0) + d.troops;
    });
    
    const countries = Object.keys(countryStrength).sort((a, b) => 
      countryStrength[b] - countryStrength[a]
    );
    
    const contested = countries.length > 1 && 
      countryStrength[countries[1]] > countryStrength[countries[0]] * 0.7;
    
    return {
      controller: countries[0],
      contested: contested
    };
  }
  
  /**
   * Provide deployment recommendations
   */
  renderDeploymentRecommendation() {
    const isNaval = this.selectedRegion.includes('Ocean') || 
                    this.selectedRegion === 'Mediterranean';
    
    let recommendation = '';
    if (isNaval && this.selectedBranch !== 'navy') {
      recommendation = '⚠️ Tip: Naval regions require navy deployments for full effectiveness';
    } else if (!isNaval && this.selectedBranch === 'navy') {
      recommendation = '⚠️ Tip: Navy is less effective in land regions';
    } else if (this.selectedBranch === 'airForce') {
      recommendation = '💡 Tip: Air Force provides force multiplier but is expensive';
    }
    
    return recommendation ? `<div class="recommendation">${recommendation}</div>` : '';
  }
  
  /**
   * Render deployment map showing all deployments
   */
  renderDeploymentMap() {
    const deployments = this.gameState.phase2.deployments || [];
    const currentDeps = deployments.filter(d => 
      d.year === this.gameState.phase2.currentYear
    );
    
    // Group by region
    const regions = {};
    currentDeps.forEach(d => {
      if (!regions[d.region]) regions[d.region] = [];
      regions[d.region].push(d);
    });
    
    return `
      <div class="map-grid">
        ${Object.entries(regions).map(([region, deps]) => `
          <div class="map-region ${this.hasPlayerDeployment(region) ? 'player-controlled' : ''}">
            <div class="region-name">${region}</div>
            <div class="region-forces">
              ${deps.map(d => `
                <div class="force-marker ${d.country === this.playerCountry ? 'player' : 'enemy'}">
                  <span class="country-flag">${this.getCountryFlag(d.country)}</span>
                  <span class="force-count">${this.formatTroops(d.troops)} ${this.getBranchIcon(d.branch)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  /**
   * Check if player has deployment in region
   */
  hasPlayerDeployment(region) {
    const deployments = this.gameState.phase2.deployments || [];
    return deployments.some(d => 
      d.country === this.playerCountry && 
      d.region === region &&
      d.year === this.gameState.phase2.currentYear
    );
  }
  
  /**
   * Render regional control summary
   */
  renderControlSummary() {
    const regions = [
      'Eastern Europe', 'Western Europe', 'East Asia', 'Southeast Asia',
      'Middle East', 'Mediterranean', 'Atlantic Ocean', 'Pacific Ocean',
      'Indian Ocean', 'Central Asia', 'South Asia', 'Latin America', 'Africa'
    ];
    
    const controlled = regions.filter(r => {
      const control = this.getRegionalControl(r);
      return control.controller === this.playerCountry;
    });
    
    return `
      <div class="control-stats">
        <div class="stat-large">
          <div class="stat-value">${controlled.length}</div>
          <div class="stat-label">Regions Controlled</div>
        </div>
        <div class="controlled-regions">
          ${controlled.map(r => `
            <span class="region-badge">${r}</span>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  /**
   * Render conflict alerts
   */
  renderConflicts() {
    const conflicts = this.gameState.phase2.conflicts || [];
    
    if (conflicts.length === 0) {
      return '<div class="no-conflicts">✅ No active military conflicts</div>';
    }
    
    return `
      <div class="conflicts-panel">
        <h3>⚠️ Military Tensions</h3>
        ${conflicts.map(c => `
          <div class="conflict-alert level-${c.level}">
            <div class="conflict-region">${c.region}</div>
            <div class="conflict-parties">${c.countries.join(' 🆚 ')}</div>
            <div class="conflict-level">Threat Level: ${c.level.toUpperCase()}</div>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  /**
   * Helper functions
   */
  getCountryFlag(country) {
    const flags = {
      'USA': '🇺🇸', 'UK': '🇬🇧', 'USSR': '🇷🇺', 
      'France': '🇫🇷', 'China': '🇨🇳', 'India': '🇮🇳', 
      'Argentina': '🇦🇷'
    };
    return flags[country] || '🏴';
  }
  
  getBranchIcon(branch) {
    return { army: '🪖', navy: '⚓', airForce: '✈️' }[branch] || '⚔️';
  }
  
  formatTroops(count) {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(0)}K`;
    return count.toString();
  }
  
  /**
   * Event handlers
   */
  selectBranch(branch) {
    this.selectedBranch = branch;
    this.updateUI();
  }
  
  selectRegion(region) {
    this.selectedRegion = region;
    this.updateUI();
  }
  
  submitDeployment() {
    const troops = parseInt(document.getElementById('deployTroops').value);
    const region = document.getElementById('deployRegion').value;
    
    if (!region) {
      alert('Please select a region');
      return;
    }
    
    if (troops < 10000) {
      alert('Minimum deployment: 10,000 troops');
      return;
    }
    
    if (troops > this.getAvailableForces(this.selectedBranch)) {
      alert('Insufficient forces available');
      return;
    }
    
    // Send to server
    socket.emit('deployTroops', {
      roomId: currentRoomId,
      playerId: playerId,
      deployment: {
        country: this.playerCountry,
        region: region,
        branch: this.selectedBranch,
        troops: troops
      }
    });
    
    // Reset form
    document.getElementById('deployTroops').value = 50000;
    document.getElementById('deployRegion').value = '';
    this.selectedRegion = null;
  }
  
  updateUI() {
    const container = document.getElementById('deployment-container');
    if (container) {
      container.innerHTML = this.render();
    }
  }
}

// Initialize when game reaches Phase 2
let deploymentUI = null;

function initializeDeploymentUI(gameState, playerCountry) {
  deploymentUI = new DeploymentUI(gameState, playerCountry);
  const container = document.getElementById('deployment-container');
  if (container) {
    container.innerHTML = deploymentUI.render();
  }
}

// Listen for conflict alerts
socket.on('conflictAlert', (data) => {
  showConflictNotification(data);
});

function showConflictNotification(data) {
  const notification = document.createElement('div');
  notification.className = `conflict-notification level-${data.level}`;
  notification.innerHTML = `
    <div class="notification-header">⚠️ Military Tension!</div>
    <div class="notification-body">${data.message}</div>
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 500);
  }, 5000);
}
