import { GameState, Coord, coordKey, Unit, City, coordsInRadius } from '../game/types';
import { getValidMoves, getValidAttacks, getHarvestableTiles, getValidEmbarkTargets, getValidDisembarkTargets } from '../game/state';

// Tile rendering constants - Polytopia style isometric
const TILE_WIDTH = 64;  // Width of isometric diamond
const TILE_HEIGHT_HALF = 32; // Half height of diamond (isometric foreshortening)
const TILE_DEPTH = 16; // Depth of tile sides for 3D effect

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

  // Even darker for left side
  plainsSideLeft: '#4a8028',
  forestSideLeft: '#246020',
  hillsSideLeft: '#907040',
  waterSideLeft: '#2870a0',

  // UI colors
  fog: '#1e3a5f',         // Dark blue fog
  unexplored: '#2a4a6f',  // Slightly lighter unexplored
  unexploredSide: '#1a3050',
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
  embark: 'rgba(91, 192, 235, 0.6)',            // Cyan for embark targets
  disembark: 'rgba(255, 200, 100, 0.6)',        // Orange for disembark targets
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

  // Attack animation state
  private attackAnim: {
    attackerCoord: Coord;
    defenderCoord: Coord;
    startFrame: number;
    duration: number;
  } | null = null;

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
      this.offsetY = this.height / 4;
    }

    // Auto-scale based on screen size
    this.baseScale = Math.min(this.width, this.height) / 600;
    this.baseScale = Math.max(0.5, Math.min(1.5, this.baseScale));
    if (this.scale === 1) {
      this.scale = this.baseScale;
    }
  }

  // Trigger attack animation
  triggerAttackAnimation(attackerCoord: Coord, defenderCoord: Coord): void {
    this.attackAnim = {
      attackerCoord,
      defenderCoord,
      startFrame: this.healAnimFrame,
      duration: 20  // ~333ms at 60fps
    };
  }

  // Check if attack animation is in progress
  isAnimating(): boolean {
    if (!this.attackAnim) return false;
    const elapsed = this.healAnimFrame - this.attackAnim.startFrame;
    if (elapsed >= this.attackAnim.duration) {
      this.attackAnim = null;
      return false;
    }
    return true;
  }

  // Convert grid coordinates to screen pixels (isometric projection)
  private coordToPixel(coord: Coord): { x: number; y: number } {
    // Isometric transformation:
    // - q axis goes down-right
    // - r axis goes down-left
    const x = (coord.q - coord.r) * (TILE_WIDTH / 2) * this.scale;
    const y = (coord.q + coord.r) * (TILE_HEIGHT_HALF / 2) * this.scale;
    return { x: x + this.offsetX, y: y + this.offsetY };
  }

  // Get terrain elevation for 3D effect
  private getTerrainElevation(terrain: string): number {
    switch (terrain) {
      case 'water': return -6;
      case 'plains': return 0;
      case 'forest': return 4;
      case 'hills': return 10;
      default: return 0;
    }
  }

  // Get side color for terrain (right side - brighter)
  private getSideColor(terrain: string): string {
    return COLORS[`${terrain}Side` as keyof typeof COLORS] as string || COLORS.plainsSide;
  }

  // Get left side color for terrain (darker)
  private getLeftSideColor(terrain: string): string {
    return COLORS[`${terrain}SideLeft` as keyof typeof COLORS] as string || COLORS.plainsSideLeft;
  }

  // Convert screen pixels to grid coordinates (inverse isometric)
  pixelToCoord(px: number, py: number): Coord {
    const screenX = (px - this.offsetX) / this.scale;
    const screenY = (py - this.offsetY) / this.scale;

    // Inverse isometric transformation
    const q = (screenX / (TILE_WIDTH / 2) + screenY / (TILE_HEIGHT_HALF / 2)) / 2;
    const r = (screenY / (TILE_HEIGHT_HALF / 2) - screenX / (TILE_WIDTH / 2)) / 2;

    return { q: Math.round(q), r: Math.round(r) };
  }

  // Draw a chunky isometric diamond tile with depth - Polytopia style
  private drawChunkyTile(x: number, y: number, elevation: number, topColor: string, rightSideColor: string, leftSideColor: string): void {
    const { ctx } = this;
    const w = (TILE_WIDTH / 2) * this.scale;
    const h = (TILE_HEIGHT_HALF / 2) * this.scale;
    const depth = TILE_DEPTH * this.scale + elevation * this.scale * 0.5;

    // Adjust y for elevation
    const topY = y - elevation * this.scale;

    // Diamond vertices (top face)
    const north = { x: x, y: topY - h };
    const east = { x: x + w, y: topY };
    const south = { x: x, y: topY + h };
    const west = { x: x - w, y: topY };

    // Draw right side face (east to south)
    ctx.fillStyle = rightSideColor;
    ctx.beginPath();
    ctx.moveTo(east.x, east.y);
    ctx.lineTo(south.x, south.y);
    ctx.lineTo(south.x, south.y + depth);
    ctx.lineTo(east.x, east.y + depth);
    ctx.closePath();
    ctx.fill();

    // Draw left side face (south to west)
    ctx.fillStyle = leftSideColor;
    ctx.beginPath();
    ctx.moveTo(south.x, south.y);
    ctx.lineTo(west.x, west.y);
    ctx.lineTo(west.x, west.y + depth);
    ctx.lineTo(south.x, south.y + depth);
    ctx.closePath();
    ctx.fill();

    // Draw top face (diamond)
    ctx.fillStyle = topColor;
    ctx.beginPath();
    ctx.moveTo(north.x, north.y);
    ctx.lineTo(east.x, east.y);
    ctx.lineTo(south.x, south.y);
    ctx.lineTo(west.x, west.y);
    ctx.closePath();
    ctx.fill();
  }

  // Simple flat diamond for overlays (valid moves, attacks)
  private drawTileOverlay(x: number, y: number, sizeFactor: number, color: string): void {
    const { ctx } = this;
    const w = (TILE_WIDTH / 2) * this.scale * sizeFactor;
    const h = (TILE_HEIGHT_HALF / 2) * this.scale * sizeFactor;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - h);      // North
    ctx.lineTo(x + w, y);      // East
    ctx.lineTo(x, y + h);      // South
    ctx.lineTo(x - w, y);      // West
    ctx.closePath();
    ctx.fill();
  }

  private drawUnit(x: number, y: number, unit: Unit, isSelected: boolean, hasPhalanx: boolean = false, isOnFriendlyCity: boolean = false, elevation: number = 0, animScale: number = 1, animFlash: boolean = false): void {
    const { ctx } = this;
    const size = TILE_WIDTH * 0.25 * this.scale * animScale;
    const color = unit.owner === 0 ? COLORS.player : COLORS.enemy;
    const colorDark = unit.owner === 0 ? COLORS.playerDark : COLORS.enemyDark;

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

    // Attack flash effect (red glow when being hit)
    if (animFlash) {
      ctx.beginPath();
      ctx.arc(x, adjustedY, size * 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 80, 80, 0.5)';
      ctx.fill();
    }

    // Unit shadow
    ctx.beginPath();
    ctx.ellipse(x, adjustedY + size * 0.5, size * 0.9, size * 0.35, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.shadow;
    ctx.fill();

    // Draw unit based on type
    if (unit.type === 'hoplite') {
      this.drawHoplite(x, adjustedY, size, color, colorDark, hasPhalanx);
    } else if (unit.type === 'peltast') {
      this.drawPeltast(x, adjustedY, size, color, colorDark);
    } else if (unit.type === 'trireme') {
      this.drawTrireme(x, adjustedY, size, color, colorDark);
    }

    // Selection ring
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(x, adjustedY, size * 1.3, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // HP bar - cleaner Polytopia style
    const hpWidth = size * 1.8;
    const hpHeight = 4 * this.scale;
    const hpX = x - hpWidth / 2;
    const hpY = adjustedY + size * 0.7;

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

  // Cute hoplite warrior with helmet, shield and spear
  private drawHoplite(x: number, y: number, size: number, color: string, colorDark: string, hasPhalanx: boolean): void {
    const { ctx } = this;

    // Body (chunky cylinder shape)
    const bodyWidth = size * 0.7;
    const bodyHeight = size * 0.9;

    // Body front
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, bodyWidth, bodyHeight * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body side (3D effect)
    ctx.fillStyle = colorDark;
    ctx.beginPath();
    ctx.ellipse(x, y + bodyHeight * 0.15, bodyWidth, bodyHeight * 0.5, 0, 0, Math.PI);
    ctx.fill();

    // Shield (large round shield on left side)
    const shieldSize = size * 0.55;
    ctx.fillStyle = hasPhalanx ? '#ffd700' : '#cd7f32'; // Gold if phalanx, bronze otherwise
    ctx.beginPath();
    ctx.arc(x - size * 0.25, y - size * 0.1, shieldSize, 0, Math.PI * 2);
    ctx.fill();

    // Shield rim
    ctx.strokeStyle = hasPhalanx ? '#b8860b' : '#8b4513';
    ctx.lineWidth = 2 * this.scale;
    ctx.stroke();

    // Shield emblem (simple pattern)
    ctx.fillStyle = hasPhalanx ? '#b8860b' : '#8b4513';
    ctx.beginPath();
    ctx.arc(x - size * 0.25, y - size * 0.1, shieldSize * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Helmet (rounded with crest)
    const helmetY = y - size * 0.7;
    ctx.fillStyle = '#cd7f32'; // Bronze helmet
    ctx.beginPath();
    ctx.arc(x, helmetY, size * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Helmet crest (red plume)
    ctx.fillStyle = '#dc3545';
    ctx.beginPath();
    ctx.moveTo(x - size * 0.1, helmetY - size * 0.35);
    ctx.quadraticCurveTo(x, helmetY - size * 0.6, x + size * 0.4, helmetY - size * 0.25);
    ctx.quadraticCurveTo(x, helmetY - size * 0.1, x - size * 0.1, helmetY - size * 0.35);
    ctx.fill();

    // Face (cute dot eyes)
    ctx.fillStyle = '#2d2d2d';
    ctx.beginPath();
    ctx.arc(x - size * 0.12, helmetY + size * 0.05, size * 0.06, 0, Math.PI * 2);
    ctx.arc(x + size * 0.12, helmetY + size * 0.05, size * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // Spear (on right side)
    ctx.strokeStyle = '#8b4513';
    ctx.lineWidth = 3 * this.scale;
    ctx.beginPath();
    ctx.moveTo(x + size * 0.4, y + size * 0.3);
    ctx.lineTo(x + size * 0.5, y - size * 1.1);
    ctx.stroke();

    // Spear tip
    ctx.fillStyle = '#c0c0c0';
    ctx.beginPath();
    ctx.moveTo(x + size * 0.5, y - size * 1.1);
    ctx.lineTo(x + size * 0.4, y - size * 1.3);
    ctx.lineTo(x + size * 0.6, y - size * 1.3);
    ctx.closePath();
    ctx.fill();
  }

  // Cute peltast archer with bow
  private drawPeltast(x: number, y: number, size: number, color: string, colorDark: string): void {
    const { ctx } = this;

    // Body (slimmer than hoplite)
    const bodyWidth = size * 0.55;
    const bodyHeight = size * 0.8;

    // Body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, bodyWidth, bodyHeight * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body side
    ctx.fillStyle = colorDark;
    ctx.beginPath();
    ctx.ellipse(x, y + bodyHeight * 0.12, bodyWidth, bodyHeight * 0.5, 0, 0, Math.PI);
    ctx.fill();

    // Quiver on back (brown container with arrows)
    ctx.fillStyle = '#8b4513';
    ctx.beginPath();
    ctx.roundRect(x + size * 0.2, y - size * 0.5, size * 0.25, size * 0.7, 3);
    ctx.fill();

    // Arrow feathers sticking out
    ctx.fillStyle = '#f0e6d2';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + size * 0.25 + i * size * 0.06, y - size * 0.5);
      ctx.lineTo(x + size * 0.28 + i * size * 0.06, y - size * 0.7);
      ctx.lineTo(x + size * 0.31 + i * size * 0.06, y - size * 0.5);
      ctx.fill();
    }

    // Head (with simple cap)
    const headY = y - size * 0.6;
    ctx.fillStyle = '#f5deb3'; // Skin tone
    ctx.beginPath();
    ctx.arc(x, headY, size * 0.32, 0, Math.PI * 2);
    ctx.fill();

    // Cap
    ctx.fillStyle = '#228b22';
    ctx.beginPath();
    ctx.arc(x, headY - size * 0.1, size * 0.35, Math.PI, 0, true);
    ctx.fill();

    // Face (cute dot eyes)
    ctx.fillStyle = '#2d2d2d';
    ctx.beginPath();
    ctx.arc(x - size * 0.1, headY + size * 0.02, size * 0.05, 0, Math.PI * 2);
    ctx.arc(x + size * 0.1, headY + size * 0.02, size * 0.05, 0, Math.PI * 2);
    ctx.fill();

    // Bow (curved wood)
    ctx.strokeStyle = '#8b4513';
    ctx.lineWidth = 3 * this.scale;
    ctx.beginPath();
    ctx.arc(x - size * 0.5, y - size * 0.2, size * 0.5, -Math.PI * 0.4, Math.PI * 0.4);
    ctx.stroke();

    // Bowstring
    ctx.strokeStyle = '#f5f5dc';
    ctx.lineWidth = 1.5 * this.scale;
    ctx.beginPath();
    ctx.moveTo(x - size * 0.5 + Math.cos(-Math.PI * 0.4) * size * 0.5, y - size * 0.2 + Math.sin(-Math.PI * 0.4) * size * 0.5);
    ctx.lineTo(x - size * 0.5 + Math.cos(Math.PI * 0.4) * size * 0.5, y - size * 0.2 + Math.sin(Math.PI * 0.4) * size * 0.5);
    ctx.stroke();
  }

  // Cute trireme boat with sail
  private drawTrireme(x: number, y: number, size: number, color: string, colorDark: string): void {
    const { ctx } = this;

    // Hull (boat shape)
    const hullWidth = size * 1.3;
    const hullHeight = size * 0.5;

    // Hull bottom (darker)
    ctx.fillStyle = '#5d4e37';
    ctx.beginPath();
    ctx.moveTo(x - hullWidth, y + hullHeight * 0.3);
    ctx.quadraticCurveTo(x, y + hullHeight, x + hullWidth, y + hullHeight * 0.3);
    ctx.lineTo(x + hullWidth * 0.8, y);
    ctx.lineTo(x - hullWidth * 0.8, y);
    ctx.closePath();
    ctx.fill();

    // Hull top (lighter wood)
    ctx.fillStyle = '#8b7355';
    ctx.beginPath();
    ctx.moveTo(x - hullWidth * 0.9, y - hullHeight * 0.1);
    ctx.lineTo(x + hullWidth * 0.9, y - hullHeight * 0.1);
    ctx.lineTo(x + hullWidth * 0.8, y + hullHeight * 0.2);
    ctx.lineTo(x - hullWidth * 0.8, y + hullHeight * 0.2);
    ctx.closePath();
    ctx.fill();

    // Ram at front (pointed)
    ctx.fillStyle = '#cd7f32';
    ctx.beginPath();
    ctx.moveTo(x + hullWidth, y + hullHeight * 0.3);
    ctx.lineTo(x + hullWidth * 1.3, y + hullHeight * 0.1);
    ctx.lineTo(x + hullWidth, y - hullHeight * 0.1);
    ctx.closePath();
    ctx.fill();

    // Mast
    ctx.fillStyle = '#5d4e37';
    ctx.fillRect(x - size * 0.06, y - size * 1.2, size * 0.12, size * 1.1);

    // Sail (team colored)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - size * 1.1);
    ctx.quadraticCurveTo(x + size * 0.6, y - size * 0.7, x + size * 0.1, y - size * 0.2);
    ctx.lineTo(x, y - size * 0.2);
    ctx.closePath();
    ctx.fill();

    // Sail edge
    ctx.strokeStyle = colorDark;
    ctx.lineWidth = 2 * this.scale;
    ctx.stroke();

    // Oars (small sticks on sides)
    ctx.strokeStyle = '#8b7355';
    ctx.lineWidth = 2 * this.scale;
    for (let i = -2; i <= 2; i++) {
      const oarX = x + i * size * 0.3;
      // Left oar
      ctx.beginPath();
      ctx.moveTo(oarX, y + hullHeight * 0.1);
      ctx.lineTo(oarX - size * 0.25, y + hullHeight * 0.5);
      ctx.stroke();
      // Right oar
      ctx.beginPath();
      ctx.moveTo(oarX, y + hullHeight * 0.1);
      ctx.lineTo(oarX + size * 0.25, y + hullHeight * 0.5);
      ctx.stroke();
    }

    // Cute face on hull
    ctx.fillStyle = '#2d2d2d';
    ctx.beginPath();
    ctx.arc(x + hullWidth * 0.5, y, size * 0.06, 0, Math.PI * 2);
    ctx.arc(x + hullWidth * 0.7, y, size * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawCity(x: number, y: number, city: City, elevation: number = 0): void {
    const { ctx } = this;
    const size = TILE_WIDTH * 0.3 * this.scale;

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
    const validEmbarkTargets = selectedUnit ? getValidEmbarkTargets(state, selectedUnit) : [];
    const validDisembarkTargets = selectedUnit ? getValidDisembarkTargets(state, selectedUnit) : [];

    // Sort tiles by depth for proper z-ordering (draw from back to front)
    // In isometric view, tiles with lower (q + r) should be drawn first
    const sortedTiles = [...state.tiles.entries()].sort((a, b) => {
      const depthA = a[1].coord.q + a[1].coord.r;
      const depthB = b[1].coord.q + b[1].coord.r;
      return depthA - depthB;
    });

    // Build territory map for owned cities
    const territoryMap = new Map<string, 0 | 1>(); // coord key -> owner
    for (const city of state.cities.values()) {
      if (city.owner !== null) {
        const territoryCoords = coordsInRadius(city.coord, city.territory);
        for (const coord of territoryCoords) {
          const key = coordKey(coord);
          if (state.tiles.has(key)) {
            territoryMap.set(key, city.owner);
          }
        }
      }
    }

    // Draw tiles with chunky isometric style
    for (const [key, tile] of sortedTiles) {
      const { x, y } = this.coordToPixel(tile.coord);
      const elevation = this.getTerrainElevation(tile.terrain);

      const isDiscovered = state.discovered.has(key);
      const isVisible = state.visible.has(key);

      if (!isDiscovered) {
        // Unexplored - dark chunky tile
        this.drawChunkyTile(x, y, 0, COLORS.unexplored, COLORS.unexploredSide, '#152535');
      } else if (!isVisible) {
        // Discovered but not in current vision - dimmed
        const topColor = this.dimColor(COLORS[tile.terrain as keyof typeof COLORS] as string);
        const sideColor = this.dimColor(this.getSideColor(tile.terrain));
        const leftSideColor = this.dimColor(this.getLeftSideColor(tile.terrain));
        this.drawChunkyTile(x, y, elevation, topColor, sideColor, leftSideColor);
      } else {
        // Fully visible - bright chunky tile
        const topColor = COLORS[tile.terrain as keyof typeof COLORS] as string;
        const sideColor = this.getSideColor(tile.terrain);
        const leftSideColor = this.getLeftSideColor(tile.terrain);
        this.drawChunkyTile(x, y, elevation, topColor, sideColor, leftSideColor);

        // Draw terrain decorations
        this.drawTerrainDecoration(x, y - elevation * this.scale, tile.terrain);
      }

      // Draw territory overlay if this tile is in someone's territory and visible
      if (isVisible && territoryMap.has(key)) {
        const owner = territoryMap.get(key)!;
        const territoryColor = owner === 0 ? COLORS.playerTerritory : COLORS.enemyTerritory;
        this.drawTileOverlay(x, y - elevation * this.scale, 0.9, territoryColor);
      }

      // Draw harvested indicator for depleted resource tiles
      if (isVisible && tile.harvested && (tile.terrain === 'forest' || tile.terrain === 'hills' || tile.terrain === 'water')) {
        const adjustedY = y - elevation * this.scale;
        // Gray overlay to show depletion
        this.drawTileOverlay(x, adjustedY, 0.7, COLORS.harvested);
        // Small "depleted" icon
        this.ctx.font = `${TILE_WIDTH * 0.15 * this.scale}px sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = 'rgba(100, 100, 100, 0.8)';
        this.ctx.fillText('✓', x, adjustedY);
      }
    }

    // Draw valid move highlights (overlay on top of tiles)
    for (const coord of validMoves) {
      const { x, y } = this.coordToPixel(coord);
      const tile = state.tiles.get(coordKey(coord));
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
      this.drawTileOverlay(x, y - elevation * this.scale, 0.85, COLORS.validMove);
    }

    // Draw valid attack highlights
    for (const coord of validAttacks) {
      const { x, y } = this.coordToPixel(coord);
      const tile = state.tiles.get(coordKey(coord));
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
      this.drawTileOverlay(x, y - elevation * this.scale, 0.85, COLORS.validAttack);
    }

    // Draw valid embark highlights (land unit can board trireme)
    for (const coord of validEmbarkTargets) {
      const { x, y } = this.coordToPixel(coord);
      const tile = state.tiles.get(coordKey(coord));
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
      this.drawTileOverlay(x, y - elevation * this.scale, 0.85, COLORS.embark);
    }

    // Draw valid disembark highlights (trireme can drop passenger)
    for (const coord of validDisembarkTargets) {
      const { x, y } = this.coordToPixel(coord);
      const tile = state.tiles.get(coordKey(coord));
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
      this.drawTileOverlay(x, y - elevation * this.scale, 0.85, COLORS.disembark);
    }

    // Draw harvestable tile highlights (only when no unit selected during player turn)
    if (!selectedUnit && state.phase === 'player_turn') {
      const harvestableCoords = getHarvestableTiles(state, 0);
      for (const coord of harvestableCoords) {
        const key = coordKey(coord);
        if (!state.visible.has(key)) continue;

        const { x, y } = this.coordToPixel(coord);
        const tile = state.tiles.get(key);
        const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
        this.drawTileOverlay(x, y - elevation * this.scale, 0.8, COLORS.harvestable);

        // Draw resource icon
        const adjustedY = y - elevation * this.scale;
        this.ctx.font = `bold ${TILE_WIDTH * 0.25 * this.scale}px sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        const resourceIcon = tile?.terrain === 'forest' ? '🦌' : tile?.terrain === 'hills' ? '⛏' : '🐟';
        this.ctx.fillText(resourceIcon, x, adjustedY);
      }
    }

    // Draw cities (only if visible), sorted by depth
    const sortedCities = [...state.cities.values()].sort((a, b) => {
      const depthA = a.coord.q + a.coord.r;
      const depthB = b.coord.q + b.coord.r;
      return depthA - depthB;
    });

    for (const city of sortedCities) {
      const key = coordKey(city.coord);
      if (!state.visible.has(key)) continue;

      const { x, y } = this.coordToPixel(city.coord);
      const tile = state.tiles.get(key);
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
      this.drawCity(x, y, city, elevation);
    }

    // Increment animation frame
    this.healAnimFrame++;

    // Draw units (only if visible), sorted by depth
    const sortedUnits = [...state.units.values()].sort((a, b) => {
      const depthA = a.coord.q + a.coord.r;
      const depthB = b.coord.q + b.coord.r;
      return depthA - depthB;
    });

    for (const unit of sortedUnits) {
      const key = coordKey(unit.coord);
      // Only show units in visible range, OR always show player units
      if (unit.owner !== 0 && !state.visible.has(key)) continue;

      // Skip drawing units that are embarked on a trireme
      const isEmbarked = [...state.units.values()].some(
        u => u.type === 'trireme' && u.passengerId === unit.id
      );
      if (isEmbarked) continue;

      const { x, y } = this.coordToPixel(unit.coord);
      const isSelected = state.selectedUnitId === unit.id;
      const hasPhalanx = unit.type === 'hoplite' && state.players[unit.owner].techs.includes('phalanx');

      // Get terrain elevation for this unit
      const tile = state.tiles.get(key);
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;

      // Check if unit is on a friendly city (for healing indicator)
      const isOnFriendlyCity = [...state.cities.values()].some(
        c => c.owner === unit.owner && c.coord.q === unit.coord.q && c.coord.r === unit.coord.r
      );

      // Calculate attack animation effects
      let animScale = 1;
      let animShakeX = 0;
      let animShakeY = 0;
      let animFlash = false;

      if (this.attackAnim) {
        const elapsed = this.healAnimFrame - this.attackAnim.startFrame;
        const progress = elapsed / this.attackAnim.duration;
        const isAttacker = unit.coord.q === this.attackAnim.attackerCoord.q &&
                          unit.coord.r === this.attackAnim.attackerCoord.r;
        const isDefender = unit.coord.q === this.attackAnim.defenderCoord.q &&
                          unit.coord.r === this.attackAnim.defenderCoord.r;

        if (isAttacker && progress < 0.5) {
          // Attacker pulses up in first half
          const pulseProgress = progress * 2; // 0 to 1 in first half
          animScale = 1 + 0.3 * Math.sin(pulseProgress * Math.PI);
        }
        if (isDefender && progress >= 0.3 && progress < 0.9) {
          // Defender shakes and flashes in second portion
          animShakeX = (Math.random() - 0.5) * 8;
          animShakeY = (Math.random() - 0.5) * 6;
          animFlash = true;
        }
      }

      this.drawUnit(x + animShakeX, y + animShakeY, unit, isSelected, hasPhalanx, isOnFriendlyCity, elevation, animScale, animFlash);

      // Draw passenger indicator for triremes carrying units
      if (unit.type === 'trireme' && unit.passengerId) {
        const adjustedY = y - elevation * this.scale;
        const size = TILE_WIDTH * this.scale * 0.15;
        ctx.font = `bold ${size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        // Small icon indicating passenger (person emoji or +1)
        const passengerText = '👤';
        ctx.strokeText(passengerText, x + animShakeX + size, adjustedY - size * 1.5);
        ctx.fillText(passengerText, x + animShakeX + size, adjustedY - size * 1.5);
      }
    }

    // Draw selection indicator on selected unit (pulsing ring)
    if (selectedUnit) {
      const { x, y } = this.coordToPixel(selectedUnit.coord);
      const tile = state.tiles.get(coordKey(selectedUnit.coord));
      const elevation = tile ? this.getTerrainElevation(tile.terrain) : 0;
      const adjustedY = y - elevation * this.scale;
      const pulseSize = TILE_WIDTH * this.scale * 0.4 + Math.sin(this.healAnimFrame * 0.08) * 3;

      ctx.beginPath();
      ctx.arc(x, adjustedY, pulseSize, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // Draw terrain decorations (trees, rocks, etc.)
  private drawTerrainDecoration(x: number, y: number, terrain: string): void {
    const { ctx } = this;
    const size = TILE_WIDTH * 0.5 * this.scale;

    if (terrain === 'forest') {
      // Draw simple tree shapes
      const treeSize = size * 0.3;

      // Multiple small trees
      for (let i = 0; i < 2; i++) {
        const tx = x + (i - 0.5) * treeSize * 0.8;
        const ty = y - treeSize * 0.2 + (i % 2) * treeSize * 0.1;

        // Tree trunk
        ctx.fillStyle = '#5d4e37';
        ctx.fillRect(tx - treeSize * 0.08, ty, treeSize * 0.16, treeSize * 0.3);

        // Tree top (triangle)
        ctx.fillStyle = '#2d6830';
        ctx.beginPath();
        ctx.moveTo(tx, ty - treeSize * 0.5);
        ctx.lineTo(tx - treeSize * 0.25, ty + treeSize * 0.05);
        ctx.lineTo(tx + treeSize * 0.25, ty + treeSize * 0.05);
        ctx.closePath();
        ctx.fill();
      }
    } else if (terrain === 'hills') {
      // Draw simple rock shapes
      ctx.fillStyle = '#a89070';
      const rockSize = size * 0.15;

      for (let i = 0; i < 2; i++) {
        const rx = x + (i - 0.5) * rockSize * 1.2;
        const ry = y - rockSize * 0.1;

        ctx.beginPath();
        ctx.ellipse(rx, ry, rockSize * (0.7 + i * 0.2), rockSize * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (terrain === 'water') {
      // Draw simple wave lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;

      for (let i = 0; i < 2; i++) {
        const wy = y + (i - 0.5) * size * 0.15;
        ctx.beginPath();
        ctx.moveTo(x - size * 0.2, wy);
        ctx.quadraticCurveTo(x - size * 0.07, wy - 2, x, wy);
        ctx.quadraticCurveTo(x + size * 0.07, wy + 2, x + size * 0.2, wy);
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

  getCoordAtPixel(px: number, py: number, tiles?: Map<string, { coord: Coord; terrain: string }>): Coord {
    const rawCoord = this.pixelToCoord(px, py);

    if (!tiles) return rawCoord;

    // Check tiles that might visually contain this click (accounting for elevation)
    // We need to check the raw coord and tiles "behind" it (lower q+r) that have elevation
    const candidates: { coord: Coord; elevation: number; terrain: string }[] = [];

    // Check a range of nearby tiles
    for (let dq = -2; dq <= 1; dq++) {
      for (let dr = -2; dr <= 1; dr++) {
        const checkCoord = { q: rawCoord.q + dq, r: rawCoord.r + dr };
        const key = `${checkCoord.q},${checkCoord.r}`;
        const tile = tiles.get(key);
        if (tile) {
          candidates.push({
            coord: checkCoord,
            elevation: this.getTerrainElevation(tile.terrain),
            terrain: tile.terrain
          });
        }
      }
    }

    // Sort by render order (front to back): higher q+r is in front
    candidates.sort((a, b) => (b.coord.q + b.coord.r) - (a.coord.q + a.coord.r));

    // Check each tile to see if click is inside its visual diamond
    const w = (TILE_WIDTH / 2) * this.scale;
    const h = (TILE_HEIGHT_HALF / 2) * this.scale;

    for (const candidate of candidates) {
      const { x, y } = this.coordToPixel(candidate.coord);
      const topY = y - candidate.elevation * this.scale;

      // Check if point is inside diamond: |dx|/w + |dy|/h <= 1
      const dx = Math.abs(px - x);
      const dy = Math.abs(py - topY);

      if (dx / w + dy / h <= 1) {
        return candidate.coord;
      }
    }

    return rawCoord;
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
