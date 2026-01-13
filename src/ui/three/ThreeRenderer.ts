import * as THREE from 'three';
import { GameState, Coord, coordKey, Unit, City, Tile, Terrain, coordEquals } from '../../game/types';
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
  forest: 0x3d8c40,
  hills: 0xc9a86c,
  water: 0x4a9bd9,
  fog: 0xffffff,
  unexplored: 0xffffff,
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
  private overlaysGroup: THREE.Group;
  private unitsGroup: THREE.Group;
  private citiesGroup: THREE.Group;
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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // Setup WebGL renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setClearColor(0x0a0a1a);  // Dark space background
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
    this.overlaysGroup = new THREE.Group();
    this.unitsGroup = new THREE.Group();
    this.citiesGroup = new THREE.Group();
    this.fogGroup = new THREE.Group();

    // Create starfield background
    this.createStarfield();

    this.scene.add(this.starsGroup);
    this.scene.add(this.tilesGroup);
    this.scene.add(this.overlaysGroup);
    this.scene.add(this.citiesGroup);
    this.scene.add(this.unitsGroup);
    this.scene.add(this.fogGroup);

    // Lighting - Natural daylight setup
    // Hemisphere light: sky color (light blue) to ground color (soft green reflection)
    const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x98d982, 0.6);
    this.scene.add(hemisphereLight);

    // Main sunlight - warm white for natural daylight feel
    const sunLight = new THREE.DirectionalLight(0xfff4e5, 1.0);
    sunLight.position.set(5, 10, 5);
    this.scene.add(sunLight);

    // Subtle fill light from opposite side to soften shadows
    const fillLight = new THREE.DirectionalLight(0xe8f4ff, 0.3);
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
      if (e.button === 1 || e.button === 2) {
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
    const starCount = 500;
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);

    // Create stars spread across a large plane behind the game
    for (let i = 0; i < starCount; i++) {
      // Spread stars in a dome-like pattern
      positions[i * 3] = (Math.random() - 0.5) * 200;     // x
      positions[i * 3 + 1] = -5 + Math.random() * -50;    // y (below the game, visible as background)
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200; // z

      // Vary star sizes for depth
      sizes[i] = Math.random() * 2 + 0.5;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.3,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8
    });

    const stars = new THREE.Points(geometry, material);
    this.starsGroup.add(stars);
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
        color = this.dimColor(COLORS[terrain], 0.5);
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
    this.clearGroup(this.overlaysGroup);
    this.clearGroup(this.unitsGroup);
    this.clearGroup(this.citiesGroup);
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

  private renderCity(city: City, state: GameState): void {
    const tile = state.tiles.get(coordKey(city.coord));
    if (!tile) return;

    const pos = this.coordToPosition(city.coord, tile.terrain);
    const y = ELEVATION[tile.terrain] + 0.2;

    // City base
    const baseGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.1, 6);
    let baseColor = city.owner === 0 ? COLORS.player :
                    city.owner === 1 ? COLORS.enemy : COLORS.neutral;
    const baseMaterial = new THREE.MeshLambertMaterial({ color: baseColor });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.set(pos.x, y, pos.z);
    this.citiesGroup.add(base);

    // Temple columns
    const columnGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8);
    const columnMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });

    const offsets = [
      [-0.15, -0.1], [0.15, -0.1],
      [-0.15, 0.1], [0.15, 0.1]
    ];

    for (const [ox, oz] of offsets) {
      const column = new THREE.Mesh(columnGeometry, columnMaterial);
      column.position.set(pos.x + ox, y + 0.2, pos.z + oz);
      this.citiesGroup.add(column);
    }

    // Roof
    const roofGeometry = new THREE.ConeGeometry(0.25, 0.15, 4);
    const roofMaterial = new THREE.MeshLambertMaterial({ color: 0xc9a227 });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.set(pos.x, y + 0.45, pos.z);
    roof.rotation.y = Math.PI / 4;
    this.citiesGroup.add(roof);
  }

  private renderUnit(unit: Unit, state: GameState, selectedUnit: Unit | null): void {
    const tile = state.tiles.get(coordKey(unit.coord));
    if (!tile) return;

    const pos = this.coordToPosition(unit.coord, tile.terrain);
    const y = ELEVATION[tile.terrain] + 0.3;

    const isSelected = selectedUnit?.id === unit.id;
    const color = unit.owner === 0 ? COLORS.player : COLORS.enemy;

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

    // Unit body (simple shapes for now)
    let geometry: THREE.BufferGeometry;

    if (unit.type === 'hoplite') {
      geometry = new THREE.ConeGeometry(0.15 * animScale, 0.4 * animScale, 8);
    } else if (unit.type === 'peltast') {
      geometry = new THREE.SphereGeometry(0.15 * animScale, 8, 6);
    } else {
      // Trireme - elongated shape
      geometry = new THREE.BoxGeometry(0.2 * animScale, 0.15 * animScale, 0.5 * animScale);
    }

    const material = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(pos.x + animOffsetX, y, pos.z + animOffsetZ);

    this.unitsGroup.add(mesh);

    // Selection indicator
    if (isSelected) {
      const ringGeometry = new THREE.RingGeometry(0.25, 0.3, 16);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: COLORS.selected,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.set(pos.x, ELEVATION[tile.terrain] + 0.12, pos.z);
      ring.rotation.x = -Math.PI / 2;
      this.unitsGroup.add(ring);
    }

    // HP bar
    const hpPercent = unit.hp / unit.maxHp;
    const barWidth = 0.4;
    const barHeight = 0.05;

    // Background
    const bgGeometry = new THREE.PlaneGeometry(barWidth, barHeight);
    const bgMaterial = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
    const bg = new THREE.Mesh(bgGeometry, bgMaterial);
    bg.position.set(pos.x, y + 0.3, pos.z);
    bg.lookAt(this.camera.position);
    this.unitsGroup.add(bg);

    // HP fill
    const fillGeometry = new THREE.PlaneGeometry(barWidth * hpPercent, barHeight);
    const hpColor = hpPercent > 0.5 ? 0x7ec850 : hpPercent > 0.25 ? 0xffc107 : 0xf25c54;
    const fillMaterial = new THREE.MeshBasicMaterial({ color: hpColor, side: THREE.DoubleSide });
    const fill = new THREE.Mesh(fillGeometry, fillMaterial);
    fill.position.set(pos.x - (barWidth * (1 - hpPercent)) / 2, y + 0.3, pos.z - 0.001);
    fill.lookAt(this.camera.position);
    this.unitsGroup.add(fill);

    // Passenger indicator for triremes
    if (unit.type === 'trireme' && unit.passengerIds && unit.passengerIds.length > 0) {
      const indicatorGeometry = new THREE.SphereGeometry(0.08, 8, 6);
      const indicatorMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
      indicator.position.set(pos.x + 0.2, y + 0.15, pos.z);
      this.unitsGroup.add(indicator);
    }
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    }
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
