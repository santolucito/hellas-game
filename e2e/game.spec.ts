import { test, expect } from '@playwright/test';
import {
  setupGame,
  screenshot,
  screenshotCanvas,
  waitForRender,
  endTurn,
  selectUnit,
  trainUnit,
  getGameState,
  getPlayerUnits,
  getPlayerCities,
} from './helpers';

const TEST_SEED = 'testmap42';

test.describe('Hellas Game Visual Tests', () => {
  test('game initializes and renders with seeded map', async ({ page }) => {
    await setupGame(page, TEST_SEED);

    const state = await getGameState(page);
    expect(state.phase).toBe('player_turn');
    expect(state.turn).toBe(1);
    expect(state.drachma).toBeGreaterThanOrEqual(0);

    const units = await getPlayerUnits(page);
    expect(units.length).toBeGreaterThan(0);

    const cities = await getPlayerCities(page);
    expect(cities.length).toBeGreaterThan(0);

    await screenshotCanvas(page, 'init-canvas');
    await screenshot(page, 'init-full');
  });

  test('determinism: same seed produces same layout', async ({ page }) => {
    // First load
    await setupGame(page, TEST_SEED);
    const state1 = await getGameState(page);
    const units1 = await getPlayerUnits(page);
    const cities1 = await getPlayerCities(page);

    // Reload with same seed
    await setupGame(page, TEST_SEED);
    const state2 = await getGameState(page);
    const units2 = await getPlayerUnits(page);
    const cities2 = await getPlayerCities(page);

    expect(state1.turn).toBe(state2.turn);
    expect(state1.drachma).toBe(state2.drachma);
    expect(units1.length).toBe(units2.length);
    expect(cities1.length).toBe(cities2.length);

    // Verify unit positions match
    for (let i = 0; i < units1.length; i++) {
      expect(units1[i].coord).toEqual(units2[i].coord);
      expect(units1[i].type).toBe(units2[i].type);
    }
  });

  test('unit selection shows highlights', async ({ page }) => {
    await setupGame(page, TEST_SEED);

    const units = await getPlayerUnits(page);
    expect(units.length).toBeGreaterThan(0);

    const firstUnit = units[0];
    await selectUnit(page, firstUnit.id);
    await waitForRender(page);

    await screenshotCanvas(page, 'unit-selected');
  });

  test('end turn advances turn counter', async ({ page }) => {
    await setupGame(page, TEST_SEED);

    const beforeState = await getGameState(page);
    expect(beforeState.turn).toBe(1);

    await screenshotCanvas(page, 'before-end-turn');

    await endTurn(page);
    await waitForRender(page);

    const afterState = await getGameState(page);
    expect(afterState.turn).toBe(2);

    await screenshotCanvas(page, 'after-end-turn');
  });

  test('multi-turn flow with per-turn screenshots', async ({ page }) => {
    await setupGame(page, TEST_SEED);

    for (let i = 0; i < 5; i++) {
      const state = await getGameState(page);
      expect(state.turn).toBe(i + 1);

      await screenshotCanvas(page, `turn-${i + 1}`);

      await endTurn(page);
      await waitForRender(page);

      // Check game hasn't ended unexpectedly
      const postState = await getGameState(page);
      expect(['player_turn', 'victory', 'defeat']).toContain(postState.phase);
      if (postState.phase !== 'player_turn') break;
    }

    await screenshotCanvas(page, 'turn-6-after-5-ends');
  });

  test('train hoplite at capital', async ({ page }) => {
    await setupGame(page, TEST_SEED);

    const cities = await getPlayerCities(page);
    expect(cities.length).toBeGreaterThan(0);

    const capital = cities.find((c: any) => c.isCapital) || cities[0];
    const unitsBefore = await getPlayerUnits(page);

    await screenshotCanvas(page, 'before-train');

    await trainUnit(page, capital.id, 'hoplite');
    await waitForRender(page);

    const unitsAfter = await getPlayerUnits(page);
    const stateAfter = await getGameState(page);

    // Either we trained a unit (count went up) or we couldn't afford it
    if (stateAfter.drachma < (await getGameState(page)).drachma) {
      expect(unitsAfter.length).toBe(unitsBefore.length + 1);
    }

    await screenshotCanvas(page, 'after-train');
  });
});
