// Square grid coordinates (isometric)
export interface Coord {
  q: number;  // x coordinate
  r: number;  // y coordinate
}

export type Terrain = 'plains' | 'forest' | 'hills' | 'water';

export interface Tile {
  coord: Coord;
  terrain: Terrain;
  harvested: boolean; // Whether resources have been harvested from this tile
}

export type PlayerId = 0 | 1; // 0 = human, 1 = AI
export type OwnerId = PlayerId | null; // null = neutral (village)

export interface Unit {
  id: string;
  type: 'hoplite' | 'peltast' | 'trireme';
  owner: PlayerId;
  coord: Coord;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  movement: number;
  movesLeft: number;
  hasAttacked: boolean;
  passengerIds?: string[];  // IDs of carried units (triremes only, max 3)
}

export interface City {
  id: string;
  name: string;
  owner: OwnerId; // null = neutral village
  coord: Coord;
  level: number;
  population: number; // Current population progress toward next level
  territory: number; // Territory radius (1 = adjacent tiles, 2 = expanded)
  isCapital: boolean; // Capital cities get bonus income
  bonuses: CityBonus[]; // Bonuses from level-ups
}

export type CityBonus = 'workshop' | 'walls' | 'border_growth';

export interface Village {
  id: string;
  coord: Coord;
  // Villages are essentially cities with owner: null
}

export type TechId = 'phalanx' | 'philosophy';

export interface Tech {
  id: TechId;
  name: string;
  cost: number;
  unlocks: string;
}

export interface Player {
  id: PlayerId;
  drachma: number;
  techs: TechId[];
}

export type GamePhase = 'player_turn' | 'ai_turn' | 'victory' | 'defeat';

export interface GameState {
  seed: string;
  turn: number;
  phase: GamePhase;
  mapRadius: number;
  tiles: Map<string, Tile>;
  units: Map<string, Unit>;
  cities: Map<string, City>;
  players: [Player, Player];
  selectedUnitId: string | null;
  selectedCityId: string | null;
  // Fog of war: set of coord keys that player has discovered
  discovered: Set<string>;
  // Currently visible coords (units in vision range)
  visible: Set<string>;
}

export interface GameAction {
  type: 'select' | 'move' | 'attack' | 'end_turn' | 'research' | 'train' | 'select_city' | 'harvest' | 'choose_bonus' | 'embark' | 'disembark';
  unitId?: string;
  cityId?: string;
  targetCoord?: Coord;
  techId?: TechId;
  unitType?: Unit['type'];
  bonus?: CityBonus; // For choose_bonus action
  triremeId?: string; // For embark action
}

// Grid utility - using q as x, r as y for square grid
export function coordKey(coord: Coord): string {
  return `${coord.q},${coord.r}`;
}

export function parseCoordKey(key: string): Coord {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export function coordEquals(a: Coord, b: Coord): boolean {
  return a.q === b.q && a.r === b.r;
}

// Chebyshev distance for square grid (king's move distance)
export function coordDistance(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
}

// Get all 8 neighbors (including diagonals)
export function neighbors(coord: Coord): Coord[] {
  const directions = [
    { q: 0, r: -1 },   // North
    { q: 1, r: -1 },   // Northeast
    { q: 1, r: 0 },    // East
    { q: 1, r: 1 },    // Southeast
    { q: 0, r: 1 },    // South
    { q: -1, r: 1 },   // Southwest
    { q: -1, r: 0 },   // West
    { q: -1, r: -1 }   // Northwest
  ];
  return directions.map(d => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

// Get all tiles within radius (square area using Chebyshev distance)
export function coordsInRadius(center: Coord, radius: number): Coord[] {
  const results: Coord[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = -radius; dr <= radius; dr++) {
      results.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return results;
}
