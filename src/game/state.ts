import {
  GameState, GameAction, Coord, Unit, City, Player, PlayerId, OwnerId,
  coordKey, coordEquals, neighbors, coordsInRadius, coordDistance,
  Tile, TechId
} from './types';
import { generateMap } from './mapgen';

let unitIdCounter = 0;
let cityIdCounter = 0;

export function createUnit(type: Unit['type'], owner: PlayerId, coord: Coord): Unit {
  const stats = {
    hoplite: { hp: 5, attack: 3, defense: 2, movement: 2 },
    peltast: { hp: 4, attack: 2, defense: 1, movement: 3 },
    trireme: { hp: 6, attack: 4, defense: 2, movement: 4 }
  }[type];

  return {
    id: `unit_${unitIdCounter++}`,
    type,
    owner,
    coord,
    hp: stats.hp,
    maxHp: stats.hp,
    attack: stats.attack,
    defense: stats.defense,
    movement: stats.movement,
    movesLeft: stats.movement,
    hasAttacked: false
  };
}

function createCity(name: string, owner: OwnerId, coord: Coord, isCapital: boolean = false): City {
  return {
    id: `city_${cityIdCounter++}`,
    name,
    owner,
    coord,
    level: 1,
    population: 0,
    territory: 1, // Start with radius 1 territory
    isCapital,
    bonuses: []
  };
}

// Create a neutral village (city with null owner)
function createVillage(coord: Coord): City {
  return createCity('Village', null, coord, false);
}

const GREEK_CITY_NAMES = [
  'Athens', 'Sparta', 'Thebes', 'Corinth', 'Argos',
  'Delphi', 'Olympia', 'Mycenae', 'Rhodes', 'Syracuse'
];

export function createInitialState(seed: string, mapRadius: number = 6): GameState {
  unitIdCounter = 0;
  cityIdCounter = 0;

  const { tiles, playerStart, aiStart, villageLocations } = generateMap(seed, mapRadius);

  const units = new Map<string, Unit>();
  const cities = new Map<string, City>();

  // Create player city (capital) and unit
  const playerCity = createCity(GREEK_CITY_NAMES[0], 0, playerStart, true);
  cities.set(playerCity.id, playerCity);

  // Place hoplite adjacent to city
  const playerUnitCoord = neighbors(playerStart).find(c => {
    const tile = tiles.get(coordKey(c));
    return tile && tile.terrain !== 'water';
  }) || playerStart;
  const playerUnit = createUnit('hoplite', 0, playerUnitCoord);
  units.set(playerUnit.id, playerUnit);

  // Create AI city (capital) and unit
  const aiCity = createCity(GREEK_CITY_NAMES[1], 1, aiStart, true);
  cities.set(aiCity.id, aiCity);

  // Create neutral villages
  for (const villageCoord of villageLocations) {
    const village = createVillage(villageCoord);
    cities.set(village.id, village);
  }

  const aiUnitCoord = neighbors(aiStart).find(c => {
    const tile = tiles.get(coordKey(c));
    return tile && tile.terrain !== 'water';
  }) || aiStart;
  const aiUnit = createUnit('hoplite', 1, aiUnitCoord);
  units.set(aiUnit.id, aiUnit);

  const players: [Player, Player] = [
    { id: 0, drachma: 5, techs: [] },
    { id: 1, drachma: 5, techs: [] }
  ];

  // Initial visibility from player's city and unit
  const discovered = new Set<string>();
  const visible = new Set<string>();

  return {
    seed,
    turn: 1,
    phase: 'player_turn',
    mapRadius,
    tiles,
    units,
    cities,
    players,
    selectedUnitId: null,
    selectedCityId: null,
    discovered,
    visible
  };
}

// Get all coords within a city's territory
export function getCityTerritory(state: GameState, city: City): Coord[] {
  return coordsInRadius(city.coord, city.territory).filter(c => state.tiles.has(coordKey(c)));
}

// Check if a coord is in any city's territory for a given owner
export function isInTerritory(state: GameState, coord: Coord, owner: OwnerId): boolean {
  for (const city of state.cities.values()) {
    if (city.owner === owner) {
      const dist = coordDistance(coord, city.coord);
      if (dist <= city.territory) {
        return true;
      }
    }
  }
  return false;
}

// Get the city that owns a specific coord (if any)
export function getCityOwningCoord(state: GameState, coord: Coord): City | null {
  for (const city of state.cities.values()) {
    if (city.owner !== null) {
      const dist = coordDistance(coord, city.coord);
      if (dist <= city.territory) {
        return city;
      }
    }
  }
  return null;
}

