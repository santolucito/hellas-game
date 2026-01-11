import { GameState, GameAction, Coord, coordEquals, coordDistance, neighbors, coordKey, TechId } from '../game/types';
import { getValidMoves, getValidAttacks, UNIT_COSTS, TECHS, getHarvestableTiles, getValidEmbarkTargets, getValidDisembarkTargets } from '../game/state';

export function runAI(state: GameState): GameAction[] {
  const actions: GameAction[] = [];

  const aiPlayer = state.players[1];
  const aiCities = [...state.cities.values()].filter(c => c.owner === 1);
  const neutralVillages = [...state.cities.values()].filter(c => c.owner === null);

  // AI harvests resources in its territory
  const harvestableCoords = getHarvestableTiles(state, 1);
  if (harvestableCoords.length > 0) {
    // Harvest up to 2 resources per turn
    const toHarvest = harvestableCoords.slice(0, 2);
    for (const coord of toHarvest) {
      actions.push({ type: 'harvest', targetCoord: coord });
    }
  }

  // Check if AI needs naval capability (player is across water)
  const playerCities = [...state.cities.values()].filter(c => c.owner === 0);
  const aiHasTrireme = [...state.units.values()].some(u => u.owner === 1 && u.type === 'trireme');
  const needsNavy = playerCities.length > 0 && !aiHasTrireme;

  // AI researches techs if it has enough drachma and doesn't have all techs
  const techPriority: TechId[] = ['phalanx', 'philosophy'];
  for (const techId of techPriority) {
    if (!aiPlayer.techs.includes(techId) && aiPlayer.drachma >= TECHS[techId].cost) {
      actions.push({ type: 'research', techId });
      break; // Only research one tech per turn
    }
  }

  // AI trains units if it has enough drachma
  for (const city of aiCities) {
    const adjacentCoords = neighbors(city.coord);

    // Check if city is coastal (has adjacent water)
    const hasWater = adjacentCoords.some(c => {
      const tile = state.tiles.get(coordKey(c));
      return tile && tile.terrain === 'water';
    });

    // Build trireme if city is coastal and we need navy
    if (hasWater && needsNavy && aiPlayer.drachma >= UNIT_COSTS.trireme) {
      const waterSpawn = adjacentCoords.find(c => {
        const tile = state.tiles.get(coordKey(c));
        if (!tile || tile.terrain !== 'water') return false;
        const occupied = [...state.units.values()].some(u => coordEquals(u.coord, c));
        return !occupied;
      });

      if (waterSpawn) {
        actions.push({ type: 'train', cityId: city.id, unitType: 'trireme' });
        break;
      }
    }

    // Otherwise build land units: 70% hoplite, 30% peltast
    const unitType: 'hoplite' | 'peltast' = Math.random() < 0.7 ? 'hoplite' : 'peltast';
    const cost = UNIT_COSTS[unitType];

    if (aiPlayer.drachma >= cost) {
      const spawnCoord = adjacentCoords.find(c => {
        const tile = state.tiles.get(coordKey(c));
        if (!tile || tile.terrain === 'water') return false;
        const occupied = [...state.units.values()].some(u => coordEquals(u.coord, c));
        return !occupied;
      });

      if (spawnCoord) {
        actions.push({ type: 'train', cityId: city.id, unitType });
        // Only train one unit per turn to not drain all resources
        break;
      }
    }
  }

  const aiUnits = [...state.units.values()].filter(u => u.owner === 1);

  for (const unit of aiUnits) {
    // First, check if we can attack
    const attacks = getValidAttacks(state, unit);
    if (attacks.length > 0) {
      // Attack the weakest target
      let bestTarget: Coord | null = null;
      let lowestHp = Infinity;

      for (const attackCoord of attacks) {
        const target = [...state.units.values()].find(
          u => coordEquals(u.coord, attackCoord) && u.owner !== unit.owner
        );
        if (target && target.hp < lowestHp) {
          lowestHp = target.hp;
          bestTarget = attackCoord;
        }

        // Also consider cities
        const city = [...state.cities.values()].find(
          c => coordEquals(c.coord, attackCoord) && c.owner !== unit.owner
        );
        if (city) {
          bestTarget = attackCoord; // Prioritize cities
          break;
        }
      }

      if (bestTarget) {
        actions.push({ type: 'attack', unitId: unit.id, targetCoord: bestTarget });
        continue;
      }
    }

    // TRIREME LOGIC: If trireme has passengers and is adjacent to enemy land, disembark
    if (unit.type === 'trireme' && unit.passengerIds && unit.passengerIds.length > 0) {
      const disembarkTargets = getValidDisembarkTargets(state, unit);
      if (disembarkTargets.length > 0) {
        // Prefer disembarking near player cities or units
        let bestDisembark: Coord | null = null;
        let bestScore = -Infinity;

        for (const target of disembarkTargets) {
          let score = 0;
          // Check proximity to player cities
          for (const city of playerCities) {
            const dist = coordDistance(target, city.coord);
            if (dist <= 2) score += 10 - dist; // Closer to city = higher score
          }
          // Check proximity to player units
          for (const playerUnit of state.units.values()) {
            if (playerUnit.owner === 0) {
              const dist = coordDistance(target, playerUnit.coord);
              if (dist <= 2) score += 5 - dist;
            }
          }
          if (score > bestScore) {
            bestScore = score;
            bestDisembark = target;
          }
        }

        // Disembark if we're near something worth attacking, or just disembark anywhere
        if (bestDisembark || disembarkTargets.length > 0) {
          actions.push({
            type: 'disembark',
            unitId: unit.id,
            targetCoord: bestDisembark || disembarkTargets[0]
          });
          continue;
        }
      }
    }

    // LAND UNIT EMBARK LOGIC: If land unit can embark on a trireme, do so
    if (unit.type !== 'trireme' && unit.movesLeft > 0) {
      const embarkTargets = getValidEmbarkTargets(state, unit);
      if (embarkTargets.length > 0) {
        // Find the trireme at this location
        const triremeCoord = embarkTargets[0];
        const trireme = [...state.units.values()].find(
          u => u.type === 'trireme' && u.owner === 1 && coordEquals(u.coord, triremeCoord)
        );
        if (trireme) {
          actions.push({
            type: 'embark',
            unitId: unit.id,
            triremeId: trireme.id
          });
          continue;
        }
      }
    }

    // If can't attack, try to move toward nearest enemy
    const validMoves = getValidMoves(state, unit);
    if (validMoves.length === 0) continue;

    // Find nearest target
    let nearestTarget: Coord | null = null;
    let nearestDist = Infinity;
    let targetPriority = 0; // Higher = more important

    // TRIREME WITH PASSENGERS: Focus entirely on reaching player territory
    if (unit.type === 'trireme' && unit.passengerIds && unit.passengerIds.length > 0) {
      // Move toward nearest player city
      for (const city of playerCities) {
        const dist = coordDistance(unit.coord, city.coord);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestTarget = city.coord;
        }
      }
    } else if (unit.type === 'trireme') {
      // Empty trireme: move toward AI land units that might want to embark
      const aiLandUnits = aiUnits.filter(u => u.type !== 'trireme');
      for (const landUnit of aiLandUnits) {
        const dist = coordDistance(unit.coord, landUnit.coord);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestTarget = landUnit.coord;
        }
      }
    } else {
      // Land units: normal targeting priorities

      // Priority 3: Neutral villages (capture them!)
      for (const village of neutralVillages) {
        const dist = coordDistance(unit.coord, village.coord);
        if (dist < nearestDist || targetPriority < 3) {
          if (targetPriority < 3 || dist < nearestDist) {
            nearestDist = dist;
            nearestTarget = village.coord;
            targetPriority = 3;
          }
        }
      }

      // Priority 2: Player cities (only if no villages nearby)
      for (const city of state.cities.values()) {
        if (city.owner === 0) {
          const dist = coordDistance(unit.coord, city.coord);
          if (targetPriority < 2 || (targetPriority === 2 && dist < nearestDist)) {
            nearestDist = dist;
            nearestTarget = city.coord;
            targetPriority = 2;
          }
        }
      }

      // Priority 1: Player units
      for (const playerUnit of state.units.values()) {
        if (playerUnit.owner === 0) {
          const dist = coordDistance(unit.coord, playerUnit.coord);
          if (targetPriority < 1 || (targetPriority === 1 && dist < nearestDist)) {
            nearestDist = dist;
            nearestTarget = playerUnit.coord;
            targetPriority = 1;
          }
        }
      }
    }

    if (nearestTarget) {
      // Move toward target
      let bestMove: Coord | null = null;
      let bestDist = coordDistance(unit.coord, nearestTarget);

      for (const move of validMoves) {
        const dist = coordDistance(move, nearestTarget);
        if (dist < bestDist) {
          bestDist = dist;
          bestMove = move;
        }
      }

      if (bestMove) {
        actions.push({ type: 'move', unitId: unit.id, targetCoord: bestMove });
      }
    } else {
      // No visible target, move randomly (explore)
      const randomMove = validMoves[Math.floor(Math.random() * validMoves.length)];
      actions.push({ type: 'move', unitId: unit.id, targetCoord: randomMove });
    }
  }

  actions.push({ type: 'end_turn' });
  return actions;
}
