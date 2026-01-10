import { GameState, GameAction, Hex, hexEquals, hexDistance, hexNeighbors, hexKey, TechId } from '../game/types';
import { getValidMoves, getValidAttacks, UNIT_COSTS, TECHS, getHarvestableTiles } from '../game/state';

export function runAI(state: GameState): GameAction[] {
  const actions: GameAction[] = [];

  const aiPlayer = state.players[1];
  const aiCities = [...state.cities.values()].filter(c => c.owner === 1);
  const neutralVillages = [...state.cities.values()].filter(c => c.owner === null);

  // AI harvests resources in its territory
  const harvestableHexes = getHarvestableTiles(state, 1);
  if (harvestableHexes.length > 0) {
    // Harvest up to 2 resources per turn
    const toHarvest = harvestableHexes.slice(0, 2);
    for (const hex of toHarvest) {
      actions.push({ type: 'harvest', targetHex: hex });
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
      const adjacentHexes = hexNeighbors(city.hex);
      const spawnHex = adjacentHexes.find(h => {
        const tile = state.tiles.get(hexKey(h));
        if (!tile || tile.terrain === 'water') return false;
        const occupied = [...state.units.values()].some(u => hexEquals(u.hex, h));
        return !occupied;
      });

      if (spawnHex) {
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
      let bestTarget: Hex | null = null;
      let lowestHp = Infinity;

      for (const attackHex of attacks) {
        const target = [...state.units.values()].find(
          u => hexEquals(u.hex, attackHex) && u.owner !== unit.owner
        );
        if (target && target.hp < lowestHp) {
          lowestHp = target.hp;
          bestTarget = attackHex;
        }

        // Also consider cities
        const city = [...state.cities.values()].find(
          c => hexEquals(c.hex, attackHex) && c.owner !== unit.owner
        );
        if (city) {
          bestTarget = attackHex; // Prioritize cities
          break;
        }
      }

      if (bestTarget) {
        actions.push({ type: 'attack', unitId: unit.id, targetHex: bestTarget });
        continue;
      }
    }

    // If can't attack, try to move toward nearest enemy
    const validMoves = getValidMoves(state, unit);
    if (validMoves.length === 0) continue;

    // Find nearest target: neutral villages (high priority), player units, or player cities
    let nearestTarget: Hex | null = null;
    let nearestDist = Infinity;
    let targetPriority = 0; // Higher = more important

    // Priority 3: Neutral villages (capture them!)
    for (const village of neutralVillages) {
      const dist = hexDistance(unit.hex, village.hex);
      if (dist < nearestDist || targetPriority < 3) {
        if (targetPriority < 3 || dist < nearestDist) {
          nearestDist = dist;
          nearestTarget = village.hex;
          targetPriority = 3;
        }
      }
    }

    // Priority 2: Player cities (only if no villages nearby)
    for (const city of state.cities.values()) {
      if (city.owner === 0) {
        const dist = hexDistance(unit.hex, city.hex);
        if (targetPriority < 2 || (targetPriority === 2 && dist < nearestDist)) {
          nearestDist = dist;
          nearestTarget = city.hex;
          targetPriority = 2;
        }
      }
    }

    // Priority 1: Player units
    for (const playerUnit of state.units.values()) {
      if (playerUnit.owner === 0) {
        const dist = hexDistance(unit.hex, playerUnit.hex);
        if (targetPriority < 1 || (targetPriority === 1 && dist < nearestDist)) {
          nearestDist = dist;
          nearestTarget = playerUnit.hex;
          targetPriority = 1;
        }
      }
    }

    if (nearestTarget) {
      // Move toward target
      let bestMove: Hex | null = null;
      let bestDist = hexDistance(unit.hex, nearestTarget);

      for (const move of validMoves) {
        const dist = hexDistance(move, nearestTarget);
        if (dist < bestDist) {
          bestDist = dist;
          bestMove = move;
        }
      }

      if (bestMove) {
        actions.push({ type: 'move', unitId: unit.id, targetHex: bestMove });
      }
    } else {
      // No visible target, move randomly (explore)
      const randomMove = validMoves[Math.floor(Math.random() * validMoves.length)];
      actions.push({ type: 'move', unitId: unit.id, targetHex: randomMove });
    }
  }

  actions.push({ type: 'end_turn' });
  return actions;
}