// Get all harvestable tiles in a player's territory
export function getHarvestableTiles(state: GameState, playerId: PlayerId): Coord[] {
  const harvestable: Coord[] = [];

  for (const city of state.cities.values()) {
    if (city.owner !== playerId) continue;

    const territoryCoords = coordsInRadius(city.coord, city.territory);
    for (const coord of territoryCoords) {
      const key = coordKey(coord);
      const tile = state.tiles.get(key);
      if (!tile || tile.harvested) continue;

      // Check if harvestable based on terrain
      if (tile.terrain === 'forest' || tile.terrain === 'hills') {
        harvestable.push(coord);
      } else if (tile.terrain === 'water') {
        // Water only if adjacent to a city
        const isAdjacentToCity = coordDistance(coord, city.coord) === 1;
        if (isAdjacentToCity) {
          harvestable.push(coord);
        }
      }
    }
  }

  return harvestable;
}

export function updateVisibility(state: GameState, playerId: PlayerId): void {
  state.visible.clear();

  // Add visibility from units
  for (const unit of state.units.values()) {
    if (unit.owner === playerId) {
      for (const coord of coordsInRadius(unit.coord, 2)) {
        const key = coordKey(coord);
        if (state.tiles.has(key)) {
          state.visible.add(key);
          state.discovered.add(key);
        }
      }
    }
  }

  // Add visibility from cities
  for (const city of state.cities.values()) {
    if (city.owner === playerId) {
      for (const coord of coordsInRadius(city.coord, 2)) {
        const key = coordKey(coord);
        if (state.tiles.has(key)) {
          state.visible.add(key);
          state.discovered.add(key);
        }
      }
    }
  }
}

export function getTerrainCost(terrain: Tile['terrain']): number {
  switch (terrain) {
    case 'plains': return 1;
    case 'forest': return 1;
    case 'hills': return 1;
    case 'water': return Infinity; // Impassable for land units
  }
}

export function getValidMoves(state: GameState, unit: Unit): Coord[] {
  if (unit.movesLeft <= 0) return [];

  const validMoves: Coord[] = [];
  const visited = new Map<string, number>();
  const queue: { coord: Coord; cost: number }[] = [{ coord: unit.coord, cost: 0 }];

  visited.set(coordKey(unit.coord), 0);

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const neighbor of neighbors(current.coord)) {
      const key = coordKey(neighbor);
      const tile = state.tiles.get(key);

      if (!tile) continue; // Out of map

      // Check terrain passability (land units can't cross water)
      if (unit.type !== 'trireme' && tile.terrain === 'water') continue;
      if (unit.type === 'trireme' && tile.terrain !== 'water') continue;

      // Triremes move on water with cost 1, land units use terrain cost
      const moveCost = unit.type === 'trireme' ? 1 : getTerrainCost(tile.terrain);
      const totalCost = current.cost + moveCost;

      if (totalCost > unit.movesLeft) continue;

      const existingCost = visited.get(key);
      if (existingCost !== undefined && existingCost <= totalCost) continue;

      // Check if coord is occupied by friendly unit
      const occupyingUnit = [...state.units.values()].find(u => coordEquals(u.coord, neighbor));
      if (occupyingUnit && occupyingUnit.owner === unit.owner) continue;

      visited.set(key, totalCost);

      // Can move here if no enemy unit (attack is separate)
      if (!occupyingUnit) {
        validMoves.push(neighbor);
        queue.push({ coord: neighbor, cost: totalCost });
      }
    }
  }

  return validMoves;
}

export function getValidAttacks(state: GameState, unit: Unit): Coord[] {
  if (unit.hasAttacked) return [];

  const attacks: Coord[] = [];
  const attackRange = unit.type === 'peltast' ? 2 : 1; // Peltast has 2-range

  // Check all coords within attack range
  const coordsToCheck = attackRange === 1
    ? neighbors(unit.coord)
    : coordsInRadius(unit.coord, attackRange).filter(c => !coordEquals(c, unit.coord));

  for (const targetCoord of coordsToCheck) {
    const dist = coordDistance(unit.coord, targetCoord);
    if (dist > attackRange || dist === 0) continue;

    const enemyUnit = [...state.units.values()].find(
      u => coordEquals(u.coord, targetCoord) && u.owner !== unit.owner
    );
    if (enemyUnit) {
      attacks.push(targetCoord);
    }

    // Melee units can capture cities, ranged cannot
    if (attackRange === 1) {
      const enemyCity = [...state.cities.values()].find(
        c => coordEquals(c.coord, targetCoord) && c.owner !== unit.owner
      );
      if (enemyCity) {
        attacks.push(targetCoord);
      }
    }
  }

  return attacks;
}

