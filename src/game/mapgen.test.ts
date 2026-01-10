import { describe, it, expect } from 'vitest';
import { generateMap } from './mapgen';
import { hexKey } from './types';

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
      expect(tile1.hex.q).toBe(tile2!.hex.q);
      expect(tile1.hex.r).toBe(tile2!.hex.r);
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

  it('generates expected number of hexes for radius', () => {
    const radius = 6;
    const map = generateMap('count-test', radius);

    // Hexagonal map has 3*r^2 + 3*r + 1 hexes
    const expectedHexes = 3 * radius * radius + 3 * radius + 1;
    expect(map.tiles.size).toBe(expectedHexes);
  });

  it('places starting positions on opposite sides', () => {
    const map = generateMap('position-test', 6);

    // Player should be on negative q side
    expect(map.playerStart.q).toBeLessThan(0);

    // AI should be on positive q side
    expect(map.aiStart.q).toBeGreaterThan(0);
  });

  it('ensures starting positions are on land', () => {
    const map = generateMap('land-start-test', 6);

    const playerTile = map.tiles.get(hexKey(map.playerStart));
    const aiTile = map.tiles.get(hexKey(map.aiStart));

    expect(playerTile).toBeDefined();
    expect(aiTile).toBeDefined();
    expect(playerTile!.terrain).not.toBe('water');
    expect(aiTile!.terrain).not.toBe('water');
  });
});
