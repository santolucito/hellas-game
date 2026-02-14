import * as THREE from 'three';
import { GameState, Coord, coordKey, Unit, City, Tile, Terrain, coordEquals, coordsInRadius } from '../../game/types';
import { getValidMoves, getValidAttacks, getHarvestableTiles, getValidEmbarkTargets, getValidDisembarkTargets } from '../../game/state';

// Tile sizing
const TILE_SIZE = 1;
const TILE_SPACING = 1.0;  // No gaps between tiles

// Terrain elevations
const ELEVATION: Record<Terrain, number> = {
  water: -0.1,
  plains: 0,
  forest: 0.15,
  hills: 0.3
};

// Color palette matching 2D renderer
const COLORS = {
  plains: 0x7ec850,
  forest: 0x5a7a44,
  hills: 0xc9a86c,
  water: 0x4a9bd9,
  fog: 0xffffff,
  unexplored: 0xdddddd,
  player: 0x5bc0eb,
  enemy: 0xf25c54,
  neutral: 0xb8b8b8,
  selected: 0xfde74c,
  validMove: 0x9be65f,
  validAttack: 0xf25c54,
  harvestable: 0x9b59b6,
  embark: 0x5bc0eb,
  disembark: 0xffc864,
  white: 0xffffff
};

interface AttackAnim {
  attackerCoord: Coord;
  defenderCoord: Coord;
  startTime: number;
  duration: number;
}

