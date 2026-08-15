# Wonders — A Tiny Planet

An explorable tiny planet built with [Three.js](https://threejs.org/) and [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh), inspired by [Messenger](https://messenger.abeto.co/) by Studio Abeto. Walk the surface of a small procedurally generated world, sail its oceans, and find the seven wonders scattered across it — all toon-shaded, running in a browser tab.

![Exploring the world](docs/screenshot-world.png)
*Chichen Itza on a terraced hilltop — instanced grass and trees with wind, the player-centred minimap, and the day cycle low in the sky.*

![Sailing](docs/screenshot-boat.png)
*Step onto water and you board a boat automatically.*

## Features

**World**
- Procedurally generated planet — a continent mask gives coherent landmasses with real coastlines, ridged multifractal noise builds continuous mountain ranges, terraced bands form mesas, and inverted-ridge channels carve valleys down to the sea. Roughly 35% land across five landmasses, every page load a new world.
- Seven wonder monuments (`.glb`) placed on a spherical Fibonacci lattice, with a site search that scores candidate ground for flatness and dryness before committing.
- Level terraces are carved under each monument so flat-based buildings seat flush against curved, noisy terrain.
- Toon shading throughout — a shared 4-band gradient map, vertex colours, inverted-hull outlines, no textures anywhere.

**Life and atmosphere**
- 14,000 instanced grass tufts and 320 trees, scattered by sampling the real terrain mesh after terracing.
- Wind as a vertex-shader injection into the existing toon material: per-instance flutter plus a slow travelling gust envelope, so gusts roll across the field. Zero per-frame CPU cost.
- Day cycle — the sun arcs from early morning through midday to afternoon and loops, never dipping below the horizon. Light colour, intensity, sky gradient and fog all key off sun elevation.
- Post-processing in a single fullscreen pass: anime diffusion glow, ACES tone mapping, colour grading, vignette, dither and sRGB conversion.

**Movement**
- Tangent-plane movement on the sphere, with gravity, jumping, slope limits and step-up.
- Collision against the monuments' real geometry — you can walk into the Colosseum and up Chichen Itza's steps, not bump an invisible box.
- Board a boat automatically on contact with water.
- Third-person orbit camera that reorients to the local surface normal.
- Swappable character models (`C`).
- Minimap using an azimuthal projection, so the whole planet is always on screen and the antipode sits on the rim. Wonders fill in as you find them.

## Tech Stack

- [Vite](https://vitejs.dev/) — dev server & build tool
- [TypeScript](https://www.typescriptlang.org/) (strict)
- [Three.js](https://threejs.org/) — 3D rendering
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) — accelerated raycasting for terrain and monument collision

Only two runtime dependencies. Everything else (glTF loading, geometry merging, surface sampling, post-processing) comes from `three/examples/jsm`.

## Performance

Roughly 250k triangles and ~20 draw calls, holding 120fps on an Apple M5 (target is 60). Design rules that keep it there:

- Wind and the day cycle are shader/uniform work — no per-frame CPU loops over instances.
- Grass and trees are instanced: three draw calls for ~14,000 objects.
- Monuments stay separate scene objects so per-object frustum culling still applies.
- No shadow maps; the player's shadow is a blob decal.
- Physics is substepped at 20ms so sprinting can't tunnel through terrain during a frame hitch.

A production build is ~2 MB gzipped on first load (191 KB JS, the rest models).

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or newer
- npm (bundled with Node.js)

### Installation

```bash
git clone https://github.com/Pritha1610/Small-Atlas.git
cd Small-Atlas
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
npm run preview
```

The production build is emitted to `dist/`.

### Smoke test

```bash
npm run dev          # in one terminal
npm run smoke        # in another
```

Headless Playwright check: verifies the app boots, renders (a grid of sampled pixels is lit), the player moves, and no console errors occur.

## Project Structure

```
src/
  main.ts          # App entry: renderer, composer, scene, game loop
  style.css        # Global styles & HUD styling
  ui.ts            # HUD, minimap, wonder discovery
  player/
    input.ts       # Keyboard/pointer input
    controller.ts  # Spherical movement, gravity, ground & wall collision
    player.ts      # Character model, animation, swappable skins
    camera.ts      # Third-person camera rig
  render/
    sky.ts         # Sky dome shader
    toon.ts        # Shared toon gradient map + outline helper
    blobShadow.ts  # Soft blob shadow under the player
    wind.ts        # Vertex-shader wind injection
    grade.ts       # Post-processing: glow, tone map, colour grade, vignette
    daylight.ts    # Day cycle: sun arc, light and sky palette
  world/
    noise.ts       # Value noise, fbm, ridged multifractal
    planet.ts      # Terrain generation, colouring, terrace carving
    props.ts       # Instanced grass and trees
    water.ts       # Water sphere
    assets.ts      # glTF loading, caching, toon material conversion
    wonders.ts     # Monument loading, placement, collision
    boat.ts        # Boat model
scripts/
  smoke.mjs        # Headless smoke test
public/models/     # .glb assets
```

## Controls

| Input | Action |
| --- | --- |
| `W` / `A` / `S` / `D` | Move |
| Mouse / pointer drag | Look around |
| `Shift` | Run |
| `Space` | Jump |
| `C` | Swap character model |

Walk into water and you board the boat automatically; step back onto land and you leave it.

## Tuning

Most of the feel lives in a few named constants:

| Constant | File | Controls |
| --- | --- | --- |
| `DAY_SECONDS` | `render/daylight.ts` | Length of one full day cycle |
| `GRADE`, `GLOW`, `VIGNETTE`, `DITHER` | `render/grade.ts` | Post-processing look |
| `GRASS_COUNT`, `TREE_COUNT` | `world/props.ts` | Foliage density |
| `MSAA_SAMPLES` | `main.ts` | Antialiasing quality vs cost |
| `WALK`, `RUN`, `JUMP`, `GRAVITY` | `player/controller.ts` | Movement feel |
| `MIN_HEIGHT`, `MAX_HEIGHT`, `MAX_FOOTPRINT` | `world/wonders.ts` | Monument scale |

## Credits

- Boat model: "Sail Boat" by [Quaternius](https://quaternius.com) — CC0 1.0 (public domain), via [Poly Pizza](https://poly.pizza/m/BgSZXwmm7k).
- Wonder monuments and character models authored in Blender.

## License

No license specified. All rights reserved.
