import { GameState, Hex, hexKey, Unit, City, hexesInRadius } from '../game/types';
import { getValidMoves, getValidAttacks, getHarvestableTiles } from '../game/state';

// Tile rendering constants - Polytopia style
const TILE_SIZE = 48; // Base tile size
const TILE_HEIGHT = 12; // Depth of tile sides

// Polytopia-style color palette - soft, saturated pastels
const COLORS = {
  // Terrain top faces
  plains: '#7ec850',      // Bright grass green
  forest: '#3d8c40',      // Darker forest green
  hills: '#c9a86c',       // Sandy tan
  water: '#4a9bd9',       // Bright blue

  // Terrain side faces (darker versions)
  plainsSide: '#5ba030',
  forestSide: '#2d6830',
  hillsSide: '#a08050',
  waterSide: '#3080b0',

  // UI colors
  fog: '#1e3a5f',         // Dark blue fog
  unexplored: '#2a4a6f',  // Slightly lighter unexplored
  player: '#5bc0eb',      // Bright cyan-blue
  playerDark: '#3a9fc8',
  enemy: '#f25c54',       // Coral red
  enemyDark: '#d04040',
  neutral: '#b8b8b8',     // Gray for neutral villages
  neutralDark: '#888888',
  selected: '#fde74c',    // Bright yellow
  validMove: 'rgba(155, 230, 95, 0.6)',
  validAttack: 'rgba(242, 92, 84, 0.6)',
  cityBorder: '#f9c846',
  villageBorder: '#a0a0a0',
  playerTerritory: 'rgba(91, 192, 235, 0.15)',  // Subtle player territory tint
  enemyTerritory: 'rgba(242, 92, 84, 0.15)',    // Subtle enemy territory tint
  harvestable: 'rgba(155, 89, 182, 0.5)',       // Purple for harvestable tiles
  harvested: 'rgba(100, 100, 100, 0.3)',        // Gray overlay for harvested tiles
  white: '#ffffff',
  shadow: 'rgba(0, 0, 0, 0.3)'
};

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private offsetX = 0;
  private offsetY = 0;
  private scale = 1;
  private baseScale = 1;
  private width = 0;
  private height = 0;

  // Pan state
  private isPanning = false;
  private lastPanX = 0;
  private lastPanY = 0;

  // Pinch zoom state
  private lastPinchDist = 0;

  // Single touch pan state
  private touchStartX = 0;
  private touchStartY = 0;
  private isTouchPanning = false;
  private touchMoved = false;

  // Animation state
  private healAnimFrame = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.setupPanZoom();
  }

  private setupPanZoom(): void {
    // Mouse drag to pan
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2) { // Middle or right click
        this.isPanning = true;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.lastPanX;
        const dy = e.clientY - this.lastPanY;
        this.offsetX += dx;
        this.offsetY += dy;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
    });

    // Mouse wheel to zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      this.scale = Math.max(0.3, Math.min(2.5, this.scale * zoomFactor));
    });

    // Touch pan (single finger drag or two finger drag)
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        // Single finger - track for potential pan
        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.lastPanX = touch.clientX;
        this.lastPanY = touch.clientY;
        this.touchMoved = false;
        this.isTouchPanning = false;
      } else if (e.touches.length === 2) {
        // Two fingers - pan and pinch zoom
        this.isPanning = true;
        this.isTouchPanning = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        this.lastPanX = (t1.clientX + t2.clientX) / 2;
        this.lastPanY = (t1.clientY + t2.clientY) / 2;
        this.lastPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      }
    });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        // Single finger drag - pan the map
        const touch = e.touches[0];
        const dx = touch.clientX - this.lastPanX;
        const dy = touch.clientY - this.lastPanY;

        // Check if moved enough to be considered a drag (not a tap)
        const totalDist = Math.hypot(touch.clientX - this.touchStartX, touch.clientY - this.touchStartY);
        if (totalDist > 10) {
          this.isTouchPanning = true;
          this.touchMoved = true;
        }

        if (this.isTouchPanning) {
          this.offsetX += dx;
          this.offsetY += dy;
          e.preventDefault();
        }

        this.lastPanX = touch.clientX;
        this.lastPanY = touch.clientY;
      } else if (e.touches.length === 2 && this.isPanning) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];

        // Pan
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        this.offsetX += midX - this.lastPanX;
        this.offsetY += midY - this.lastPanY;
        this.lastPanX = midX;
        this.lastPanY = midY;

        // Pinch zoom
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        if (this.lastPinchDist > 0) {
          const zoomFactor = dist / this.lastPinchDist;
          this.scale = Math.max(0.3, Math.min(2.5, this.scale * zoomFactor));
        }
        this.lastPinchDist = dist;

        e.preventDefault();
      }
    });

    this.canvas.addEventListener('touchend', () => {
      this.isPanning = false;
      this.isTouchPanning = false;
      this.lastPinchDist = 0;
    });

    // Prevent context menu on right click
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();

    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    this.ctx.scale(dpr, dpr);

    // Center the map (only on initial load)
    if (this.offsetX === 0 && this.offsetY === 0) {
      this.offsetX = this.width / 2;
      this.offsetY = this.height / 2;
    }

    // Auto-scale based on screen size (smaller screens = smaller hexes)
    this.baseScale = Math.min(this.width, this.height) / 600;
    this.baseScale = Math.max(0.5, Math.min(1.5, this.baseScale));
    if (this.scale === 1) {
      this.scale = this.baseScale;
    }
  }

  private hexToPixel(hex: Hex): { x: number; y: number } {
    // Isometric-style hex positioning
    const x = TILE_SIZE * (3 / 2 * hex.q) * this.scale;
    const y = TILE_SIZE * (Math.sqrt(3) / 2 * hex.q + Math.sqrt(3) * hex.r) * this.scale;
    return { x: x + this.offsetX, y: y + this.offsetY };
  }

  // Get terrain elevation for 3D effect
  private getTerrainElevation(terrain: string): number {
    switch (terrain) {
      case 'water': return -8;
      case 'plains': return 0;
      case 'forest': return 4;
      case 'hills': return 10;
      default: return 0;
    }
  }

  // Get side color for terrain
  private getSideColor(terrain: string): string {
    return COLORS[`${terrain}Side` as keyof typeof COLORS] as string || COLORS.plainsSide;
  }

  pixelToHex(px: number, py: number): Hex {
    const x = (px - this.offsetX) / this.scale;
    const y = (py - this.offsetY) / this.scale;

    const q = (2 / 3 * x) / TILE_SIZE;
    const r = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / TILE_SIZE;

    // Round to nearest hex
    return this.hexRound(q, r);
  }

  private hexRound(q: number, r: number): Hex {
    const s = -q - r;

    let rq = Math.round(q);
    let rr = Math.round(r);
    const rs = Math.round(s);

    const qDiff = Math.abs(rq - q);
    const rDiff = Math.abs(rr - r);
    const sDiff = Math.abs(rs - s);

    if (qDiff > rDiff && qDiff > sDiff) {
      rq = -rr - rs;
    } else if (rDiff > sDiff) {
      rr = -rq - rs;
    }

    return { q: rq, r: rr };
  }

  // Draw a chunky isometric hex tile with depth - Polytopia style
  private drawChunkyTile(x: number, y: number, size: number, elevation: number, topColor: string, sideColor: string, isHighlight: boolean = false): void {
    const { ctx } = this;
    const h = TILE_HEIGHT * this.scale + elevation * this.scale;

    // Get hex corner points for the top face
    const topPoints: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      topPoints.push({
        x: x + size * Math.cos(angle),
        y: y - elevation * this.scale + size * Math.sin(angle)
      });
    }

    // Draw the side faces (only visible ones - bottom 3 sides)
    // Side faces go from bottom of top face down by TILE_HEIGHT
    ctx.fillStyle = sideColor;

    // Draw sides 2, 3, 4 (the visible bottom-facing sides)
    for (let i = 2; i <= 4; i++) {
      const p1 = topPoints[i];
      const p2 = topPoints[(i + 1) % 6];

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p2.x, p2.y + h);
      ctx.lineTo(p1.x, p1.y + h);
      ctx.closePath();
      ctx.fill();
    }

    // Draw the top face
    ctx.beginPath();
    ctx.moveTo(topPoints[0].x, topPoints[0].y);
    for (let i = 1; i < 6; i++) {
      ctx.lineTo(topPoints[i].x, topPoints[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = topColor;
    ctx.fill();

    // Highlight overlay for selection/valid moves
    if (isHighlight) {
      ctx.fillStyle = topColor;
      ctx.fill();
    }
  }

  // Simple flat hex for overlays (valid moves, attacks)
  private drawHexOverlay(x: number, y: number, size: number, color: string): void {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const hx = x + size * Math.cos(angle);
      const hy = y + size * Math.sin(angle);
      if (i === 0) {
        ctx.moveTo(hx, hy);
      } else {
        ctx.lineTo(hx, hy);
      }
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  private drawUnit(x: number, y: number, unit: Unit, isSelected: boolean, hasPhalanx: boolean = false, isOnFriendlyCity: boolean = false, elevation: number = 0): void {
    const { ctx } = this;
    const size = TILE_SIZE * 0.4 * this.scale;
    const color = unit.owner === 0 ? COLORS.player : COLORS.enemy;

    // Adjust y for terrain elevation
    const adjustedY = y - elevation * this.scale;

    // Healing glow effect for units on friendly cities
    if (isOnFriendlyCity && unit.hp < unit.maxHp) {
      const glowSize = size * 1.5 + Math.sin(this.healAnimFrame * 0.1) * 3;
      ctx.beginPath();
      ctx.arc(x, adjustedY, glowSize, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(155, 230, 95, 0.4)';
      ctx.fill();
    }

    // Unit shadow
    ctx.beginPath();
    ctx.ellipse(x, adjustedY + size * 0.3, size * 0.8, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.shadow;
    ctx.fill();

    // Unit body - chunky rounded square (Polytopia style)
    const bodySize = size * 0.9;
    ctx.beginPath();
    ctx.roundRect(x - bodySize, adjustedY - bodySize * 1.2, bodySize * 2, bodySize * 2, bodySize * 0.3);
    ctx.fillStyle = color;
    ctx.fill();

    // Selection ring
    if (isSelected) {
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Unit type icon
    ctx.fillStyle = COLORS.white;
    ctx.font = `bold ${size * 1.1}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const icon = unit.type === 'hoplite' ? '⚔' : unit.type === 'trireme' ? '⛵' : '🏹';
    ctx.fillText(icon, x, adjustedY - bodySize * 0.2);

    // Tech bonus indicator (shield for phalanx)
    if (hasPhalanx) {
      ctx.font = `bold ${size * 0.6}px sans-serif`;
      ctx.fillText('🛡', x + bodySize * 0.8, adjustedY - bodySize);
    }

    // HP bar - cleaner Polytopia style
    const hpWidth = bodySize * 1.6;
    const hpHeight = 4 * this.scale;
    const hpX = x - hpWidth / 2;
    const hpY = adjustedY + bodySize * 0.9;

    // HP bar background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.roundRect(hpX - 1, hpY - 1, hpWidth + 2, hpHeight + 2, 2);
    ctx.fill();

    // HP bar fill
    const hpPercent = unit.hp / unit.maxHp;
    ctx.fillStyle = hpPercent > 0.5 ? '#7ec850' : hpPercent > 0.25 ? '#f9c846' : '#f25c54';
    ctx.beginPath();
    ctx.roundRect(hpX, hpY, hpWidth * hpPercent, hpHeight, 2);
    ctx.fill();
  }

  private drawCity(x: number, y: number, city: City, elevation: number = 0): void {
    const { ctx } = this;
    const size = TILE_SIZE * 0.5 * this.scale;

    // Determine colors based on owner
    const isVillage = city.owner === null;
    const isPlayerOwned = city.owner === 0;
    const color = isVillage ? COLORS.neutral : (isPlayerOwned ? COLORS.player : COLORS.enemy);
    const borderColor = isVillage ? COLORS.villageBorder : COLORS.cityBorder;

    // Adjust y for terrain elevation
    const adjustedY = y - elevation * this.scale;

    // City shadow
    ctx.beginPath();
    ctx.ellipse(x, adjustedY + size * 0.4, size * 1.2, size * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.shadow;
    ctx.fill();

    // City/Village base - chunky rounded rectangle (Polytopia style)
    ctx.beginPath();
    ctx.roundRect(x - size * 1.1, adjustedY - size * 0.9, size * 2.2, size * 1.8, size * 0.2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // City/Village icon - villages get a different icon
    ctx.fillStyle = COLORS.white;
    ctx.font = `bold ${size * 1.3}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const icon = isVillage ? '🏕' : '🏛';
    ctx.fillText(icon, x, adjustedY - size * 0.1);

    // City name with background (villages show "Village")
    const nameY = adjustedY + size * 1.1;
    ctx.font = `bold ${10 * this.scale}px sans-serif`;
    const displayName = isVillage ? 'Village' : city.name;
    const nameWidth = ctx.measureText(displayName).width;

    // Name background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.roundRect(x - nameWidth / 2 - 4, nameY - 7, nameWidth + 8, 14, 3);
    ctx.fill();

    // Name text
    ctx.fillStyle = COLORS.white;
    ctx.fillText(displayName, x, nameY);

    // Show city level for owned cities (not villages)
    if (!isVillage && city.level > 1) {
      ctx.font = `bold ${8 * this.scale}px sans-serif`;
      ctx.fillStyle = COLORS.white;
      ctx.fillText(`Lv.${city.level}`, x, adjustedY - size * 1.2);
    }

    // Show population bar for owned cities
    if (!isVillage) {
      const popBarWidth = size * 1.6;
      const popBarHeight = 3 * this.scale;
      const popBarX = x - popBarWidth / 2;
      const popBarY = nameY + 10;
      const popNeeded = city.level + 1; // Population needed to level up
      const popProgress = Math.min(city.population / popNeeded, 1);

      // Population bar background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.roundRect(popBarX - 1, popBarY - 1, popBarWidth + 2, popBarHeight + 2, 2);
      ctx.fill();

      // Population bar fill
      ctx.fillStyle = '#9b59b6'; // Purple for population
      ctx.beginPath();
      ctx.roundRect(popBarX, popBarY, popBarWidth * popProgress, popBarHeight, 2);
      ctx.fill();
    }
  }

  render(state: GameState): void {
    const { ctx } = this;

    // Clear canvas with fog color
    ctx.fillStyle = COLORS.fog;
    ctx.fillRect(0, 0, this.width, this.height);

    const selectedUnit = state.selectedUnitId ? state.units.get(state.selectedUnitId) : null;
    const validMoves = selectedUnit ? getValidMoves(state, selectedUnit) : [];
    const validAttacks = selectedUnit ? getValidAttacks(state, selectedUnit) : [];

    // Sort tiles by row for proper z-ordering (draw from back to front)
    const sortedTiles = [...state.tiles.entries()].sort((a, b) => {
      const rowA = a[1].hex.r + a[1].hex.q * 0.5;
      const rowB = b[1].hex.r + b[1].hex.q * 0.5;
      return rowA - rowB;
    });

    // Build territory map for owned cities
    const territoryMap = new Map<string, 0 | 1>(); // hex key -> owner
    for (const city of state.cities.values()) {
      if (city.owner !== null) {
        const territoryHexes = hexesInRadius(city.hex, city.territory);
        for (const hex of territoryHexes) {
          const key = hexKey(hex);
          if (state.tiles.has(key)) {
            territoryMap.set(key, city.owner);
          }
        }
      }
    }

    // Draw tiles with chunky isometric style
    for (const [key, tile] of sortedTiles) {
      const { x, y } = this.hexToPixel(tile.hex);
      const size = TILE_SIZE * this.scale;
      const elevation = this.getTerrainElevation(tile.terrain);

      const isDiscovered = state.discovered.has(key);
      const isVisible = state.visible.has(key);

      if (!isDiscovered) {
        // Unexplored - dark chunky tile
        this.drawChunkyTile(x, y, size, 0, COLORS.unexplored, '#1a3050');
      } else if (!isVisible) {
        // Discovered but not in current vision - dimmed
        const topColor = this.dimColor(COLORS[tile.terrain as keyof typeof COLORS] as string);
        const sideColor = this.dimColor(this.getSideColor(tile.terrain));
        this.drawChunkyTile(x, y, size, elevation, topColor, sideColor);
      } else {
        // Fully visible - bright chunky tile
        const topColor = COLORS[tile.terrain as keyof typeof COLORS] as string;
        const sideColor = this.getSideColor(tile.terrain);
        this.drawChunkyTile(x, y, size, elevation, topColor, sideColor);

        // Draw terrain decorations
        this.drawTerrainDecoration(x, y - elevation * this.scale, tile.terrain, size);
      }

      // Draw territory overlay if this tile is in someone's territory and visible
      if (isVisible && territoryMap.has(key)) {
        const owner = territoryMap.get(key)!;
        const territoryColor = owner === 0 ? COLORS.playerTerritory : COLORS.enemyTerritory;
        this.drawHexOverlay(x, y - elevation * this.scale, size * 0.95, territoryColor);
      }

      // Draw harvested indicator for depleted resource tiles
      if (isVisible && tile.harvested && (tile.terrain === 'forest' || tile.terrain === 'hills' || tile.terrain === 'water')) {
        const adjustedY = y - elevation * this.scale;
        // Gray overlay to show depletion
        this.drawHexOverlay(x, adjustedY, size * 0.7, COLORS.harvested);
        // Small "depleted" icon
        this.ctx.font = `${TILE_SIZE * 0.25 * this.scale}px sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = 'rgba(100, 100, 100, 0.8)';
        this.ctx.fillText('✓', x, adjustedY);
      }
    }

    // Draw valid move highlights (overlay on top of tiles)
    for (const hex of validMoves) {
      const { x, y } = this.hexToPixel(hex);
      const tile = state.tiles.get(hexKey(hex));
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
      this.drawHexOverlay(x, y - elevation * this.scale, TILE_SIZE * this.scale * 0.85, COLORS.validMove);
    }

    // Draw valid attack highlights
    for (const hex of validAttacks) {
      const { x, y } = this.hexToPixel(hex);
      const tile = state.tiles.get(hexKey(hex));
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
      this.drawHexOverlay(x, y - elevation * this.scale, TILE_SIZE * this.scale * 0.85, COLORS.validAttack);
    }

    // Draw harvestable tile highlights (only when no unit selected during player turn)
    if (!selectedUnit && state.phase === 'player_turn') {
      const harvestableHexes = getHarvestableTiles(state, 0);
      for (const hex of harvestableHexes) {
        const key = hexKey(hex);
        if (!state.visible.has(key)) continue;

        const { x, y } = this.hexToPixel(hex);
        const tile = state.tiles.get(key);
        const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
        this.drawHexOverlay(x, y - elevation * this.scale, TILE_SIZE * this.scale * 0.8, COLORS.harvestable);

        // Draw resource icon
        const adjustedY = y - elevation * this.scale;
        this.ctx.font = `bold ${TILE_SIZE * 0.4 * this.scale}px sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        const resourceIcon = tile?.terrain === 'forest' ? '🦌' : tile?.terrain === 'hills' ? '⛏' : '🐟';
        this.ctx.fillText(resourceIcon, x, adjustedY);
      }
    }

    // Draw cities (only if visible), sorted by row
    const sortedCities = [...state.cities.values()].sort((a, b) => {
      const rowA = a.hex.r + a.hex.q * 0.5;
      const rowB = b.hex.r + b.hex.q * 0.5;
      return rowA - rowB;
    });

    for (const city of sortedCities) {
      const key = hexKey(city.hex);
      if (!state.visible.has(key)) continue;

      const { x, y } = this.hexToPixel(city.hex);
      const tile = state.tiles.get(key);
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
      this.drawCity(x, y, city, elevation);
    }

    // Increment animation frame
    this.healAnimFrame++;

    // Draw units (only if visible), sorted by row
    const sortedUnits = [...state.units.values()].sort((a, b) => {
      const rowA = a.hex.r + a.hex.q * 0.5;
      const rowB = b.hex.r + b.hex.q * 0.5;
      return rowA - rowB;
    });

    for (const unit of sortedUnits) {
      const key = hexKey(unit.hex);
      // Only show units in visible range, OR always show player units
      if (unit.owner !== 0 && !state.visible.has(key)) continue;

      const { x, y } = this.hexToPixel(unit.hex);
      const isSelected = state.selectedUnitId === unit.id;
      const hasPhalanx = unit.type === 'hoplite' && state.players[unit.owner].techs.includes('phalanx');

      // Get terrain elevation for this unit
      const tile = state.tiles.get(key);
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;

      // Check if unit is on a friendly city (for healing indicator)
      const isOnFriendlyCity = [...state.cities.values()].some(
        c => c.owner === unit.owner && c.hex.q === unit.hex.q && c.hex.r === unit.hex.r
      );

      this.drawUnit(x, y, unit, isSelected, hasPhalanx, isOnFriendlyCity, elevation);
    }

    // Draw selection indicator on selected unit (pulsing ring)
    if (selectedUnit) {
      const { x, y } = this.hexToPixel(selectedUnit.hex);
      const tile = state.tiles.get(hexKey(selectedUnit.hex));
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
      const adjustedY = y - elevation * this.scale;
      const pulseSize = TILE_SIZE * this.scale * 0.7 + Math.sin(this.healAnimFrame * 0.08) * 3;

      ctx.beginPath();
      ctx.arc(x, adjustedY, pulseSize, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // Draw terrain decorations (trees, rocks, etc.)
  private drawTerrainDecoration(x: number, y: number, terrain: string, size: number): void {
    const { ctx } = this;

    if (terrain === 'forest') {
      // Draw simple tree shapes
      ctx.fillStyle = '#2d5a30';
      const treeSize = size * 0.25;

      // Multiple small trees
      for (let i = 0; i < 3; i++) {
        const tx = x + (i - 1) * treeSize * 0.8;
        const ty = y - treeSize * 0.3 + (i % 2) * treeSize * 0.2;

        // Tree trunk
        ctx.fillStyle = '#5d4e37';
        ctx.fillRect(tx - treeSize * 0.1, ty, treeSize * 0.2, treeSize * 0.4);

        // Tree top (triangle)
        ctx.fillStyle = '#2d6830';
        ctx.beginPath();
        ctx.moveTo(tx, ty - treeSize * 0.6);
        ctx.lineTo(tx - treeSize * 0.35, ty + treeSize * 0.1);
        ctx.lineTo(tx + treeSize * 0.35, ty + treeSize * 0.1);
        ctx.closePath();
        ctx.fill();
      }
    } else if (terrain === 'hills') {
      // Draw simple rock shapes
      ctx.fillStyle = '#a89070';
      const rockSize = size * 0.15;

      for (let i = 0; i < 2; i++) {
        const rx = x + (i - 0.5) * rockSize * 1.5;
        const ry = y - rockSize * 0.2;

        ctx.beginPath();
        ctx.ellipse(rx, ry, rockSize * (0.8 + i * 0.3), rockSize * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (terrain === 'water') {
      // Draw simple wave lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;

      for (let i = 0; i < 2; i++) {
        const wy = y + (i - 0.5) * size * 0.25;
        ctx.beginPath();
        ctx.moveTo(x - size * 0.3, wy);
        ctx.quadraticCurveTo(x - size * 0.1, wy - 3, x, wy);
        ctx.quadraticCurveTo(x + size * 0.1, wy + 3, x + size * 0.3, wy);
        ctx.stroke();
      }
    }
  }

  private dimColor(color: string): string {
    // Parse hex color and reduce brightness by 50%
    const hex = color.replace('#', '');
    const r = Math.floor(parseInt(hex.slice(0, 2), 16) * 0.4);
    const g = Math.floor(parseInt(hex.slice(2, 4), 16) * 0.4);
    const b = Math.floor(parseInt(hex.slice(4, 6), 16) * 0.4);
    return `rgb(${r},${g},${b})`;
  }

  getHexAtPixel(px: number, py: number): Hex {
    return this.pixelToHex(px, py);
  }

  // Check if the last touch was a drag (to prevent click after pan)
  wasTouchDrag(): boolean {
    return this.touchMoved;
  }

  // Reset touch moved state (call after handling click)
  resetTouchState(): void {
    this.touchMoved = false;
  }
}
