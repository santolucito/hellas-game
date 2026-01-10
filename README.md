# Hellas - Greek Strategy Game

A browser-based, mobile-compatible, turn-based strategy game inspired by Polytopia, themed around ancient Greek city-states.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Controls

### Selection & Movement
- **Tap unit** - Select unit (blue circle shows selection)
- **Tap green hex** - Move selected unit to valid location
- **Tap red hex** - Attack enemy unit/city
- **Tap own city** - Open training menu to produce units

### Buttons
- **End Turn** - End your turn, AI takes its turn
- **Tech** - Open technology research menu

### Camera Controls
- **Mouse wheel** - Zoom in/out
- **Right-click drag** - Pan camera
- **Two-finger pinch** - Zoom on mobile
- **Two-finger drag** - Pan on mobile

### Other
- **Hover tile** - Show tooltip with terrain/unit info
- **Press D** - Toggle debug overlay (FPS, seed, tile info)

## Game Rules

### Objective
Capture the enemy Polis (city) OR defeat all enemy units.

### Units
| Unit | HP | ATK | DEF | MOV | Cost | Range | Notes |
|------|----|----|-----|-----|------|-------|-------|
| Hoplite | 10 | 3 | 2 | 2 | 5 | 1 | Land melee, benefits from Phalanx |
| Peltast | 8 | 2 | 1 | 3 | 4 | 2 | Land ranged, no counterattack at range |
| Trireme | 12 | 4 | 2 | 4 | 8 | 1 | Water only (requires Seafaring) |

### Terrain
| Terrain | Move Cost | Notes |
|---------|-----------|-------|
| Plains  | 1         | Standard |
| Forest  | 2         | Slows movement |
| Hills   | 2         | Slows movement |
| Water   | -         | Impassable for land units |

### Combat
- Attack deals: `attacker.attack - defender.defense` damage (minimum 1)
- Melee attacks: defender counterattacks for half damage (rounded down)
- Ranged attacks: no counterattack when attacking from range 2
- Units at 0 HP are eliminated
- Only melee units can capture cities

### Healing
- Units standing on a friendly city heal 2 HP at the start of each turn
- Cannot heal above maximum HP

### Economy
- Cities produce +2 Drachma per turn
- Train units by tapping your city
- Technologies cost 10 Drachma

### Technologies
| Tech | Cost | Effect |
|------|------|--------|
| Phalanx | 10 | +1 Defense for Hoplites |
| Seafaring | 10 | Unlock Triremes |
| Philosophy | 10 | +1 Drachma per city |

### Vision
- Units see 2 hexes
- Cities see 2 hexes
- Fog of war: undiscovered tiles are hidden; discovered tiles stay visible but enemy units only shown in vision range

## Seeded Maps

Use URL hash to set a seed for reproducible maps:
```
http://localhost:3000/#seed=myCustomSeed
```

## Development

```bash
npm run dev      # Start dev server
npm run build    # Build for production
npm test         # Run tests
npm run preview  # Preview production build
```

## Project Structure

```
src/
├── game/        # Core game logic (deterministic)
│   ├── types.ts    # Type definitions, hex utilities
│   ├── rng.ts      # Seeded random number generator
│   ├── mapgen.ts   # Procedural map generation
│   └── state.ts    # Game state, actions, rules
├── ui/          # Rendering and input
│   └── renderer.ts # Canvas 2D rendering
├── ai/          # AI opponent
│   └── opponent.ts # Simple greedy AI
└── main.ts      # Game initialization
```

## Tech Stack

- TypeScript
- Vite (build tool)
- HTML5 Canvas 2D
- Vitest (testing)
