import { SeededRNG } from './rng';
import { Hex, Tile, Terrain, hexKey, hexesInRadius, hexDistance, hexNeighbors } from './types';

export interface MapGenResult {
  tiles: Map<string, Tile>;
  playerStart: Hex;
  aiStart: Hex;
  villageLocations: Hex[]; // Neutral villages to capture
}

export function generateMap(seed: string, radius: number): MapGenResult {
  const rng = new SeededRNG(seed);
  const tiles = new Map<string, Tile>();

  // Generate all hexes in radius
  const allHexes = hexesInRadius({ q: 0, r: 0 }, radius);

  // First pass: assign random terrain with noise-like distribution
  for (const hex of allHexes) {
    // Use distance from center to influence terrain
    const distFromCenter = hexDistance(hex, { q: 0, r: 0 });
    const normalizedDist = distFromCenter / radius;

    let terrain: Terrain;
    const roll = rng.next();

    // More water near edges, more land in center
    if (roll < 0.15 + normalizedDist * 0.3) {
      terrain = 'water';
    } else if (roll < 0.4) {
      terrain = 'forest';
    } else if (roll < 0.55) {
      terrain = 'hills';
    } else {
      terrain = 'plains';
    }

    tiles.set(hexKey(hex), { hex, terrain, harvested: false });
  }

  // Second pass: smooth terrain (cellular automata style)
  const newTerrains = new Map<string, Terrain>();
  for (const [key, tile] of tiles) {
    const neighbors = hexNeighbors(tile.hex)
      .map(n => tiles.get(hexKey(n)))
      .filter((t): t is Tile => t !== undefined);

    // Count terrain types in neighbors
    const counts: Record<Terrain, number> = { plains: 0, forest: 0, hills: 0, water: 0 };
    for (const n of neighbors) {
      counts[n.terrain]++;
    }

    // If 4+ neighbors have same terrain, adopt it (creates clusters)
    let dominant: Terrain | null = null;
    for (const t of ['water', 'forest', 'hills', 'plains'] as Terrain[]) {
      if (counts[t] >= 4) {
        dominant = t;
        break;
      }
    }

    newTerrains.set(key, dominant || tile.terrain);
  }

  // Apply smoothed terrain
  for (const [key, terrain] of newTerrains) {
    const tile = tiles.get(key)!;
    tile.terrain = terrain;
  }

  // Find valid starting positions (land tiles, not too close to center, opposite sides)
  const landTiles = [...tiles.values()].filter(t => t.terrain !== 'water');

  // Player starts on one side (negative q), AI on opposite (positive q)
  const playerCandidates = landTiles.filter(t =>
    t.hex.q < -radius / 3 && hexDistance(t.hex, { q: 0, r: 0 }) > radius / 2
  );
  const aiCandidates = landTiles.filter(t =>
    t.hex.q > radius / 3 && hexDistance(t.hex, { q: 0, r: 0 }) > radius / 2
  );

  // Ensure we have starting positions, fallback to any land if needed
  const playerStart = playerCandidates.length > 0
    ? rng.pick(playerCandidates).hex
    : rng.pick(landTiles.filter(t => t.hex.q < 0)).hex;

  const aiStart = aiCandidates.length > 0
    ? rng.pick(aiCandidates).hex
    : rng.pick(landTiles.filter(t => t.hex.q > 0 && !hexDistance(t.hex, playerStart))).hex;

  // Ensure starting positions are plains (clear area for city)
  tiles.get(hexKey(playerStart))!.terrain = 'plains';
  tiles.get(hexKey(aiStart))!.terrain = 'plains';

  // Also clear immediate neighbors to plains for easier early game
  for (const start of [playerStart, aiStart]) {
    for (const neighbor of hexNeighbors(start)) {
      const tile = tiles.get(hexKey(neighbor));
      if (tile && tile.terrain === 'water') {
        tile.terrain = 'plains';
      }
    }
  }

  // Generate neutral villages (4-6 depending on map size)
  const villageCount = Math.floor(radius * 0.7) + 2; // ~4-6 for radius 6
  const villageLocations: Hex[] = [];

  // Find valid village locations:
  // - On land (not water)
  // - Not too close to player or AI starts (min distance 3)
  // - Not too close to other villages (min distance 3)
  // - Not on map edge
  const validVillageSpots = landTiles.filter(t => {
    const distFromEdge = radius - hexDistance(t.hex, { q: 0, r: 0 });
    const distFromPlayer = hexDistance(t.hex, playerStart);
    const distFromAI = hexDistance(t.hex, aiStart);
    return distFromEdge >= 2 && distFromPlayer >= 3 && distFromAI >= 3;
  });

  // Shuffle and pick villages ensuring minimum spacing
  const shuffled = [...validVillageSpots];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  for (const candidate of shuffled) {
    if (villageLocations.length >= villageCount) break;

    // Check distance from existing villages
    const tooClose = villageLocations.some(v => hexDistance(v, candidate.hex) < 3);
    if (!tooClose) {
      villageLocations.push(candidate.hex);
      // Make village location plains for clarity
      tiles.get(hexKey(candidate.hex))!.terrain = 'plains';
    }
  }

  return { tiles, playerStart, aiStart, villageLocations };
}
