// Hex axial coordinates
export interface Hex {
  q: number;
  r: number;
}

export type Terrain = 'plains' | 'forest' | 'hills' | 'water';

export interface Tile {
  hex: Hex;
  terrain: Terrain;
  harvested: boolean; // Whether resources have been harvested from this tile
}

export type PlayerId = 0 | 1; // 0 = human, 1 = AI
export type OwnerId = PlayerId | null; // null = neutral (village)

export interface Unit {
  id: string;
  type: 'hoplite' | 'peltast' | 'trireme';
  owner: PlayerId;
  hex: Hex;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  movement: number;
  movesLeft: number;
  hasAttacked: boolean;
}

export interface City {
  id: string;
  name: string;
  owner: OwnerId; // null = neutral village
  hex: Hex;
  level: number;
  population: number; // Current population progress toward next level
  territory: number; // Territory radius (1 = adjacent tiles, 2 = expanded)
  isCapital: boolean; // Capital cities get bonus income
  bonuses: CityBonus[]; // Bonuses from level-ups
}

export type CityBonus = 'workshop' | 'walls' | 'border_growth';

export interface Village {
  id: string;
  hex: Hex;
  // Villages are essentially cities with owner: null
}

export type TechId = 'phalanx' | 'seafaring' | 'philosophy';

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
  // Fog of war: set of hex keys that player has discovered
  discovered: Set<string>;
  // Currently visible hexes (units in vision range)
  visible: Set<string>;
}

export interface GameAction {
  type: 'select' | 'move' | 'attack' | 'end_turn' | 'research' | 'train' | 'select_city' | 'harvest' | 'choose_bonus';
  unitId?: string;
  cityId?: string;
  targetHex?: Hex;
  techId?: TechId;
  unitType?: Unit['type'];
  bonus?: CityBonus; // For choose_bonus action
}

// Hex utility
export function hexKey(hex: Hex): string {
  return `${hex.q},${hex.r}`;
}

export function parseHexKey(key: string): Hex {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

// Cube coordinates for distance calculation
export function hexToCube(hex: Hex): { x: number; y: number; z: number } {
  return { x: hex.q, y: -hex.q - hex.r, z: hex.r };
}

export function hexDistance(a: Hex, b: Hex): number {
  const ac = hexToCube(a);
  const bc = hexToCube(b);
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
}

// Get all 6 neighbors of a hex
export function hexNeighbors(hex: Hex): Hex[] {
  const directions = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
  ];
  return directions.map(d => ({ q: hex.q + d.q, r: hex.r + d.r }));
}

// Get all hexes within radius
export function hexesInRadius(center: Hex, radius: number): Hex[] {
  const results: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      results.push({ q: center.q + q, r: center.r + r });
    }
  }
  return results;
}
