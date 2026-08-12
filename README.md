# Wonders — A Tiny Planet

This is a **basic scaffolding** repo — a starting point for an explorable tiny planet built with [Three.js](https://threejs.org/) and [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh). Wander across a small procedurally generated world with toon-shaded terrain, water, a day sky, and a follow camera rig. Use this as a base to build your own project on top of.

## Features

- Procedurally generated planet surface with height-based terrain sampling
- Toon (gradient) shading via a custom gradient map
- Water plane, ambient/hemisphere + directional sun lighting
- Third-person camera rig with mouse/pointer look controls
- Player controller with gravity, ground snapping, and movement

## Tech Stack

- [Vite](https://vitejs.dev/) — dev server & build tool
- [TypeScript](https://www.typescriptlang.org/)
- [Three.js](https://threejs.org/) — 3D rendering
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) — accelerated raycasting for terrain

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or newer
- npm (bundled with Node.js)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Pritha1610/Small-Atlas.git
cd Small-Atlas

# 2. Install dependencies
npm install
```

### Run the dev server

```bash
npm run dev
```

Open the local URL printed in your terminal (usually `http://localhost:5173`).

### Build for production

```bash
npm run build
```

The production build is emitted to `dist/`. Preview it locally with:

```bash
npm run preview
```

### Smoke test

```bash
npm run smoke
```

Runs a headless Playwright smoke check against the built app.

## Project Structure

```
src/
  main.ts          # App entry: renderer, scene, game loop
  style.css        # Global styles & HUD styling
  ui.ts            # HUD creation
  player/
    input.ts       # Keyboard/pointer input handling
    controller.ts  # Movement, gravity, ground collision
    player.ts      # Player model/animation
    camera.ts      # Third-person camera rig
  render/
    sky.ts         # Sky dome + fog setup
    toon.ts        # Toon gradient map
    blobShadow.ts  # Soft blob shadow under the player
  world/
    noise.ts       # Noise generation
    planet.ts      # Planet geometry, terrain height sampling
    props.ts       # Scatter props (trees, rocks, etc.)
    water.ts       # Water plane
scripts/
  smoke.mjs        # Headless smoke test
```

## Controls

| Input | Action |
| --- | --- |
| `W` / `A` / `S` / `D` | Move forward / left / back / right |
| Mouse / pointer drag | Look around |
| `Shift` | Run |
| `Space` | Jump |

## License

No license specified. All rights reserved.