export class ThreeRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;

  // Groups for organizing objects
  private tilesGroup: THREE.Group;
  private decorationsGroup: THREE.Group;
  private overlaysGroup: THREE.Group;
  private unitsGroup: THREE.Group;
  private citiesGroup: THREE.Group;
  private bordersGroup: THREE.Group;
  private fogGroup: THREE.Group;
  private starsGroup: THREE.Group;

  // Raycaster for click detection
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  // Camera control state
  private offsetX = 0;
  private offsetZ = 0;
  private zoom = 1;

  // Pan state
  private isPanning = false;
  private lastPanX = 0;
  private lastPanY = 0;

  // Touch state
  private touchStartX = 0;
  private touchStartY = 0;
  private isTouchPanning = false;
  private touchMoved = false;
  private lastPinchDist = 0;

  // Animation
  private attackAnim: AttackAnim | null = null;
  private animationFrame = 0;

  // Cached geometries and materials
  private tileMaterials: Map<string, THREE.MeshLambertMaterial>;
  private tileRefs: Map<string, THREE.Mesh> = new Map();

  /** Pure coordinate hash -> [0, 1). Use `index` to get independent streams per tile. */
  private tileHash(q: number, r: number, index: number): number {
    let h = (q * 374761 + r * 668265 + index * 1301081) | 0;
    h = ((h >> 16) ^ h) * 0x45d9f3b | 0;
    h = ((h >> 16) ^ h) * 0x45d9f3b | 0;
    h = (h >> 16) ^ h;
    return (h & 0x7fffffff) / 0x7fffffff;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // Setup WebGL renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setClearColor(0x87ceeb);  // Light sky blue background
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Setup scene
    this.scene = new THREE.Scene();

    // Setup orthographic camera for isometric view
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const frustum = 8;
    this.camera = new THREE.OrthographicCamera(
      -frustum * aspect, frustum * aspect,
      frustum, -frustum,
      0.1, 1000
    );

    // Position camera for isometric view (45 degrees, looking down at 35 degrees)
    this.camera.position.set(15, 15, 15);
    this.camera.lookAt(0, 0, 0);

    // Create groups
    this.starsGroup = new THREE.Group();
    this.tilesGroup = new THREE.Group();
    this.decorationsGroup = new THREE.Group();
    this.overlaysGroup = new THREE.Group();
    this.unitsGroup = new THREE.Group();
    this.citiesGroup = new THREE.Group();
    this.bordersGroup = new THREE.Group();
    this.fogGroup = new THREE.Group();

    // Create starfield background
    this.createStarfield();

    this.scene.add(this.starsGroup);
    this.scene.add(this.tilesGroup);
    this.scene.add(this.decorationsGroup);
    this.scene.add(this.overlaysGroup);
    this.scene.add(this.bordersGroup);
    this.scene.add(this.citiesGroup);
    this.scene.add(this.unitsGroup);
    this.scene.add(this.fogGroup);

    // Lighting - Bright daylight setup
    // Ambient light for overall brightness
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    // Hemisphere light: sky blue to ground green
    const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x98d982, 0.8);
    this.scene.add(hemisphereLight);

    // Main sunlight - bright warm white
    const sunLight = new THREE.DirectionalLight(0xfff4e5, 1.2);
    sunLight.position.set(5, 10, 5);
    this.scene.add(sunLight);

    // Fill light from opposite side
    const fillLight = new THREE.DirectionalLight(0xe8f4ff, 0.5);
    fillLight.position.set(-5, 5, -5);
    this.scene.add(fillLight);

    // Raycaster for picking
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Cached materials
    this.tileMaterials = new Map();

    // Setup controls
    this.setupControls();
    this.resize();
  }

  private setupControls(): void {
    // Mouse drag to pan
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
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
        const { worldX, worldZ } = this.screenToWorldDrag(dx, dy);
        this.offsetX -= worldX * 0.02 / this.zoom;
        this.offsetZ -= worldZ * 0.02 / this.zoom;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
        this.updateCamera();
      }
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
    });

    // Mouse wheel zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom = Math.max(0.3, Math.min(3, this.zoom * zoomFactor));
      this.updateCamera();
    }, { passive: false });

    // Touch controls
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.touchStartX = e.touches[0].clientX;
        this.touchStartY = e.touches[0].clientY;
        this.lastPanX = e.touches[0].clientX;
        this.lastPanY = e.touches[0].clientY;
        this.isTouchPanning = false;
        this.touchMoved = false;
      } else if (e.touches.length === 2) {
        this.lastPinchDist = this.getPinchDistance(e.touches);
        this.lastPanX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        this.lastPanY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: true });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const dx = touch.clientX - this.lastPanX;
        const dy = touch.clientY - this.lastPanY;

        // Check if moved enough to be considered a drag
        const totalDist = Math.hypot(touch.clientX - this.touchStartX, touch.clientY - this.touchStartY);
        if (totalDist > 10) {
          this.isTouchPanning = true;
          this.touchMoved = true;
        }

        if (this.isTouchPanning) {
          const { worldX, worldZ } = this.screenToWorldDrag(dx, dy);
          this.offsetX -= worldX * 0.02 / this.zoom;
          this.offsetZ -= worldZ * 0.02 / this.zoom;
          this.updateCamera();
          e.preventDefault();
        }

        this.lastPanX = touch.clientX;
        this.lastPanY = touch.clientY;
      } else if (e.touches.length === 2) {
        // Pan with two fingers
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const dx = midX - this.lastPanX;
        const dy = midY - this.lastPanY;
        const { worldX, worldZ } = this.screenToWorldDrag(dx, dy);
        this.offsetX -= worldX * 0.02 / this.zoom;
        this.offsetZ -= worldZ * 0.02 / this.zoom;
        this.lastPanX = midX;
        this.lastPanY = midY;

        // Pinch zoom
        const dist = this.getPinchDistance(e.touches);
        if (this.lastPinchDist > 0) {
          const scale = dist / this.lastPinchDist;
          this.zoom = Math.max(0.3, Math.min(3, this.zoom * scale));
        }
        this.lastPinchDist = dist;
        this.updateCamera();
        this.touchMoved = true;
        e.preventDefault();
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => {
      this.isTouchPanning = false;
      this.lastPinchDist = 0;
    }, { passive: true });

    // Prevent context menu
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private getPinchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private createStarfield(): void {
    const starCount = 800;
    const positions = new Float32Array(starCount * 3);

    // Create stars on a large sphere surrounding the scene
    for (let i = 0; i < starCount; i++) {
      // Spherical distribution for surrounding stars
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      const radius = 80 + Math.random() * 40; // Distance from center

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi) * 0.3 - 10; // Flatten and shift down
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9
    });

    const stars = new THREE.Points(geometry, material);
    this.starsGroup.add(stars);

    // Add some brighter "feature" stars
    const brightStarCount = 50;
    const brightPositions = new Float32Array(brightStarCount * 3);
    for (let i = 0; i < brightStarCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      const radius = 70 + Math.random() * 30;

      brightPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      brightPositions[i * 3 + 1] = radius * Math.cos(phi) * 0.3 - 10;
      brightPositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }

    const brightGeometry = new THREE.BufferGeometry();
    brightGeometry.setAttribute('position', new THREE.BufferAttribute(brightPositions, 3));

    const brightMaterial = new THREE.PointsMaterial({
      color: 0xffffee,
      size: 1.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1.0
    });

    const brightStars = new THREE.Points(brightGeometry, brightMaterial);
    this.starsGroup.add(brightStars);
  }

  // Convert screen-space drag to world-space for isometric 45-degree view
  private screenToWorldDrag(dx: number, dy: number): { worldX: number; worldZ: number } {
    // Rotate by -45 degrees to match isometric camera angle
    const angle = -Math.PI / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      worldX: dx * cos - dy * sin,
      worldZ: dx * sin + dy * cos
    };
  }

  private updateCamera(): void {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const frustum = 8 / this.zoom;

    this.camera.left = -frustum * aspect;
    this.camera.right = frustum * aspect;
    this.camera.top = frustum;
    this.camera.bottom = -frustum;

    // Update camera position based on offset
    this.camera.position.set(
      15 + this.offsetX,
      15,
      15 + this.offsetZ
    );
    this.camera.lookAt(
      this.offsetX,
      0,
      this.offsetZ
    );

    // Parallax effect: stars move slower than the camera (0.3x speed)
    const parallaxFactor = 0.3;
    this.starsGroup.position.set(
      this.offsetX * parallaxFactor,
      0,
      this.offsetZ * parallaxFactor
    );

    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    this.renderer.setSize(width, height, false);
    this.updateCamera();
  }

  private getTileMaterial(terrain: Terrain, isVisible: boolean, isDiscovered: boolean): THREE.MeshLambertMaterial {
    const key = `${terrain}-${isVisible}-${isDiscovered}`;

    if (!this.tileMaterials.has(key)) {
      let color: number;

      if (!isDiscovered) {
        color = COLORS.unexplored;
      } else if (!isVisible) {
        // Dimmed version
        color = this.dimColor(COLORS[terrain], 0.65);
      } else {
        color = COLORS[terrain];
      }

      const material = new THREE.MeshLambertMaterial({ color });
      this.tileMaterials.set(key, material);
    }

    return this.tileMaterials.get(key)!;
  }

  private dimColor(color: number, factor: number): number {
    const r = ((color >> 16) & 255) * factor;
    const g = ((color >> 8) & 255) * factor;
    const b = (color & 255) * factor;
    return (Math.floor(r) << 16) | (Math.floor(g) << 8) | Math.floor(b);
  }

  private coordToPosition(coord: Coord, terrain?: Terrain): THREE.Vector3 {
    const x = coord.q * TILE_SPACING;
    const z = coord.r * TILE_SPACING;
    const y = terrain ? ELEVATION[terrain] : 0;
    return new THREE.Vector3(x, y, z);
  }

  render(state: GameState): void {
    this.animationFrame++;

    // Clear existing objects
    this.clearGroup(this.tilesGroup);
    this.clearGroup(this.decorationsGroup);
    this.clearGroup(this.overlaysGroup);
    this.clearGroup(this.unitsGroup);
    this.clearGroup(this.citiesGroup);
    this.clearGroup(this.bordersGroup);
    this.clearGroup(this.fogGroup);
    this.tileRefs.clear();

    const selectedUnit = state.selectedUnitId ? state.units.get(state.selectedUnitId) ?? null : null;

    // Render tiles
    for (const [key, tile] of state.tiles) {
      const isDiscovered = state.discovered.has(key);
      const isVisible = state.visible.has(key);

      // Only show elevation for discovered tiles
      const elevation = isDiscovered ? ELEVATION[tile.terrain] : 0;
      const pos = this.coordToPosition(tile.coord, isDiscovered ? tile.terrain : 'plains');

      // Create tile mesh with height based on terrain (flat for undiscovered)
      const geometry = new THREE.BoxGeometry(TILE_SIZE, 0.2 + elevation, TILE_SIZE);
      const material = this.getTileMaterial(tile.terrain, isVisible, isDiscovered);
      const mesh = new THREE.Mesh(geometry, material);

      mesh.position.set(pos.x, (0.2 + elevation) / 2 - 0.1, pos.z);
      mesh.userData = { coord: tile.coord, terrain: tile.terrain };

      this.tilesGroup.add(mesh);
      this.tileRefs.set(key, mesh);

      // Add terrain decorations for visible tiles
      if (isVisible) {
        this.renderDecorations(tile);
      }

      // Add fog clouds for discovered but not visible tiles
      if (isDiscovered && !isVisible) {
        this.createFogCloud(tile.coord, tile.terrain);
      }
    }

    // Render overlays (valid moves, attacks, etc.)
    if (selectedUnit && selectedUnit.owner === 0) {
      // Valid moves - green
      const validMoves = getValidMoves(state, selectedUnit);
      for (const coord of validMoves) {
        this.addOverlay(coord, COLORS.validMove, 0.5, state);
      }

      // Valid attacks - red
      const validAttacks = getValidAttacks(state, selectedUnit);
      for (const coord of validAttacks) {
        this.addOverlay(coord, COLORS.validAttack, 0.5, state);
      }

      // Embark targets - cyan
      const embarkTargets = getValidEmbarkTargets(state, selectedUnit);
      for (const coord of embarkTargets) {
        this.addOverlay(coord, COLORS.embark, 0.6, state);
      }

      // Disembark targets - orange
      const disembarkTargets = getValidDisembarkTargets(state, selectedUnit);
      for (const coord of disembarkTargets) {
        this.addOverlay(coord, COLORS.disembark, 0.6, state);
      }
    }

    // Harvestable tiles - purple
    const harvestable = getHarvestableTiles(state, 0);
    for (const coord of harvestable) {
      this.addOverlay(coord, COLORS.harvestable, 0.4, state);
    }

    // Render cities
    for (const [, city] of state.cities) {
      const key = coordKey(city.coord);
      if (!state.discovered.has(key)) continue;

      this.renderCity(city, state);
    }

    // Render territory borders
    this.renderTerritoryBorders(state);

    // Render units
    for (const [, unit] of state.units) {
      const key = coordKey(unit.coord);
      if (unit.owner !== 0 && !state.visible.has(key)) continue;

      // Skip embarked units
      const isEmbarked = [...state.units.values()].some(
        u => u.type === 'trireme' && u.passengerIds?.includes(unit.id)
      );
      if (isEmbarked) continue;

      this.renderUnit(unit, state, selectedUnit);
    }

    // Render the scene
    this.renderer.render(this.scene, this.camera);
  }

  private addOverlay(coord: Coord, color: number, opacity: number, state: GameState): void {
    const tile = state.tiles.get(coordKey(coord));
    if (!tile) return;

    const geometry = new THREE.PlaneGeometry(TILE_SIZE * 0.9, TILE_SIZE * 0.9);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);

    const pos = this.coordToPosition(coord, tile.terrain);
    mesh.position.set(pos.x, ELEVATION[tile.terrain] + 0.15, pos.z);
    mesh.rotation.x = -Math.PI / 2;

    this.overlaysGroup.add(mesh);
  }

  private renderDecorations(tile: Tile): void {
    const { q, r } = tile.coord;
    const pos = this.coordToPosition(tile.coord, tile.terrain);
    const baseY = ELEVATION[tile.terrain] + 0.1; // tile surface

    if (tile.terrain === 'plains') {
      this.renderWheatStalks(q, r, pos.x, baseY, pos.z);
    } else if (tile.terrain === 'forest') {
      this.renderOliveTrees(q, r, pos.x, baseY, pos.z);
    } else if (tile.terrain === 'hills') {
      this.renderBoulders(q, r, pos.x, baseY, pos.z);
    } else if (tile.terrain === 'water') {
      this.renderWaves(q, r, pos.x, baseY, pos.z);
    }
  }

  private renderWheatStalks(q: number, r: number, x: number, baseY: number, z: number): void {
    const count = this.tileHash(q, r, 0) < 0.5 ? 2 : 3;
    const time = this.animationFrame * 0.015;

    for (let i = 0; i < count; i++) {
      const stalkGroup = new THREE.Group();

      // Seeded position offset within tile
      const ox = (this.tileHash(q, r, 10 + i) - 0.5) * 0.3;
      const oz = (this.tileHash(q, r, 20 + i) - 0.5) * 0.3;
      stalkGroup.position.set(x + ox, baseY, z + oz);

      // Seeded lean angle + gentle wind sway
      const windPhase = this.tileHash(q, r, 60 + i) * Math.PI * 2;
      const windSway = Math.sin(time + windPhase) * 0.06;
      const leanX = (this.tileHash(q, r, 30 + i) - 0.5) * 0.3 + windSway;
      const leanZ = (this.tileHash(q, r, 40 + i) - 0.5) * 0.3 + windSway * 0.5;
      stalkGroup.rotation.x = leanX;
      stalkGroup.rotation.z = leanZ;

      // Seeded height
      const height = 0.15 + this.tileHash(q, r, 50 + i) * 0.1;

      // Stem — thin olive-green cylinder
      const stemGeom = new THREE.CylinderGeometry(0.01, 0.01, height, 4);
      const stemMat = new THREE.MeshLambertMaterial({ color: 0x5a8a30 });
      const stem = new THREE.Mesh(stemGeom, stemMat);
      stem.position.y = height / 2;
      stalkGroup.add(stem);

      // Wheat head — ellipsoid at tip
      const headGeom = new THREE.SphereGeometry(0.03, 6, 4);
      const headMat = new THREE.MeshLambertMaterial({ color: 0xd4a843 });
      const head = new THREE.Mesh(headGeom, headMat);
      head.scale.set(0.7, 1.3, 0.7);
      head.position.y = height + 0.02;
      stalkGroup.add(head);

      this.decorationsGroup.add(stalkGroup);
    }
  }

  private renderOliveTrees(q: number, r: number, x: number, baseY: number, z: number): void {
    const count = this.tileHash(q, r, 0) < 0.4 ? 1 : 2;

    for (let i = 0; i < count; i++) {
      const treeGroup = new THREE.Group();

      const ox = (this.tileHash(q, r, 10 + i) - 0.5) * 0.3;
      const oz = (this.tileHash(q, r, 20 + i) - 0.5) * 0.3;
      const scale = 0.8 + this.tileHash(q, r, 30 + i) * 0.4;
      treeGroup.position.set(x + ox, baseY, z + oz);
      treeGroup.scale.setScalar(scale);

      // Trunk lean
      const trunkLean = (this.tileHash(q, r, 40 + i) - 0.5) * 0.15;

      // Trunk — warm brown, slightly tapered
      const trunkGeom = new THREE.CylinderGeometry(0.03, 0.04, 0.25, 6);
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b5940 });
      const trunk = new THREE.Mesh(trunkGeom, trunkMat);
      trunk.position.y = 0.125;
      trunk.rotation.z = trunkLean;
      treeGroup.add(trunk);

      // Canopy — oblate silver-green ellipsoid
      const canopyGeom = new THREE.SphereGeometry(0.18, 8, 6);
      const canopyMat = new THREE.MeshLambertMaterial({ color: 0x7a9a5a });
      const canopy = new THREE.Mesh(canopyGeom, canopyMat);
      canopy.scale.set(1.2, 0.7, 1.2);
      canopy.position.set(trunkLean * 0.5, 0.3, 0);
      treeGroup.add(canopy);

      // Highlight lobe — lighter accent nested in canopy
      const highlightGeom = new THREE.SphereGeometry(0.1, 6, 4);
      const highlightMat = new THREE.MeshLambertMaterial({ color: 0x9ab87a });
      const highlight = new THREE.Mesh(highlightGeom, highlightMat);
      highlight.position.set(trunkLean * 0.5 + 0.06, 0.33, 0.05);
      treeGroup.add(highlight);

      this.decorationsGroup.add(treeGroup);
    }
  }

  private renderBoulders(q: number, r: number, x: number, baseY: number, z: number): void {
    const count = this.tileHash(q, r, 0) < 0.5 ? 1 : 2;

    for (let i = 0; i < count; i++) {
      const ox = (this.tileHash(q, r, 10 + i) - 0.5) * 0.25;
      const oz = (this.tileHash(q, r, 20 + i) - 0.5) * 0.25;
      const scale = 0.8 + this.tileHash(q, r, 30 + i) * 0.4;
      const rotY = this.tileHash(q, r, 40 + i) * Math.PI * 2;

      const boulderGeom = new THREE.DodecahedronGeometry(0.12);
      const boulderMat = new THREE.MeshLambertMaterial({ color: 0x8a7a60 });
      const boulder = new THREE.Mesh(boulderGeom, boulderMat);
      boulder.position.set(x + ox, baseY + 0.08 * scale, z + oz);
      boulder.scale.setScalar(scale);
      boulder.rotation.y = rotY;
      boulder.rotation.x = this.tileHash(q, r, 50 + i) * 0.5;
      this.decorationsGroup.add(boulder);
    }

    // Optional accent pebble
    if (this.tileHash(q, r, 5) > 0.3) {
      const pox = (this.tileHash(q, r, 60) - 0.5) * 0.3;
      const poz = (this.tileHash(q, r, 61) - 0.5) * 0.3;
      const pebbleGeom = new THREE.DodecahedronGeometry(0.05);
      const pebbleMat = new THREE.MeshLambertMaterial({ color: 0x9a8868 });
      const pebble = new THREE.Mesh(pebbleGeom, pebbleMat);
      pebble.position.set(x + pox, baseY + 0.03, z + poz);
      pebble.rotation.set(
        this.tileHash(q, r, 62) * Math.PI,
        this.tileHash(q, r, 63) * Math.PI,
        0
      );
      this.decorationsGroup.add(pebble);
    }
  }

  private renderWaves(q: number, r: number, x: number, baseY: number, z: number): void {
    const time = this.animationFrame * 0.04;
    const waveCount = this.tileHash(q, r, 1) < 0.5 ? 2 : 3;

    for (let i = 0; i < waveCount; i++) {
      const phaseOffset = this.tileHash(q, r, 10 + i) * Math.PI * 2;
      const waveZ = z + (i - 1) * 0.15;
      const segments = 12;
      const halfWidth = 0.2;

      // Build sine-curve points
      const points: THREE.Vector3[] = [];
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const px = x - halfWidth + t * halfWidth * 2;
        const py = baseY + 0.02 + Math.sin(time + phaseOffset + t * Math.PI * 2) * 0.015;
        points.push(new THREE.Vector3(px, py, waveZ));
      }

      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeom = new THREE.TubeGeometry(curve, segments, 0.008, 4, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35 - i * 0.08,
        depthWrite: false
      });
      const tube = new THREE.Mesh(tubeGeom, tubeMat);
      this.decorationsGroup.add(tube);
    }
  }

  private renderCity(city: City, state: GameState): void {
    const tile = state.tiles.get(coordKey(city.coord));
    if (!tile) return;

    const pos = this.coordToPosition(city.coord, tile.terrain);
    const y = ELEVATION[tile.terrain] + 0.2;

    if (city.owner === null) {
      // --- NEUTRAL VILLAGE: simple hut ---
      // Wall
      const wallGeom = new THREE.BoxGeometry(0.2, 0.15, 0.2);
      const wallMat = new THREE.MeshLambertMaterial({ color: 0xb8a888 });
      const wall = new THREE.Mesh(wallGeom, wallMat);
      wall.position.set(pos.x, y + 0.075, pos.z);
      this.citiesGroup.add(wall);

      // Roof — cone rotated 45°
      const roofGeom = new THREE.ConeGeometry(0.18, 0.12, 4);
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x8b7355 });
      const roof = new THREE.Mesh(roofGeom, roofMat);
      roof.position.set(pos.x, y + 0.15 + 0.06, pos.z);
      roof.rotation.y = Math.PI / 4;
      this.citiesGroup.add(roof);

      // Warm hearth glow
      const light = new THREE.PointLight(0xffe0a0, 0.6, 2.5);
      light.position.set(pos.x, y + 0.3, pos.z);
      this.citiesGroup.add(light);
    } else {
      // --- OWNED CITY: Greek temple with team-colored roof ---
      const teamColor = city.owner === 0 ? COLORS.player : COLORS.enemy;

      // Base cylinder (sandstone)
      const baseGeom = new THREE.CylinderGeometry(0.3, 0.35, 0.1, 6);
      const baseMat = new THREE.MeshLambertMaterial({ color: 0xc8b898 });
      const base = new THREE.Mesh(baseGeom, baseMat);
      base.position.set(pos.x, y, pos.z);
      this.citiesGroup.add(base);

      // Foundation
      const foundGeom = new THREE.BoxGeometry(0.5, 0.06, 0.35);
      const foundMat = new THREE.MeshLambertMaterial({ color: 0xc8b898 });
      const found = new THREE.Mesh(foundGeom, foundMat);
      found.position.set(pos.x, y + 0.08, pos.z);
      this.citiesGroup.add(found);

      // Columns (4, marble)
      const colGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.35, 8);
      const colMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc8 });
      const colOffsets = [
        [-0.15, -0.1], [0.15, -0.1],
        [-0.15, 0.1], [0.15, 0.1]
      ];
      for (const [ox, oz] of colOffsets) {
        const col = new THREE.Mesh(colGeom, colMat);
        col.position.set(pos.x + ox, y + 0.285, pos.z + oz);
        this.citiesGroup.add(col);
      }

      // Roof pediment (team-colored)
      const roofGeom = new THREE.ConeGeometry(0.25, 0.15, 4);
      const roofMat = new THREE.MeshLambertMaterial({ color: teamColor });
      const roof = new THREE.Mesh(roofGeom, roofMat);
      roof.position.set(pos.x, y + 0.535, pos.z);
      roof.rotation.y = Math.PI / 4;
      this.citiesGroup.add(roof);

      // Capital ornament — gold sphere above roof peak
      if (city.isCapital) {
        const ornGeom = new THREE.SphereGeometry(0.04, 8, 6);
        const ornMat = new THREE.MeshLambertMaterial({ color: 0xf9c846 });
        const orn = new THREE.Mesh(ornGeom, ornMat);
        orn.position.set(pos.x, y + 0.65, pos.z);
        this.citiesGroup.add(orn);
      }

      // Team-tinted point light
      const lightColor = city.owner === 0 ? 0xc0e8ff : 0xffc0b0;
      const light = new THREE.PointLight(lightColor, 0.8, 3);
      light.position.set(pos.x, y + 0.5, pos.z);
      this.citiesGroup.add(light);
    }
  }

  private renderUnit(unit: Unit, state: GameState, selectedUnit: Unit | null): void {
    const tile = state.tiles.get(coordKey(unit.coord));
    if (!tile) return;

    const pos = this.coordToPosition(unit.coord, tile.terrain);
    const baseY = ELEVATION[tile.terrain] + 0.1; // tile surface

    const isSelected = selectedUnit?.id === unit.id;
    const teamColor = unit.owner === 0 ? COLORS.player : COLORS.enemy;

    // Apply attack animation
    let animOffsetX = 0;
    let animOffsetZ = 0;
    let animScale = 1;

    if (this.attackAnim) {
      const elapsed = Date.now() - this.attackAnim.startTime;
      const progress = Math.min(elapsed / this.attackAnim.duration, 1);

      if (coordEquals(unit.coord, this.attackAnim.attackerCoord) && progress < 0.5) {
        animScale = 1 + 0.3 * Math.sin(progress * 2 * Math.PI);
      }
      if (coordEquals(unit.coord, this.attackAnim.defenderCoord) && progress >= 0.3 && progress < 0.9) {
        animOffsetX = (Math.random() - 0.5) * 0.1;
        animOffsetZ = (Math.random() - 0.5) * 0.1;
      }

      if (progress >= 1) {
        this.attackAnim = null;
      }
    }

    // Build composed unit group
    const unitGroup = new THREE.Group();

    if (unit.type === 'hoplite') {
      this.buildHoplite(unitGroup, teamColor);
    } else if (unit.type === 'peltast') {
      this.buildPeltast(unitGroup, teamColor);
    } else {
      this.buildTrireme(unitGroup, teamColor);
    }

    unitGroup.position.set(pos.x + animOffsetX, baseY, pos.z + animOffsetZ);
    if (animScale !== 1) unitGroup.scale.setScalar(animScale);
    this.unitsGroup.add(unitGroup);

    // Selection indicator
    if (isSelected) {
      const ringGeom = new THREE.RingGeometry(0.25, 0.3, 16);
      const ringMat = new THREE.MeshBasicMaterial({
        color: COLORS.selected,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.position.set(pos.x, ELEVATION[tile.terrain] + 0.12, pos.z);
      ring.rotation.x = -Math.PI / 2;
      this.unitsGroup.add(ring);
    }

    // HP bar
    const hpPercent = unit.hp / unit.maxHp;
    const barWidth = 0.4;
    const barHeight = 0.05;
    const hpY = ELEVATION[tile.terrain] + 0.6;

    const bgGeom = new THREE.PlaneGeometry(barWidth, barHeight);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
    const bg = new THREE.Mesh(bgGeom, bgMat);
    bg.position.set(pos.x, hpY, pos.z);
    bg.lookAt(this.camera.position);
    this.unitsGroup.add(bg);

    const fillGeom = new THREE.PlaneGeometry(barWidth * hpPercent, barHeight);
    const hpColor = hpPercent > 0.5 ? 0x7ec850 : hpPercent > 0.25 ? 0xffc107 : 0xf25c54;
    const fillMat = new THREE.MeshBasicMaterial({ color: hpColor, side: THREE.DoubleSide });
    const fill = new THREE.Mesh(fillGeom, fillMat);
    fill.position.set(pos.x - (barWidth * (1 - hpPercent)) / 2, hpY, pos.z - 0.001);
    fill.lookAt(this.camera.position);
    this.unitsGroup.add(fill);

    // Passenger indicator for triremes
    if (unit.type === 'trireme' && unit.passengerIds && unit.passengerIds.length > 0) {
      const indGeom = new THREE.SphereGeometry(0.08, 8, 6);
      const indMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const indicator = new THREE.Mesh(indGeom, indMat);
      indicator.position.set(pos.x + 0.2, baseY + 0.25, pos.z);
      this.unitsGroup.add(indicator);
    }
  }

  private buildHoplite(group: THREE.Group, teamColor: number): void {
    // Body — cylinder
    const bodyGeom = new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8);
    const bodyMat = new THREE.MeshLambertMaterial({ color: teamColor });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.1;
    group.add(body);

    // Shield — bronze circle on left side
    const shieldGeom = new THREE.CircleGeometry(0.12, 12);
    const shieldMat = new THREE.MeshLambertMaterial({ color: 0xcd7f32, side: THREE.DoubleSide });
    const shield = new THREE.Mesh(shieldGeom, shieldMat);
    shield.position.set(-0.12, 0.1, 0);
    shield.rotation.y = -Math.PI / 4;
    group.add(shield);

    // Helmet — bronze sphere
    const helmGeom = new THREE.SphereGeometry(0.08, 8, 6);
    const helmMat = new THREE.MeshLambertMaterial({ color: 0xcd7f32 });
    const helm = new THREE.Mesh(helmGeom, helmMat);
    helm.position.y = 0.28;
    group.add(helm);

    // Plume — red crest on helmet
    const plumeGeom = new THREE.BoxGeometry(0.03, 0.06, 0.12);
    const plumeMat = new THREE.MeshLambertMaterial({ color: 0xdc3545 });
    const plume = new THREE.Mesh(plumeGeom, plumeMat);
    plume.position.y = 0.37;
    group.add(plume);

    // Spear — thin brown cylinder, angled
    const spearGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4);
    const spearMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
    const spear = new THREE.Mesh(spearGeom, spearMat);
    spear.position.set(0.12, 0.3, 0);
    spear.rotation.z = -0.3;
    group.add(spear);
  }

  private buildPeltast(group: THREE.Group, teamColor: number): void {
    // Body — slimmer cylinder
    const bodyGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.18, 8);
    const bodyMat = new THREE.MeshLambertMaterial({ color: teamColor });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.09;
    group.add(body);

    // Head — skin tone sphere
    const headGeom = new THREE.SphereGeometry(0.06, 8, 6);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xf5deb3 });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 0.24;
    group.add(head);

    // Headband — leather torus
    const bandGeom = new THREE.TorusGeometry(0.065, 0.015, 6, 12);
    const bandMat = new THREE.MeshLambertMaterial({ color: 0xa08060 });
    const band = new THREE.Mesh(bandGeom, bandMat);
    band.position.y = 0.25;
    band.rotation.x = Math.PI / 2;
    group.add(band);

    // Bow — brown partial torus, offset left
    const bowGeom = new THREE.TorusGeometry(0.12, 0.015, 8, 8, Math.PI * 0.8);
    const bowMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
    const bow = new THREE.Mesh(bowGeom, bowMat);
    bow.position.set(-0.15, 0.12, 0);
    bow.rotation.y = Math.PI / 2;
    group.add(bow);
  }

  private buildTrireme(group: THREE.Group, teamColor: number): void {
    // Hull — dark wood box, elongated in Z
    const hullGeom = new THREE.BoxGeometry(0.2, 0.12, 0.55);
    const hullMat = new THREE.MeshLambertMaterial({ color: 0x5d4e37 });
    const hull = new THREE.Mesh(hullGeom, hullMat);
    hull.position.y = 0.06;
    group.add(hull);

    // Ram — bronze cone at bow (pointed in +Z)
    const ramGeom = new THREE.ConeGeometry(0.06, 0.15, 4);
    const ramMat = new THREE.MeshLambertMaterial({ color: 0xcd7f32 });
    const ram = new THREE.Mesh(ramGeom, ramMat);
    ram.position.set(0, 0.04, 0.35);
    ram.rotation.x = -Math.PI / 2;
    group.add(ram);

    // Mast — thin vertical cylinder
    const mastGeom = new THREE.CylinderGeometry(0.015, 0.015, 0.35, 4);
    const mastMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
    const mast = new THREE.Mesh(mastGeom, mastMat);
    mast.position.y = 0.29;
    group.add(mast);

    // Sail — team-colored plane, angled for isometric visibility
    const sailGeom = new THREE.PlaneGeometry(0.2, 0.25);
    const sailMat = new THREE.MeshLambertMaterial({ color: teamColor, side: THREE.DoubleSide });
    const sail = new THREE.Mesh(sailGeom, sailMat);
    sail.position.set(0.06, 0.3, -0.02);
    sail.rotation.y = Math.PI / 3;
    group.add(sail);

    // Eye — white circle on hull side near bow
    const eyeGeom = new THREE.CircleGeometry(0.03, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const eye = new THREE.Mesh(eyeGeom, eyeMat);
    eye.position.set(0.101, 0.06, 0.18);
    eye.rotation.y = Math.PI / 2;
    group.add(eye);

    // Pupil — dark dot
    const pupilGeom = new THREE.CircleGeometry(0.015, 6);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.DoubleSide });
    const pupil = new THREE.Mesh(pupilGeom, pupilMat);
    pupil.position.set(0.102, 0.06, 0.19);
    pupil.rotation.y = Math.PI / 2;
    group.add(pupil);
  }

  private renderTerritoryBorders(state: GameState): void {
    // Build territory map
    const territoryMap = new Map<string, number>();
    for (const city of state.cities.values()) {
      if (city.owner !== null) {
        const coords = coordsInRadius(city.coord, city.territory);
        for (const coord of coords) {
          const key = coordKey(coord);
          if (state.tiles.has(key)) {
            territoryMap.set(key, city.owner);
          }
        }
      }
    }

    // Collect border edges per owner
    const playerEdges: number[] = [];
    const enemyEdges: number[] = [];

    // Cardinal neighbors and their corresponding tile edges
    const cardinals = [
      { dq: 0, dr: -1, x0: -0.5, z0: -0.5, x1: 0.5, z1: -0.5 }, // North
      { dq: 1, dr: 0,  x0: 0.5,  z0: -0.5, x1: 0.5, z1: 0.5 },  // East
      { dq: 0, dr: 1,  x0: 0.5,  z0: 0.5,  x1: -0.5, z1: 0.5 }, // South
      { dq: -1, dr: 0, x0: -0.5, z0: 0.5,  x1: -0.5, z1: -0.5 }, // West
    ];

    for (const [key, owner] of territoryMap) {
      if (!state.visible.has(key)) continue;

      const tile = state.tiles.get(key);
      if (!tile) continue;

      const { q, r } = tile.coord;
      const borderY = ELEVATION[tile.terrain] + 0.12;

      for (const c of cardinals) {
        const nKey = coordKey({ q: q + c.dq, r: r + c.dr });
        const nOwner = territoryMap.get(nKey);
        if (nOwner === owner) continue; // same territory, no border

        const edges = owner === 0 ? playerEdges : enemyEdges;
        edges.push(
          q + c.x0, borderY, r + c.z0,
          q + c.x1, borderY, r + c.z1
        );
      }
    }

    // Create LineSegments for each owner
    if (playerEdges.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(playerEdges, 3));
      const mat = new THREE.LineBasicMaterial({ color: COLORS.player, transparent: true, opacity: 0.8 });
      this.bordersGroup.add(new THREE.LineSegments(geom, mat));
    }

    if (enemyEdges.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(enemyEdges, 3));
      const mat = new THREE.LineBasicMaterial({ color: COLORS.enemy, transparent: true, opacity: 0.8 });
      this.bordersGroup.add(new THREE.LineSegments(geom, mat));
    }
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.Group) {
        this.clearGroup(child);
      } else if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      } else if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    }
  }

  private createFogCloud(coord: Coord, terrain: Terrain): void {
    const pos = this.coordToPosition(coord, terrain);
    const baseY = ELEVATION[terrain] + 0.25;
    const { q, r } = coord;

    // Fully deterministic — use tileHash for all randomness
    const puffCount = 3 + Math.floor(this.tileHash(q, r, 100) * 3); // 3-5 puffs
    const time = this.animationFrame * 0.008; // very slow bobbing

    for (let i = 0; i < puffCount; i++) {
      const size = 0.18 + this.tileHash(q, r, 110 + i) * 0.14; // 0.18-0.32

      // Deterministic spread in a soft cluster
      const angle = this.tileHash(q, r, 120 + i) * Math.PI * 2;
      const dist = this.tileHash(q, r, 130 + i) * 0.2;
      const bobPhase = this.tileHash(q, r, 140 + i) * Math.PI * 2;
      const bobOffset = Math.sin(time + bobPhase) * 0.03;

      const puffX = pos.x + Math.cos(angle) * dist;
      const puffZ = pos.z + Math.sin(angle) * dist;
      const puffY = baseY + i * 0.04 + bobOffset;

      // Soft pastel tint — alternating warm white and cotton-candy pink
      const tint = this.tileHash(q, r, 150 + i);
      const color = tint < 0.5 ? 0xfff5f0 : tint < 0.8 ? 0xfff0f5 : 0xf0f5ff;

      const geometry = new THREE.SphereGeometry(size, 10, 8);
      const material = new THREE.MeshLambertMaterial({
        color,
        transparent: true,
        opacity: 0.75 - (i * 0.06),
        depthWrite: false
      });

      const puff = new THREE.Mesh(geometry, material);
      puff.position.set(puffX, puffY, puffZ);
      puff.scale.set(1.3, 0.55, 1.3); // wide and flat — puffy cotton ball

      this.fogGroup.add(puff);
    }
  }

  coordToPixel(coord: { q: number; r: number }): { x: number; y: number } {
    const worldPos = new THREE.Vector3(coord.q * TILE_SPACING, 0, coord.r * TILE_SPACING);
    worldPos.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((worldPos.x + 1) / 2) * rect.width,
      y: rect.top + ((-worldPos.y + 1) / 2) * rect.height
    };
  }

  getCoordAtPixel(px: number, py: number, _tiles?: Map<string, Tile>): Coord {
    // Convert pixel coords to normalized device coords
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((px - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((py - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObjects(this.tilesGroup.children);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      if (hit.userData && hit.userData.coord) {
        return hit.userData.coord;
      }
    }

    // Fallback: project to ground plane
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, intersection);

    return {
      q: Math.round(intersection.x / TILE_SPACING),
      r: Math.round(intersection.z / TILE_SPACING)
    };
  }

  triggerAttackAnimation(attackerCoord: Coord, defenderCoord: Coord): void {
    this.attackAnim = {
      attackerCoord,
      defenderCoord,
      startTime: Date.now(),
      duration: 500
    };
  }

  isAnimating(): boolean {
    return this.attackAnim !== null;
  }

  wasTouchDrag(): boolean {
    return this.touchMoved;
  }

  resetTouchState(): void {
    this.touchMoved = false;
  }
}
