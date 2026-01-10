import { describe, it, expect } from 'vitest';
import { SeededRNG } from './rng';

describe('SeededRNG', () => {
  it('produces deterministic results for same seed', () => {
    const rng1 = new SeededRNG('test-seed');
    const rng2 = new SeededRNG('test-seed');

    const results1 = Array.from({ length: 10 }, () => rng1.next());
    const results2 = Array.from({ length: 10 }, () => rng2.next());

    expect(results1).toEqual(results2);
  });

  it('produces different results for different seeds', () => {
    const rng1 = new SeededRNG('seed-a');
    const rng2 = new SeededRNG('seed-b');

    const results1 = Array.from({ length: 10 }, () => rng1.next());
    const results2 = Array.from({ length: 10 }, () => rng2.next());

    expect(results1).not.toEqual(results2);
  });

  it('generates values between 0 and 1', () => {
    const rng = new SeededRNG('bounds-test');

    for (let i = 0; i < 100; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int() generates values within range', () => {
    const rng = new SeededRNG('int-test');

    for (let i = 0; i < 100; i++) {
      const value = rng.int(5, 10);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(10);
    }
  });

  it('pick() selects from array deterministically', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const rng1 = new SeededRNG('pick-test');
    const rng2 = new SeededRNG('pick-test');

    const picks1 = Array.from({ length: 10 }, () => rng1.pick(arr));
    const picks2 = Array.from({ length: 10 }, () => rng2.pick(arr));

    expect(picks1).toEqual(picks2);
  });

  it('shuffle() is deterministic', () => {
    const rng1 = new SeededRNG('shuffle-test');
    const rng2 = new SeededRNG('shuffle-test');

    const arr1 = [1, 2, 3, 4, 5];
    const arr2 = [1, 2, 3, 4, 5];

    rng1.shuffle(arr1);
    rng2.shuffle(arr2);

    expect(arr1).toEqual(arr2);
  });
});
