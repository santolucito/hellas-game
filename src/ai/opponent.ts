import { GameState, GameAction, Coord, coordEquals, coordDistance, neighbors, coordKey, TechId } from '../game/types';
import { getValidMoves, getValidAttacks, UNIT_COSTS, TECHS, getHarvestableTiles } from '../game/state';

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

  // AI researches techs if it has enough drachma and doesn't have all techs
  const techPriority: TechId[] = ['phalanx', 'philosophy', 'seafaring'];
  for (const techId of techPriority) {
    if (!aiPlayer.techs.includes(techId) && aiPlayer.drachma >= TECHS[techId].cost) {
      actions.push({ type: 'research', techId });
      break; // Only research one tech per turn
    }
  }

  // AI trains units if it has enough drachma
  for (const city of aiCities) {
    // Decide unit type: 70% hoplite, 30% peltast
    const unitType: 'hoplite' | 'peltast' = Math.random() < 0.7 ? 'hoplite' : 'peltast';
    const cost = UNIT_COSTS[unitType];

    if (aiPlayer.drachma >= cost) {
      const adjacentCoords = neighbors(city.coord);
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

    // If can't attack, try to move toward nearest enemy
    const validMoves = getValidMoves(state, unit);
    if (validMoves.length === 0) continue;

    // Find nearest target: neutral villages (high priority), player units, or player cities
    let nearestTarget: Coord | null = null;
    let nearestDist = Infinity;
    let targetPriority = 0; // Higher = more important

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
