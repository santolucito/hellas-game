import { describe, it, expect } from 'vitest';
import { generateMap } from './mapgen';
import { coordKey } from './types';

describe('Map Generation', () => {
  it('produces identical maps for same seed', () => {
    const seed = 'reproducible-seed';
    const radius = 6;

    const result1 = generateMap(seed, radius);
    const result2 = generateMap(seed, radius);

    // Check same number of tiles
    expect(result1.tiles.size).toBe(result2.tiles.size);

    // Check all tiles match
    for (const [key, tile1] of result1.tiles) {
      const tile2 = result2.tiles.get(key);
      expect(tile2).toBeDefined();
      expect(tile1.terrain).toBe(tile2!.terrain);
      expect(tile1.coord.q).toBe(tile2!.coord.q);
      expect(tile1.coord.r).toBe(tile2!.coord.r);
    }

    // Check starting positions match
    expect(result1.playerStart).toEqual(result2.playerStart);
    expect(result1.aiStart).toEqual(result2.aiStart);
  });

  it('produces different maps for different seeds', () => {
    const map1 = generateMap('seed-alpha', 6);
    const map2 = generateMap('seed-beta', 6);

    // At least some tiles should have different terrain
    let differences = 0;
    for (const [key, tile1] of map1.tiles) {
      const tile2 = map2.tiles.get(key);
      if (tile2 && tile1.terrain !== tile2.terrain) {
        differences++;
      }
    }

    expect(differences).toBeGreaterThan(0);
  });

  it('generates expected number of tiles for radius', () => {
    const radius = 6;
    const map = generateMap('count-test', radius);

    // Square grid map has (radius*2+1)^2 tiles
    const mapSize = radius * 2 + 1;
    const expectedTiles = mapSize * mapSize;
    expect(map.tiles.size).toBe(expectedTiles);
  });

  it('places starting positions on opposite sides', () => {
    const radius = 6;
    const map = generateMap('position-test', radius);
    const midQ = Math.floor((radius * 2 + 1) / 2);

    // Player should be on left side (low q)
    expect(map.playerStart.q).toBeLessThan(midQ);

    // AI should be on right side (high q)
    expect(map.aiStart.q).toBeGreaterThan(midQ);
  });

  it('ensures starting positions are on land', () => {
    const map = generateMap('land-start-test', 6);

    const playerTile = map.tiles.get(coordKey(map.playerStart));
    const aiTile = map.tiles.get(coordKey(map.aiStart));

    expect(playerTile).toBeDefined();
    expect(aiTile).toBeDefined();
    expect(playerTile!.terrain).not.toBe('water');
    expect(aiTile!.terrain).not.toBe('water');
  });
});