export function executeAction(state: GameState, action: GameAction): GameState {
  // Clone state for immutability
  const newState: GameState = {
    ...state,
    units: new Map(state.units),
    cities: new Map(state.cities),
    players: [{ ...state.players[0] }, { ...state.players[1] }],
    discovered: new Set(state.discovered),
    visible: new Set(state.visible)
  };

  switch (action.type) {
    case 'select':
      if (action.unitId) {
        const unit = newState.units.get(action.unitId);
        if (unit && unit.owner === 0) {
          newState.selectedUnitId = action.unitId;
        }
      } else {
        newState.selectedUnitId = null;
      }
      break;

    case 'move':
      if (action.unitId && action.targetCoord) {
        const unit = newState.units.get(action.unitId);
        if (unit) {
          const validMoves = getValidMoves(state, unit);
          if (validMoves.some(c => coordEquals(c, action.targetCoord!))) {
            const targetTile = state.tiles.get(coordKey(action.targetCoord));
            const cost = targetTile ? getTerrainCost(targetTile.terrain) : 1;

            const updatedUnit: Unit = {
              ...unit,
              coord: action.targetCoord,
              movesLeft: Math.max(0, unit.movesLeft - cost)
            };
            newState.units.set(unit.id, updatedUnit);

            // Check for city capture: if moving onto a neutral village or undefended enemy city, capture it
            const cityOnCoord = [...newState.cities.values()].find(
              c => coordEquals(c.coord, action.targetCoord!) && c.owner !== unit.owner
            );
            if (cityOnCoord) {
              // Check if there's a defending unit (can't capture defended cities by moving)
              const hasDefender = [...newState.units.values()].some(
                u => coordEquals(u.coord, action.targetCoord!) && u.owner === cityOnCoord.owner
              );

              if (!hasDefender) {
                // Capture city - assign to unit's owner
                // If it's a village, give it a proper name
                const isVillage = cityOnCoord.owner === null;
                const cityNameIndex = [...newState.cities.values()].filter(c => c.owner !== null).length;
                const newName = isVillage ? GREEK_CITY_NAMES[cityNameIndex % GREEK_CITY_NAMES.length] : cityOnCoord.name;

                const capturedCity: City = {
                  ...cityOnCoord,
                  owner: unit.owner,
                  name: newName,
                  level: isVillage ? 1 : cityOnCoord.level,
                  population: isVillage ? 0 : cityOnCoord.population,
                  territory: isVillage ? 1 : cityOnCoord.territory,
                  isCapital: false, // Captured cities are never capitals
                  bonuses: isVillage ? [] : cityOnCoord.bonuses
                };
                newState.cities.set(cityOnCoord.id, capturedCity);

                // Capturing a city ends the unit's turn
                updatedUnit.movesLeft = 0;
                updatedUnit.hasAttacked = true;
                newState.units.set(unit.id, updatedUnit);
              }
            }
          }
        }
      }
      break;

    case 'attack':
      if (action.unitId && action.targetCoord) {
        const attacker = newState.units.get(action.unitId);
        if (attacker) {
          const defender = [...newState.units.values()].find(
            u => coordEquals(u.coord, action.targetCoord!) && u.owner !== attacker.owner
          );

          if (defender) {
            // Combat calculation with tech bonuses
            let attackerDef = attacker.defense;
            let defenderDef = defender.defense;

            // Phalanx tech: +1 defense for hoplites
            if (attacker.type === 'hoplite' && newState.players[attacker.owner].techs.includes('phalanx')) {
              attackerDef += 1;
            }
            if (defender.type === 'hoplite' && newState.players[defender.owner].techs.includes('phalanx')) {
              defenderDef += 1;
            }

            const damage = Math.max(1, attacker.attack - defenderDef);

            // Ranged attacks (peltast at range 2) don't trigger counterattack
            const attackDist = coordDistance(attacker.coord, defender.coord);
            const isRangedAttack = attacker.type === 'peltast' && attackDist > 1;
            const counterDamage = isRangedAttack ? 0 : Math.max(0, Math.floor((defender.attack - attackerDef) / 2));

            const updatedDefender: Unit = {
              ...defender,
              hp: defender.hp - damage
            };

            const updatedAttacker: Unit = {
              ...attacker,
              hp: attacker.hp - counterDamage,
              hasAttacked: true,
              movesLeft: 0
            };

            // Remove dead units, update survivors
            if (updatedDefender.hp <= 0) {
              newState.units.delete(defender.id);
            } else {
              newState.units.set(defender.id, updatedDefender);
            }

            if (updatedAttacker.hp <= 0) {
              newState.units.delete(attacker.id);
              newState.selectedUnitId = null;
            } else {
              newState.units.set(attacker.id, updatedAttacker);
            }
          }

          // Check if attacking a city - only capture if no defenders remain
          const targetCity = [...newState.cities.values()].find(
            c => coordEquals(c.coord, action.targetCoord!) && c.owner !== attacker.owner
          );

          if (targetCity) {
            // Check if there's still a defending unit on the city
            const hasDefender = [...newState.units.values()].some(
              u => coordEquals(u.coord, action.targetCoord!) && u.owner !== attacker.owner
            );

            // Only capture if no defenders remain
            if (!hasDefender) {
              const updatedCity: City = {
                ...targetCity,
                owner: attacker.owner
              };
              newState.cities.set(targetCity.id, updatedCity);

              const updatedAttacker: Unit = {
                ...attacker,
                hasAttacked: true,
                movesLeft: 0
              };
              newState.units.set(attacker.id, updatedAttacker);
            }
          }
        }
      }
      break;

    case 'end_turn':
      if (state.phase === 'player_turn') {
        newState.phase = 'ai_turn';
      } else if (state.phase === 'ai_turn') {
        newState.turn++;
        newState.phase = 'player_turn';

        // Reset all units at start of new turn + heal units on friendly cities
        for (const [id, unit] of newState.units) {
          let newHp = unit.hp;

          // Heal units standing on friendly cities
          const friendlyCity = [...newState.cities.values()].find(
            c => c.owner === unit.owner && coordEquals(c.coord, unit.coord)
          );
          if (friendlyCity && unit.hp < unit.maxHp) {
            newHp = Math.min(unit.maxHp, unit.hp + 2); // Heal 2 HP per turn
          }

          newState.units.set(id, {
            ...unit,
            hp: newHp,
            movesLeft: unit.movement,
            hasAttacked: false
          });
        }

        // Income from cities (Polytopia-style: 1 drachma per city level)
        for (const city of newState.cities.values()) {
          // Skip neutral villages
          if (city.owner === null) continue;

          // Base income: 1 per city level
          let income = city.level;

          // Capital bonus: +1
          if (city.isCapital) {
            income += 1;
          }

          // Workshop bonus: +1 per workshop
          if (city.bonuses.includes('workshop')) {
            income += 1;
          }

          // Philosophy tech: +1 drachma per city
          if (newState.players[city.owner].techs.includes('philosophy')) {
            income += 1;
          }

          newState.players[city.owner].drachma += income;
        }
      }
      newState.selectedUnitId = null;
      break;

    case 'research':
      if (action.techId) {
        // Determine which player is researching based on game phase
        const researcherId = state.phase === 'player_turn' ? 0 : 1;
        const researcher = newState.players[researcherId];
        const techCost = TECHS[action.techId].cost;
        if (researcher.drachma >= techCost && !researcher.techs.includes(action.techId)) {
          researcher.drachma -= techCost;
          researcher.techs.push(action.techId);
        }
      }
      break;

    case 'select_city':
      if (action.cityId) {
        const city = newState.cities.get(action.cityId);
        if (city && city.owner === 0) {
          newState.selectedCityId = action.cityId;
          newState.selectedUnitId = null;
        }
      } else {
        newState.selectedCityId = null;
      }
      break;

    case 'train':
      if (action.cityId && action.unitType) {
        const city = newState.cities.get(action.cityId);
        if (!city) break;

        // Can't train in villages
        if (city.owner === null) break;

        // Check phase matches owner (player trains on player_turn, AI on ai_turn)
        const isPlayerCity = city.owner === 0;
        if (isPlayerCity && state.phase !== 'player_turn') break;
        if (!isPlayerCity && state.phase !== 'ai_turn') break;

        const player = newState.players[city.owner];
        const unitCost = UNIT_COSTS[action.unitType];

        if (player.drachma < unitCost) break;

        // Find empty adjacent coord for the new unit
        const adjacentCoords = neighbors(city.coord);
        const spawnCoord = adjacentCoords.find(c => {
          const tile = state.tiles.get(coordKey(c));
          if (!tile) return false;
          // Land units can't spawn on water
          if (action.unitType !== 'trireme' && tile.terrain === 'water') return false;
          // Triremes need water
          if (action.unitType === 'trireme' && tile.terrain !== 'water') return false;
          // Check no unit already there
          const occupied = [...state.units.values()].some(u => coordEquals(u.coord, c));
          return !occupied;
        });

        if (!spawnCoord) break; // No valid spawn location

        player.drachma -= unitCost;
        const cityOwner = city.owner as PlayerId; // We've verified it's not null above
        const newUnit = createUnit(action.unitType, cityOwner, spawnCoord);
        // New units can't move on the turn they're created
        newUnit.movesLeft = 0;
        newUnit.hasAttacked = true;
        newState.units.set(newUnit.id, newUnit);
        if (isPlayerCity) {
          newState.selectedCityId = null;
        }
      }
      break;

    case 'harvest':
      // Harvest a resource from a tile in your territory
      if (action.targetCoord) {
        const playerId = state.phase === 'player_turn' ? 0 : 1;
        const targetKey = coordKey(action.targetCoord);
        const tile = newState.tiles.get(targetKey);

        if (!tile || tile.harvested) break;

        // Find which city owns this coord
        const owningCity = getCityOwningCoord(newState, action.targetCoord);
        if (!owningCity || owningCity.owner !== playerId) break;

        // Calculate population gain based on terrain
        let popGain = 0;
        switch (tile.terrain) {
          case 'forest': popGain = 1; break; // Hunt
          case 'hills': popGain = 2; break;  // Mine
          case 'water': popGain = 1; break;  // Fish (must be adjacent to city)
          case 'plains': popGain = 0; break; // Plains need farms (future feature)
        }

        // Water tiles must be adjacent to a city to fish
        if (tile.terrain === 'water') {
          const isAdjacentToCity = coordDistance(action.targetCoord, owningCity.coord) === 1;
          if (!isAdjacentToCity) break;
        }

        if (popGain > 0) {
          // Mark tile as harvested
          const updatedTile = { ...tile, harvested: true };
          newState.tiles.set(targetKey, updatedTile);

          // Add population to the owning city
          const updatedCity = {
            ...owningCity,
            population: owningCity.population + popGain
          };

          // Check for level up
          const popNeeded = owningCity.level + 1;
          if (updatedCity.population >= popNeeded) {
            updatedCity.level++;
            updatedCity.population -= popNeeded;
            // Expand territory on level up
            if (updatedCity.level === 2) {
              updatedCity.territory = 2; // Expand to radius 2 at level 2
            }
            // TODO: Trigger bonus choice UI
          }

          newState.cities.set(owningCity.id, updatedCity);
        }
      }
      break;

    case 'choose_bonus':
      // Choose a bonus when leveling up a city
      if (action.cityId && action.bonus) {
        const city = newState.cities.get(action.cityId);
        if (!city || city.owner === null) break;

        // Verify the player owns this city
        const playerId = state.phase === 'player_turn' ? 0 : 1;
        if (city.owner !== playerId) break;

        // Add the bonus if not already present
        if (!city.bonuses.includes(action.bonus)) {
          const updatedCity = {
            ...city,
            bonuses: [...city.bonuses, action.bonus]
          };

          // Apply bonus effects
          if (action.bonus === 'border_growth') {
            updatedCity.territory = Math.min(3, updatedCity.territory + 1);
          }

          newState.cities.set(city.id, updatedCity);
        }
      }
      break;
  }

  // Check win/lose conditions
  const playerCities = [...newState.cities.values()].filter(c => c.owner === 0);
  const aiCities = [...newState.cities.values()].filter(c => c.owner === 1);
  const playerUnits = [...newState.units.values()].filter(u => u.owner === 0);
  const aiUnits = [...newState.units.values()].filter(u => u.owner === 1);

  if (aiCities.length === 0 || (aiUnits.length === 0 && aiCities.length === 0)) {
    newState.phase = 'victory';
  } else if (playerCities.length === 0 || (playerUnits.length === 0 && playerCities.length === 0)) {
    newState.phase = 'defeat';
  }

  // Update visibility
  updateVisibility(newState, 0);

  return newState;
}

export const TECHS: Record<TechId, { name: string; cost: number; description: string }> = {
  phalanx: { name: 'Phalanx', cost: 10, description: '+1 Defense for Hoplites' },
  seafaring: { name: 'Seafaring', cost: 10, description: 'Unlock Triremes' },
  philosophy: { name: 'Philosophy', cost: 10, description: '+1 Drachma per city' }
};

export const UNIT_COSTS: Record<Unit['type'], number> = {
  hoplite: 5,
  peltast: 4,
  trireme: 8
};
