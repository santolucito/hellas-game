import { SeededRNG } from './rng';
import { Coord, Tile, Terrain, coordKey, coordDistance, coordEquals, neighbors } from './types';

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

  // Find valid starting positions on opposite sides with enough surrounding land
  const landTiles = [...tiles.values()].filter(t => t.terrain !== 'water');

  // Count land tiles within radius 2 of a coord (measures how "mainland" a spot is)
  const landScore = (coord: Coord): number => {
    let count = 0;
    for (let dq = -2; dq <= 2; dq++) {
      for (let dr = -2; dr <= 2; dr++) {
        const key = coordKey({ q: coord.q + dq, r: coord.r + dr });
        const t = tiles.get(key);
        if (t && t.terrain !== 'water') count++;
      }
    }
    return count;
  };

  // Player on left half, AI on right half — no "far from center" constraint
  const midQ = Math.floor(mapSize / 2);
  const minLandScore = 12; // At least ~half of 25 tiles in radius-2 should be land

  const playerCandidates = landTiles
    .filter(t => t.coord.q < midQ && landScore(t.coord) >= minLandScore);
  const aiCandidates = landTiles
    .filter(t => t.coord.q > midQ && landScore(t.coord) >= minLandScore);

  // Pick the candidate with the best land score (most mainland-like)
  const pickBest = (candidates: Tile[], fallback: Tile[]): Coord => {
    const pool = candidates.length > 0 ? candidates : fallback;
    // Sort by land score descending, then pick randomly from the top half
    const scored = pool.map(t => ({ tile: t, score: landScore(t.coord) }));
    scored.sort((a, b) => b.score - a.score);
    const topHalf = scored.slice(0, Math.max(1, Math.ceil(scored.length / 2)));
    return rng.pick(topHalf).tile.coord;
  };

  const playerStart = pickBest(
    playerCandidates,
    landTiles.filter(t => t.coord.q < midQ)
  );
  const aiStart = pickBest(
    aiCandidates,
    landTiles.filter(t => t.coord.q > midQ)
  );

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

  // Ensure water connectivity between player and AI starting positions
  // Find water tiles adjacent to each start
  const playerWater = neighbors(playerStart)
    .map(n => tiles.get(coordKey(n)))
    .find(t => t && t.terrain === 'water');
  const aiWater = neighbors(aiStart)
    .map(n => tiles.get(coordKey(n)))
    .find(t => t && t.terrain === 'water');

  if (playerWater && aiWater) {
    // Check if there's a water path between them using BFS
    const visited = new Set<string>();
    const queue: Coord[] = [playerWater.coord];
    visited.add(coordKey(playerWater.coord));
    let connected = false;

    while (queue.length > 0 && !connected) {
      const current = queue.shift()!;

      if (coordKey(current) === coordKey(aiWater.coord)) {
        connected = true;
        break;
      }

      for (const neighbor of neighbors(current)) {
        const key = coordKey(neighbor);
        if (visited.has(key)) continue;

        const tile = tiles.get(key);
        if (tile && tile.terrain === 'water') {
          visited.add(key);
          queue.push(neighbor);
        }
      }
    }

    // If not connected, carve a water channel between them
    if (!connected) {
      // Simple approach: create water tiles along a path from playerWater to aiWater
      let current = { ...playerWater.coord };
      const target = aiWater.coord;

      while (current.q !== target.q || current.r !== target.r) {
        // Move toward target
        if (current.q < target.q) current.q++;
        else if (current.q > target.q) current.q--;

        if (current.r < target.r) current.r++;
        else if (current.r > target.r) current.r--;

        const tile = tiles.get(coordKey(current));
        if (tile && tile.terrain !== 'water') {
          // Don't overwrite starting positions
          if (!coordEquals(current, playerStart) && !coordEquals(current, aiStart)) {
            tile.terrain = 'water';
          }
        }
      }
    }
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
