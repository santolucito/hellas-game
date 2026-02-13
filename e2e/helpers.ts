import { Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/** Navigate to game with a specific seed and wait for it to load */
export async function setupGame(page: Page, seed: string): Promise<void> {
  await page.goto(`http://localhost:3000/#seed=${seed}`);
  // Wait for the canvas to be present
  await page.waitForSelector('#game-canvas');
  // Wait for testAPI to be available
  await page.waitForFunction(() => !!(window as any).testAPI);
  // Wait for initial render (multiple frames to ensure canvas is fully painted)
  await waitForRender(page);
  await waitForRender(page);
}

/** Wait for 2 animation frames so canvas is fully painted */
export async function waitForRender(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).testAPI.waitForRender());
}

/** Take a full-page screenshot */
export async function screenshot(page: Page, name: string): Promise<string> {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath });
  return filePath;
}

/** Take a screenshot of just the canvas element */
export async function screenshotCanvas(page: Page, name: string): Promise<string> {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  const canvas = page.locator('#game-canvas');
  await canvas.screenshot({ path: filePath });
  return filePath;
}

// --- Game Action Helpers ---

/** End the current turn and wait for AI to finish */
export async function endTurn(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).testAPI.endTurn());
}

/** Select a unit by ID */
export async function selectUnit(page: Page, unitId: string): Promise<void> {
  await page.evaluate((id) => (window as any).testAPI.selectUnit(id), unitId);
  await waitForRender(page);
}

/** Move a unit to a coordinate */
export async function moveUnit(page: Page, unitId: string, q: number, r: number): Promise<void> {
  await page.evaluate(({ id, q, r }) => (window as any).testAPI.moveUnit(id, q, r), { id: unitId, q, r });
  await waitForRender(page);
}

/** Attack with a unit at a coordinate */
export async function attackUnit(page: Page, unitId: string, q: number, r: number): Promise<void> {
  await page.evaluate(({ id, q, r }) => (window as any).testAPI.attackUnit(id, q, r), { id: unitId, q, r });
  await waitForRender(page);
}

/** Train a unit at a city */
export async function trainUnit(page: Page, cityId: string, unitType: string): Promise<void> {
  await page.evaluate(({ cid, ut }) => (window as any).testAPI.trainUnit(cid, ut), { cid: cityId, ut: unitType });
  await waitForRender(page);
}

/** Research a technology */
export async function research(page: Page, techId: string): Promise<void> {
  await page.evaluate((id) => (window as any).testAPI.research(id), techId);
  await waitForRender(page);
}

/** Harvest a tile at coordinate */
export async function harvest(page: Page, q: number, r: number): Promise<void> {
  await page.evaluate(({ q, r }) => (window as any).testAPI.harvest(q, r), { q, r });
  await waitForRender(page);
}

/** Tap a game coordinate (simulates click) */
export async function tapCoord(page: Page, q: number, r: number): Promise<void> {
  await page.evaluate(({ q, r }) => (window as any).testAPI.tapCoord(q, r), { q, r });
  await waitForRender(page);
}

// --- State Query Helpers ---

export async function getGameState(page: Page) {
  return page.evaluate(() => {
    const api = (window as any).testAPI;
    return {
      phase: api.getPhase(),
      turn: api.getTurn(),
      drachma: api.getPlayerDrachma(),
    };
  });
}

export async function getPlayerUnits(page: Page) {
  return page.evaluate(() => {
    const units = (window as any).testAPI.getUnits();
    return units.filter((u: any) => u.owner === 0);
  });
}

export async function getPlayerCities(page: Page) {
  return page.evaluate(() => {
    const cities = (window as any).testAPI.getCities();
    return cities.filter((c: any) => c.owner === 0);
  });
}

export async function getAllUnits(page: Page) {
  return page.evaluate(() => (window as any).testAPI.getUnits());
}

export async function getAllCities(page: Page) {
  return page.evaluate(() => (window as any).testAPI.getCities());
}
