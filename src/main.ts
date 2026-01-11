import { GameState, coordEquals, coordKey } from './game/types';
import { createInitialState, executeAction, updateVisibility, getValidMoves, getValidAttacks, getHarvestableTiles, TECHS, UNIT_COSTS, CITY_NAME_INFO, UNIT_NAME_INFO } from './game/state';
import { Renderer } from './ui/renderer';
import { runAI } from './ai/opponent';

// Get seed from URL or generate random
function getSeed(): string {
  const hash = window.location.hash;
  if (hash.startsWith('#seed=')) {
    return hash.slice(6);
  }
  return Math.random().toString(36).slice(2, 10);
}

class Game {
  private state: GameState;
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;
  private lastFrameTime = 0;
  private frameCount = 0;
  private fps = 0;
  private debugVisible = false;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new Renderer(this.canvas);

    const seed = getSeed();
    window.location.hash = `seed=${seed}`;
    this.state = createInitialState(seed, 6);
    updateVisibility(this.state, 0);

    this.setupEventListeners();
    this.updateHUD();
    this.updateDebug();
    this.gameLoop();
  }

  private setupEventListeners(): void {
    // Touch/click on canvas
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      // Skip if touch was a drag/pan gesture
      if (this.renderer.wasTouchDrag()) {
        this.renderer.resetTouchState();
        return;
      }
      const touch = e.changedTouches[0];
      const rect = this.canvas.getBoundingClientRect();
      this.handleTap(touch.clientX - rect.left, touch.clientY - rect.top);
    });

    // Mouse move for tooltip
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => this.hideTooltip());

    // End turn button
    document.getElementById('btn-end-turn')?.addEventListener('click', () => this.endTurn());

    // Tech button
    document.getElementById('btn-tech')?.addEventListener('click', () => this.showTechModal());

    // Menu button
    document.getElementById('btn-menu')?.addEventListener('click', () => this.showMenuModal());

    // Restart button
    document.getElementById('btn-restart')?.addEventListener('click', () => {
      window.location.hash = '';
      window.location.reload();
    });

    // Resize handler
    window.addEventListener('resize', () => {
      this.renderer.resize();
    });

    // Debug toggle (press D)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        this.debugVisible = !this.debugVisible;
        document.getElementById('debug')?.classList.toggle('visible', this.debugVisible);
      }
    });
  }

  private handleClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.handleTap(e.clientX - rect.left, e.clientY - rect.top);
  }

  private handleTap(x: number, y: number): void {
    if (this.state.phase !== 'player_turn') return;

    const coord = this.renderer.getCoordAtPixel(x, y, this.state.tiles);

    // Check if tapping on own unit
    const tappedUnit = [...this.state.units.values()].find(
      u => coordEquals(u.coord, coord) && u.owner === 0
    );

    // Check if tapping on own city
    const tappedCity = [...this.state.cities.values()].find(
      c => coordEquals(c.coord, coord) && c.owner === 0
    );

    if (tappedUnit) {
      // Select/deselect unit
      if (this.state.selectedUnitId === tappedUnit.id) {
        this.state = executeAction(this.state, { type: 'select', unitId: undefined });
      } else {
        this.state = executeAction(this.state, { type: 'select', unitId: tappedUnit.id });
      }
    } else if (tappedCity) {
      // Tapped on own city - show training menu
      if (this.state.selectedCityId === tappedCity.id) {
        this.state = executeAction(this.state, { type: 'select_city', cityId: undefined });
      } else {
        this.state = executeAction(this.state, { type: 'select_city', cityId: tappedCity.id });
        this.showTrainModal(tappedCity.id);
      }
    } else if (this.state.selectedUnitId) {
      const selectedUnit = this.state.units.get(this.state.selectedUnitId);
      if (!selectedUnit) return;

      // Check if valid move
      const validMoves = getValidMoves(this.state, selectedUnit);
      if (validMoves.some(c => coordEquals(c, coord))) {
        this.state = executeAction(this.state, {
          type: 'move',
          unitId: selectedUnit.id,
          targetCoord: coord
        });
      }

      // Check if valid attack - refetch unit to get current position after any move
      const currentUnit = this.state.units.get(selectedUnit.id);
      if (!currentUnit) return;
      const validAttacks = getValidAttacks(this.state, currentUnit);
      if (validAttacks.some(c => coordEquals(c, coord))) {
        // Trigger attack animation
        this.renderer.triggerAttackAnimation(currentUnit.coord, coord);
        const attackerId = selectedUnit.id;
        const targetCoord = coord;

        // Delay the actual attack until animation completes
        setTimeout(() => {
          this.state = executeAction(this.state, {
            type: 'attack',
            unitId: attackerId,
            targetCoord: targetCoord
          });
          this.updateHUD();
          this.checkGameEnd();
        }, 350);
        return; // Don't call updateHUD/checkGameEnd immediately
      }
    } else {
      // Check if clicking on a harvestable tile in player territory
      const harvestableCoords = getHarvestableTiles(this.state, 0);
      const isHarvestable = harvestableCoords.some(c => coordEquals(c, coord));

      if (isHarvestable) {
        // Track city levels before harvest to detect level-ups
        const cityLevelsBefore = new Map<string, number>();
        for (const [id, city] of this.state.cities) {
          if (city.owner === 0) {
            cityLevelsBefore.set(id, city.level);
          }
        }

        this.state = executeAction(this.state, { type: 'harvest', targetCoord: coord });

        // Check for level-ups
        for (const [id, city] of this.state.cities) {
          if (city.owner === 0) {
            const prevLevel = cityLevelsBefore.get(id) || 1;
            if (city.level > prevLevel) {
              // City leveled up! Show bonus choice modal
              this.showLevelUpModal(id, city.name, city.level);
            }
          }
        }
      } else {
        // Deselect
        this.state = executeAction(this.state, { type: 'select' });
      }
    }

    this.updateHUD();
    this.checkGameEnd();
  }

  private endTurn(): void {
    if (this.state.phase !== 'player_turn') return;

    this.state = executeAction(this.state, { type: 'end_turn' });
    this.updateHUD();

    // Run AI turn
    if (this.state.phase === 'ai_turn') {
      setTimeout(() => this.runAITurn(), 500);
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const coord = this.renderer.getCoordAtPixel(x, y, this.state.tiles);
    const key = coordKey(coord);

    const tile = this.state.tiles.get(key);
    if (!tile || !this.state.discovered.has(key)) {
      this.hideTooltip();
      return;
    }

    const tooltip = document.getElementById('tooltip')!;
    let content = `<strong>${tile.terrain.charAt(0).toUpperCase() + tile.terrain.slice(1)}</strong>`;
    content += `<br>Position: (${coord.q}, ${coord.r})`;

    // Check for city/village
    const city = [...this.state.cities.values()].find(c => coordEquals(c.coord, coord));
    if (city && this.state.visible.has(key)) {
      const isVillage = city.owner === null;
      content += `<br><br><strong>${isVillage ? 'Village' : city.name}</strong>`;
      if (!isVillage && CITY_NAME_INFO[city.name]) {
        const info = CITY_NAME_INFO[city.name];
        content += `<br><small style="color:#a0a0a0;">${info.roman} — ${info.english}</small>`;
      }
      if (isVillage) {
        content += `<br><em>Move a unit here to capture</em>`;
      } else {
        content += `<br>Owner: ${city.owner === 0 ? 'You' : 'Enemy'}`;
        content += `<br>Level: ${city.level}`;
        content += `<br>Population: ${city.population}/${city.level + 1}`;
        content += `<br>Territory: ${city.territory}`;
        if (city.isCapital) content += `<br><em>(Capital)</em>`;
      }
    }

    // Check for unit (only if visible)
    const unit = [...this.state.units.values()].find(u => coordEquals(u.coord, coord));
    if (unit && (unit.owner === 0 || this.state.visible.has(key))) {
      const unitInfo = UNIT_NAME_INFO[unit.type];
      content += `<br><br><strong>${unitInfo.greek}</strong>`;
      content += `<br><small style="color:#a0a0a0;">${unitInfo.roman} — ${unitInfo.english}</small>`;
      content += `<br>HP: ${unit.hp}/${unit.maxHp}`;
      content += `<br>Moves: ${unit.movesLeft}/${unit.movement}`;
      content += `<br>Owner: ${unit.owner === 0 ? 'You' : 'Enemy'}`;
    }

    tooltip.innerHTML = content;
    tooltip.style.display = 'block';
    tooltip.style.left = `${e.clientX + 15}px`;
    tooltip.style.top = `${e.clientY + 15}px`;
  }

  private hideTooltip(): void {
    document.getElementById('tooltip')!.style.display = 'none';
  }

  private runAITurn(): void {
    const actions = runAI(this.state);

    let delay = 0;
    for (const action of actions) {
      const isAttack = action.type === 'attack';
      const attackDelay = isAttack ? 350 : 0;

      setTimeout(() => {
        // For attacks, trigger animation first
        if (isAttack && 'unitId' in action && 'targetCoord' in action) {
          const unitId = action.unitId;
          const targetCoord = action.targetCoord;
          if (unitId !== undefined && targetCoord !== undefined) {
            const attacker = this.state.units.get(unitId);
            if (attacker) {
              this.renderer.triggerAttackAnimation(attacker.coord, targetCoord);
            }
          }
        }

        // Delay attack execution for animation, execute others immediately
        setTimeout(() => {
          this.state = executeAction(this.state, action);
          this.updateHUD();
          this.checkGameEnd();
        }, attackDelay);
      }, delay);

      delay += 300 + attackDelay;
    }
  }

  private showTechModal(): void {
    const player = this.state.players[0];

    let html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f0e6d2;padding:20px;">';
    html += '<h2 style="margin-bottom:20px;color:#c9a227;">Technology</h2>';
    html += '<p style="margin-bottom:20px;">Your Δρχ: ' + player.drachma + '</p>';

    for (const [id, tech] of Object.entries(TECHS)) {
      const owned = player.techs.includes(id as any);
      const canAfford = player.drachma >= tech.cost;

      html += `<div style="margin:8px;padding:12px 20px;background:${owned ? '#2ecc71' : canAfford ? 'rgba(201,162,39,0.3)' : 'rgba(128,128,128,0.3)'};border:2px solid ${owned ? '#27ae60' : '#c9a227'};border-radius:8px;cursor:${owned ? 'default' : 'pointer'};" ${owned ? '' : `onclick="window.gameInstance.research('${id}')"`}>`;
      html += `<strong>${tech.name}</strong> (${tech.cost} Δρχ)<br>`;
      html += `<small>${tech.description}</small>`;
      if (owned) html += '<br><small style="color:#fff;">(Researched)</small>';
      html += '</div>';
    }

    html += '<button class="btn" style="margin-top:20px;" onclick="this.parentElement.remove()">Close</button>';
    html += '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  research(techId: string): void {
    this.state = executeAction(this.state, { type: 'research', techId: techId as any });
    this.updateHUD();
    document.querySelector('[style*="z-index:200"]')?.remove();
    this.showTechModal();
  }

  private showMenuModal(): void {
    let html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f0e6d2;padding:20px;">';
    html += '<h2 style="margin-bottom:30px;color:#c9a227;">Menu</h2>';

    html += `<button class="btn" style="margin:8px;padding:12px 30px;min-width:200px;" onclick="window.gameInstance.restartGame()">Restart Game</button>`;
    html += `<button class="btn" style="margin:8px;padding:12px 30px;min-width:200px;" onclick="window.gameInstance.newGame()">New Game</button>`;

    html += '<button class="btn" style="margin-top:30px;padding:12px 30px;" onclick="this.parentElement.remove()">Close</button>';
    html += '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  restartGame(): void {
    window.location.reload();
  }

  newGame(): void {
    window.location.hash = '';
    window.location.reload();
  }

  private showTrainModal(cityId: string): void {
    const city = this.state.cities.get(cityId);
    if (!city) return;

    const player = this.state.players[0];

    let html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f0e6d2;padding:20px;">';
    html += `<h2 style="margin-bottom:5px;color:#c9a227;">${city.name}</h2>`;
    if (CITY_NAME_INFO[city.name]) {
      const info = CITY_NAME_INFO[city.name];
      html += `<p style="margin-bottom:20px;color:#a0a0a0;font-size:14px;">${info.roman} — ${info.english}</p>`;
    }
    html += '<p style="margin-bottom:20px;">Your Δρχ: ' + player.drachma + '</p>';
    html += '<h3 style="margin-bottom:15px;">Train Units</h3>';

    const units: Array<{ type: 'hoplite' | 'peltast' | 'trireme'; icon: string; desc: string }> = [
      { type: 'hoplite', icon: '⚔', desc: 'HP 5, ATK 3, DEF 2, MOV 2' },
      { type: 'peltast', icon: '🏹', desc: 'HP 4, ATK 2, DEF 1, MOV 3' },
    ];

    // Add Trireme if player has Seafaring tech
    if (player.techs.includes('seafaring')) {
      units.push({ type: 'trireme', icon: '⛵', desc: 'HP 6, ATK 4, DEF 2, MOV 4 (water only)' });
    }

    for (const unit of units) {
      const cost = UNIT_COSTS[unit.type];
      const canAfford = player.drachma >= cost;
      const unitInfo = UNIT_NAME_INFO[unit.type];

      html += `<div style="margin:8px;padding:12px 20px;background:${canAfford ? 'rgba(201,162,39,0.3)' : 'rgba(128,128,128,0.3)'};border:2px solid #c9a227;border-radius:8px;cursor:${canAfford ? 'pointer' : 'not-allowed'};" ${canAfford ? `onclick="window.gameInstance.trainUnit('${cityId}', '${unit.type}')"` : ''}>`;
      html += `<span style="font-size:24px;">${unit.icon}</span> <strong>${unitInfo.greek}</strong> (${cost} Δρχ)<br>`;
      html += `<small style="color:#a0a0a0;">${unitInfo.roman} — ${unitInfo.english}</small><br>`;
      html += `<small>${unit.desc}</small>`;
      html += '</div>';
    }

    html += '<button class="btn" style="margin-top:20px;" onclick="this.parentElement.remove(); window.gameInstance.deselectCity()">Close</button>';
    html += '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  trainUnit(cityId: string, unitType: 'hoplite' | 'peltast' | 'trireme'): void {
    this.state = executeAction(this.state, { type: 'train', cityId, unitType });
    this.updateHUD();
    document.querySelector('[style*="z-index:200"]')?.remove();
  }

  deselectCity(): void {
    this.state = executeAction(this.state, { type: 'select_city', cityId: undefined });
  }

  // Show level-up bonus choice modal
  showLevelUpModal(cityId: string, cityName: string, newLevel: number): void {
    const bonusOptions = this.getBonusOptionsForLevel(newLevel);
    const playerΔρχ = this.state.players[0].drachma;
    const upgradeCost = 1;
    const canAfford = playerΔρχ >= upgradeCost;

    let html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f0e6d2;padding:20px;">';
    html += `<h2 style="margin-bottom:5px;color:#c9a227;">🎉 ${cityName} Level Up!</h2>`;
    if (CITY_NAME_INFO[cityName]) {
      const info = CITY_NAME_INFO[cityName];
      html += `<p style="margin-bottom:10px;color:#a0a0a0;font-size:14px;">${info.roman} — ${info.english}</p>`;
    }
    html += `<p style="margin-bottom:10px;color:#9b59b6;">Now Level ${newLevel}</p>`;
    html += `<p style="margin-bottom:20px;color:${canAfford ? '#c9a227' : '#f25c54'};">Upgrade Cost: ${upgradeCost} Δρχ (You have: ${playerΔρχ})</p>`;
    html += '<h3 style="margin-bottom:15px;">Choose a bonus:</h3>';

    for (const option of bonusOptions) {
      if (canAfford) {
        html += `<div style="margin:8px;padding:15px 25px;background:rgba(155,89,182,0.3);border:2px solid #9b59b6;border-radius:8px;cursor:pointer;min-width:250px;text-align:center;" onclick="window.gameInstance.confirmLevelUpBonus('${cityId}', '${option.id}', '${option.name}')">`;
      } else {
        html += `<div style="margin:8px;padding:15px 25px;background:rgba(128,128,128,0.3);border:2px solid #666;border-radius:8px;min-width:250px;text-align:center;opacity:0.5;">`;
      }
      html += `<span style="font-size:28px;">${option.icon}</span><br>`;
      html += `<strong>${option.name}</strong><br>`;
      html += `<small>${option.desc}</small>`;
      html += '</div>';
    }

    if (!canAfford) {
      html += '<p style="margin-top:20px;color:#f25c54;">Not enough Δρχ!</p>';
      html += '<button style="margin-top:10px;padding:10px 20px;background:rgba(201,162,39,0.3);border:2px solid #c9a227;color:#f0e6d2;border-radius:8px;cursor:pointer;" onclick="document.querySelector(\'[style*=\\\'z-index:200\\\']\')?.remove()">Close</button>';
    }

    html += '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }

  private getBonusOptionsForLevel(level: number): Array<{ id: string; name: string; icon: string; desc: string }> {
    // Greek-themed bonus options based on level
    switch (level) {
      case 2:
        return [
          { id: 'workshop', name: 'Agora', icon: '🏪', desc: '+1 Δρχ per turn' },
          { id: 'explorer', name: 'Scout', icon: '🔭', desc: 'Reveal nearby fog' }
        ];
      case 3:
        return [
          { id: 'stars', name: 'Treasury', icon: '💰', desc: '+5 Δρχ instantly' },
          { id: 'walls', name: 'Walls', icon: '🏰', desc: 'City defense bonus' }
        ];
      case 4:
        return [
          { id: 'population', name: 'Settlers', icon: '👥', desc: '+3 Population' },
          { id: 'border_growth', name: 'Colony', icon: '🗺', desc: 'Expand territory' }
        ];
      default: // Level 5+
        return [
          { id: 'park', name: 'Olympia', icon: '🏟', desc: '+250 Score' },
          { id: 'giant', name: 'Strategos', icon: '⚔️', desc: 'Spawn Giant Hoplite' }
        ];
    }
  }

  confirmLevelUpBonus(cityId: string, bonusId: string, bonusName: string): void {
    // Remove the level-up modal first
    document.querySelector('[style*="z-index:200"]')?.remove();

    // Show confirmation popup
    let html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f0e6d2;padding:20px;">';
    html += '<h2 style="margin-bottom:20px;color:#c9a227;">Confirm Upgrade</h2>';
    html += `<p style="margin-bottom:20px;">Build <strong>${bonusName}</strong> for <strong>1 Δρχ</strong>?</p>`;
    html += '<div style="display:flex;gap:15px;">';
    html += `<button style="padding:12px 30px;background:rgba(126,200,80,0.3);border:2px solid #7ec850;color:#f0e6d2;border-radius:8px;cursor:pointer;font-size:16px;" onclick="window.gameInstance.chooseLevelUpBonus('${cityId}', '${bonusId}')">Confirm</button>`;
    html += '<button style="padding:12px 30px;background:rgba(242,92,84,0.3);border:2px solid #f25c54;color:#f0e6d2;border-radius:8px;cursor:pointer;font-size:16px;" onclick="document.querySelector(\'[style*=\\\'z-index:200\\\']\')?.remove()">Cancel</button>';
    html += '</div>';
    html += '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }

  chooseLevelUpBonus(cityId: string, bonusId: string): void {
    const city = this.state.cities.get(cityId);
    if (!city) return;

    // Deduct upgrade cost
    const upgradeCost = 1;
    if (this.state.players[0].drachma < upgradeCost) return;
    this.state.players[0].drachma -= upgradeCost;

    // Apply bonus effects
    switch (bonusId) {
      case 'workshop':
        this.state = executeAction(this.state, { type: 'choose_bonus', cityId, bonus: 'workshop' });
        break;
      case 'explorer':
        // Reveal fog in radius 3 around city
        this.revealFogAroundCity(city.coord, 4);
        break;
      case 'stars':
        this.state.players[0].drachma += 5;
        break;
      case 'walls':
        this.state = executeAction(this.state, { type: 'choose_bonus', cityId, bonus: 'walls' });
        break;
      case 'population':
        // Add 3 population to city
        const updatedCity = { ...city, population: city.population + 3 };
        this.state.cities.set(cityId, updatedCity);
        break;
      case 'border_growth':
        this.state = executeAction(this.state, { type: 'choose_bonus', cityId, bonus: 'border_growth' });
        break;
      case 'giant':
        // Spawn a powerful hoplite
        this.spawnGiantUnit(city);
        break;
    }

    document.querySelector('[style*="z-index:200"]')?.remove();
    this.updateHUD();
  }

  private revealFogAroundCity(coord: { q: number; r: number }, radius: number): void {
    // Reveal fog in radius around city (square grid using Chebyshev distance)
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const key = `${coord.q + dq},${coord.r + dr}`;
        if (this.state.tiles.has(key)) {
          this.state.discovered.add(key);
        }
      }
    }
  }

  private spawnGiantUnit(city: { coord: { q: number; r: number }; owner: 0 | 1 | null }): void {
    if (city.owner === null) return;
    // Find adjacent coord for giant (4 cardinal directions)
    const directions = [
      { q: 0, r: -1 },  // North
      { q: 1, r: 0 },   // East
      { q: 0, r: 1 },   // South
      { q: -1, r: 0 }   // West
    ];
    for (const d of directions) {
      const spawnCoord = { q: city.coord.q + d.q, r: city.coord.r + d.r };
      const key = `${spawnCoord.q},${spawnCoord.r}`;
      const tile = this.state.tiles.get(key);
      if (tile && tile.terrain !== 'water') {
        const occupied = [...this.state.units.values()].some(u => u.coord.q === spawnCoord.q && u.coord.r === spawnCoord.r);
        if (!occupied) {
          // Create giant hoplite (stronger stats)
          const giant = {
            id: `unit_giant_${Date.now()}`,
            type: 'hoplite' as const,
            owner: city.owner,
            coord: spawnCoord,
            hp: 20,
            maxHp: 20,
            attack: 5,
            defense: 4,
            movement: 2,
            movesLeft: 0,
            hasAttacked: true
          };
          this.state.units.set(giant.id, giant);
          break;
        }
      }
    }
  }

  private updateHUD(): void {
    const player = this.state.players[0];
    document.getElementById('drachma')!.textContent = player.drachma.toString();
    document.getElementById('turn-num')!.textContent = this.state.turn.toString();

    // Calculate income per turn
    let income = 0;
    for (const city of this.state.cities.values()) {
      if (city.owner !== 0) continue;
      income += city.level;
      if (city.isCapital) income += 1;
      if (city.bonuses.includes('workshop')) income += 1;
      if (player.techs.includes('philosophy')) income += 1;
    }
    document.getElementById('income')!.textContent = `(+${income})`;

    // Unit count
    const playerUnits = [...this.state.units.values()].filter(u => u.owner === 0);
    document.getElementById('unit-count')!.textContent = playerUnits.length.toString();

    const endTurnBtn = document.getElementById('btn-end-turn') as HTMLButtonElement;
    endTurnBtn.disabled = this.state.phase !== 'player_turn';

    this.updateUnitPanel();
  }

  private updateUnitPanel(): void {
    const panel = document.getElementById('unit-panel')!;
    const selectedUnit = this.state.selectedUnitId ? this.state.units.get(this.state.selectedUnitId) : null;

    if (!selectedUnit || selectedUnit.owner !== 0) {
      panel.classList.remove('visible');
      return;
    }

    panel.classList.add('visible');

    // Unit type icons
    const unitIcons: Record<string, string> = {
      hoplite: '🛡️',
      peltast: '🏹',
      trireme: '⛵'
    };

    const icon = unitIcons[selectedUnit.type] || '⚔';
    const nameInfo = UNIT_NAME_INFO[selectedUnit.type];
    document.getElementById('unit-icon')!.textContent = icon;
    document.getElementById('unit-name')!.textContent = nameInfo.greek;
    document.getElementById('unit-name-sub')!.textContent = `${nameInfo.roman} — ${nameInfo.english}`;

    // Stats
    document.getElementById('unit-hp')!.textContent = `${selectedUnit.hp}/${selectedUnit.maxHp}`;
    document.getElementById('unit-attack')!.textContent = selectedUnit.attack.toString();
    document.getElementById('unit-defense')!.textContent = selectedUnit.defense.toString();
    document.getElementById('unit-movement')!.textContent = `${selectedUnit.movesLeft}/${selectedUnit.movement}`;

    // HP bar
    const hpPercent = (selectedUnit.hp / selectedUnit.maxHp) * 100;
    const hpBar = document.getElementById('unit-hp-bar')!;
    hpBar.style.width = `${hpPercent}%`;
    hpBar.style.background = hpPercent > 50 ? '#7ec850' : hpPercent > 25 ? '#f9c846' : '#f25c54';

    // Status text
    const statusEl = document.getElementById('unit-status')!;
    const canMove = selectedUnit.movesLeft > 0;
    const canAttack = !selectedUnit.hasAttacked;

    if (canMove && canAttack) {
      statusEl.innerHTML = '<span class="can-act">Ready to move & attack</span>';
    } else if (canMove) {
      statusEl.innerHTML = '<span class="can-act">Can move</span> · <span class="cannot-act">Attacked</span>';
    } else if (canAttack) {
      statusEl.innerHTML = '<span class="cannot-act">No moves</span> · <span class="can-act">Can attack</span>';
    } else {
      statusEl.innerHTML = '<span class="cannot-act">Exhausted</span>';
    }
  }

  private updateDebug(): void {
    document.getElementById('debug-seed')!.textContent = this.state.seed;
    document.getElementById('debug-turn')!.textContent = `${this.state.turn} (${this.state.phase})`;

    const selectedUnit = this.state.selectedUnitId ? this.state.units.get(this.state.selectedUnitId) : null;
    if (selectedUnit) {
      document.getElementById('debug-tile')!.textContent = `Unit at ${selectedUnit.coord.q},${selectedUnit.coord.r}`;
    } else {
      document.getElementById('debug-tile')!.textContent = '-';
    }
  }

  private checkGameEnd(): void {
    if (this.state.phase === 'victory' || this.state.phase === 'defeat') {
      const isVictory = this.state.phase === 'victory';

      document.getElementById('victory-title')!.textContent = isVictory ? 'Victory!' : 'Defeat';
      document.getElementById('victory-message')!.textContent = isVictory
        ? 'You have conquered the enemy!'
        : 'Your civilization has fallen.';

      // Generate stats
      const playerUnits = [...this.state.units.values()].filter(u => u.owner === 0);
      const playerCities = [...this.state.cities.values()].filter(c => c.owner === 0);
      const player = this.state.players[0];

      const statsHtml = `
        <div><strong>Turns:</strong> ${this.state.turn}</div>
        <div><strong>Final Δρχ:</strong> ${player.drachma}</div>
        <div><strong>Units Remaining:</strong> ${playerUnits.length}</div>
        <div><strong>Cities Controlled:</strong> ${playerCities.length}</div>
        <div><strong>Techs Researched:</strong> ${player.techs.length}</div>
        <div><strong>Map Seed:</strong> ${this.state.seed}</div>
      `;
      document.getElementById('victory-stats')!.innerHTML = statsHtml;

      document.getElementById('victory-screen')!.classList.add('visible');
    }
  }

  private gameLoop = (): void => {
    const now = performance.now();

    // FPS calculation
    this.frameCount++;
    if (now - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
      document.getElementById('debug-fps')!.textContent = this.fps.toString();
    }

    this.renderer.render(this.state);
    this.updateDebug();

    requestAnimationFrame(this.gameLoop);
  };
}

// Initialize game
const game = new Game();
(window as any).gameInstance = game;
