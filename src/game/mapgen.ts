import { SeededRNG } from './rng';
import { Coord, Tile, Terrain, coordKey, coordDistance, neighbors } from './types';

export interface MapGenResult {
  tiles: Map<string, Tile>;
  playerStart: Coord;
  aiStart: Coord;
  villageLocations: Coord[]; // Neutral villages to capture
}

export function generateMap(seed: string, radius: number): MapGenResult {
  const rng = new SeededRNG(seed);
  const tiles = new Map<string, Tile>();

  // Generate rectangular map (size x size)
  const mapSize = radius * 2 + 1;
  const center = { q: Math.floor(mapSize / 2), r: Math.floor(mapSize / 2) };

  // Generate all tiles in rectangular grid
  for (let q = 0; q < mapSize; q++) {
    for (let r = 0; r < mapSize; r++) {
      const coord: Coord = { q, r };

      // Use distance from center to influence terrain
      const distFromCenter = coordDistance(coord, center);
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

      tiles.set(coordKey(coord), { coord, terrain, harvested: false });
    }
  }

  // Second pass: smooth terrain (cellular automata style)
  const newTerrains = new Map<string, Terrain>();
  for (const [key, tile] of tiles) {
    const adjacentTiles = neighbors(tile.coord)
      .map(n => tiles.get(coordKey(n)))
      .filter((t): t is Tile => t !== undefined);

    // Count terrain types in neighbors
    const counts: Record<Terrain, number> = { plains: 0, forest: 0, hills: 0, water: 0 };
    for (const n of adjacentTiles) {
      counts[n.terrain]++;
    }

    // If 3+ neighbors have same terrain, adopt it (creates clusters)
    // Using 3 instead of 4 since we only have 4 neighbors now
    let dominant: Terrain | null = null;
    for (const t of ['water', 'forest', 'hills', 'plains'] as Terrain[]) {
      if (counts[t] >= 3) {
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

  // Player starts on left side (low q), AI on right side (high q)
  const midQ = Math.floor(mapSize / 2);
  const playerCandidates = landTiles.filter(t =>
    t.coord.q < midQ / 2 && coordDistance(t.coord, center) > radius / 2
  );
  const aiCandidates = landTiles.filter(t =>
    t.coord.q > midQ + midQ / 2 && coordDistance(t.coord, center) > radius / 2
  );

  // Ensure we have starting positions, fallback to any land if needed
  const playerStart = playerCandidates.length > 0
    ? rng.pick(playerCandidates).coord
    : rng.pick(landTiles.filter(t => t.coord.q < midQ)).coord;

  const aiStart = aiCandidates.length > 0
    ? rng.pick(aiCandidates).coord
    : rng.pick(landTiles.filter(t => t.coord.q > midQ)).coord;

  // Ensure starting positions are plains (clear area for city)
  tiles.get(coordKey(playerStart))!.terrain = 'plains';
  tiles.get(coordKey(aiStart))!.terrain = 'plains';

  // Ensure starting positions have coastal access for triremes
  // Keep or create one water tile adjacent, convert others to plains
  for (const start of [playerStart, aiStart]) {
    const adjacentTiles = neighbors(start)
      .map(n => tiles.get(coordKey(n)))
      .filter((t): t is Tile => t !== undefined);

    const waterNeighbors = adjacentTiles.filter(t => t.terrain === 'water');
    const landNeighbors = adjacentTiles.filter(t => t.terrain !== 'water');

    if (waterNeighbors.length === 0) {
      // No water adjacent - convert one land tile to water for coastal access
      if (landNeighbors.length > 0) {
        const toWater = rng.pick(landNeighbors);
        toWater.terrain = 'water';
      }
    } else if (waterNeighbors.length > 1) {
      // Multiple water tiles - keep one, convert rest to plains for workable land
      // Keep the first one, convert the rest
      for (let i = 1; i < waterNeighbors.length; i++) {
        waterNeighbors[i].terrain = 'plains';
      }
    }
    // If exactly 1 water neighbor, it's already perfect - do nothing
  }

  // Generate neutral villages (4-6 depending on map size)
  const villageCount = Math.floor(radius * 0.7) + 2; // ~4-6 for radius 6
  const villageLocations: Coord[] = [];

  // Find valid village locations:
  // - On land (not water)
  // - Not too close to player or AI starts (min distance 3)
  // - Not too close to other villages (min distance 3)
  // - Not on map edge
  const validVillageSpots = landTiles.filter(t => {
    // Distance from edge (minimum of all edge distances)
    const distFromEdge = Math.min(t.coord.q, t.coord.r, mapSize - 1 - t.coord.q, mapSize - 1 - t.coord.r);
    const distFromPlayer = coordDistance(t.coord, playerStart);
    const distFromAI = coordDistance(t.coord, aiStart);
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
    const tooClose = villageLocations.some(v => coordDistance(v, candidate.coord) < 3);
    if (!tooClose) {
      villageLocations.push(candidate.coord);
      // Make village location plains for clarity
      tiles.get(coordKey(candidate.coord))!.terrain = 'plains';
    }
  }

  return { tiles, playerStart, aiStart, villageLocations };
}
