# Wonders — A Tiny Planet

An explorable planet built with [Three.js](https://threejs.org/) and [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh), inspired by [Messenger](https://messenger.abeto.co/) by Studio Abeto.

The sea has been rising for six generations. Walk a procedurally generated world, sail its oceans, meet the people still living on it, and piece together what happened — all toon-shaded, running in a browser tab.

![The opening screen](docs/screenshot-title.png)
*The world is fully built behind the title, so Begin drops you straight in — a white bloom covers the cut, then the camera descends onto your character.*

![A waterline settlement](docs/screenshot-world.png)
*Boardwalks, a salvage crane and a ladder tower at the waterline. Something is always coming over the horizon.*

![Talking to the people who stayed](docs/screenshot-story.png)
*Press E to talk. Every line is written to its speaker's age, their settlement, and how much of the story you have uncovered.*

![Sailing](docs/screenshot-boat.png)
*Step onto water and you board a boat automatically.*

![The camera](docs/screenshot-camera.png)
*Press F to raise a camera. Frame one of the seven wonders and it tells you what this world believes it was, against what your photograph actually shows.*

![The album](docs/screenshot-album.png)
*The planet is procedural and unseeded, so every page load is a place that has never existed and will not exist again. The album outlives them, and says which worlds are gone.*

## Features

**Story**
- The world is drowning, and elevation tells the story: ruins at the waterline the sea already took, stilt houses where the stubborn still bail every day, and the living retreated uphill. The premise, tone and cast are in [docs/STORY.md](docs/STORY.md).
- 1,775 written lines of dialogue and 217 environmental lore entries, each tagged with a voice (child, teen, adult, elder), a settlement band, and a story stage.
- **Five stages of revelation, gated by exploration** rather than by talking. Stage 0 is weather and work with no mention of the flood; stage 4 is what people do with an ending. The story deepens because you went somewhere.
- Children have never seen the water lower, so to them the flood is not a tragedy — it is simply the world. Adults deflect grief into logistics. Elders reveal enormous things while complaining about something trivial.
- The seven wonders are all misremembered, each in a revealing way: Giza as deliberate flood markers, the Great Wall as a failed dam whose breach pilgrims still search for, the Colosseum as a cistern where lions drank.
- NPCs murmur ambient lines as you pass (signed with their name, so you can go and find them) and give longer beats on `E`. Each remembers what they have already told you, and turns to face you while they talk; a marker floats over whoever `E` would talk to. Places can be examined too - settlements, caves, open water and all seven monuments - and each examine moves on to something you have not read yet, deepest first.
- **The story is said out loud as well as overheard.** Each stage opens with a chapter card, a line under the title always says what to do next, and from your second conversation on people will point you at the nearest monument you have not seen ("The flood markers at Giza. Ahead of you, off to the right. A good walk."), which is then ringed on the map. The chapters and the pointing lines are in `story/chapters.ts`.
- **Six unsent messages.** Somebody left things for somebody who never came to find them: a stone with a faded red ribbon at the water's edge, inside a cave, behind a monument, on high ground, out over a drowned settlement and at the far end of the world. Each is marked on the map with a rose "?" - bright until read, dim after - and has a rose glint floating over it until then. Walk up to one and it opens by itself; E reads it again. They are in `story/keepsakes.ts`.
- **Notes from the developer** are pinned to posts in out-of-the-way places - the highest peak, inside a cave, out over a drowned settlement, the far side of the world. Their text and where each goes are in `story/notes.ts`.

**World**
- Procedurally generated planet of radius 75 — a continent mask gives coherent landmasses with real coastlines, ridged multifractal noise builds mountain ranges, terraced bands form mesas, and inverted-ridge channels carve valleys to the sea. About 39% land, peaks near 33 units, a new world every page load.
- **Dense, not empty.** Roughly 35 settlements and 800+ placed objects mean only ~4% of land has nothing in view, against 60% before the density pass. Median walk to the nearest structure is 14 units, well inside the ~23-unit horizon.
- **Nothing stands inside anything else.** Every placement pass - monuments, buildings, walkways, landmarks, caves, flora - checks one shared list of claimed ground and adds to it. Before it, each pass only knew its own kind: per world, ~90 pairs of houses overlapped, ~115 crates sat inside walls, ~43 walkways ran into houses and a few houses stood inside monuments. Dry buildings are seated on the lowest ground under their footprint, so none hangs off a slope, and waterline docks point out to sea. `npm run placement` checks all of it.
- Settlements are placed by elevation band — drowned ruins, stilt clusters and rafts, shore shanties, upland yurts and terraces, mountain camps, cave dwellings — each with its own kit from 28 hand-modelled structures.
- 42 tall landmarks (lighthouses, drowned towers, silos, cranes, spires) scattered *between* settlements, so something is always rising over the horizon. Boardwalks and docks radiate from waterline settlements; vines claim only the buildings people have given up on.
- **Caves, as secrets.** A heightfield planet cannot grow a cave - one radius per direction means no overhang and no roof - so up to seven hollow rock outcrops are seated on flat, dry, remote ground instead. From outside each reads as a boulder on a hillside; walk round it and there is a mouth. Placement avoids every settlement and monument, and no two are within 30 units of each other.
- Each cave holds a different trace of the people who came before: a hearth with a live fire, ochre handprints at the height of a walking adult, a calendar of squares cut into the rock, a stone cairn, seed stores, a toolmaker's rack, a sleeping camp. All seven are written against dialogue that was already in the corpus before any cave existed.
- Coastlines are deliberately walkable: a wide shallow shelf means you can wade ashore without jumping, while mountains stay dramatic and climbable on foot.
- Seven wonder monuments placed on a spherical Fibonacci lattice, with a site search that scores ground for flatness and dryness, and a level terrace carved under each so flat-based buildings seat flush.
- Toon shading throughout — a shared 4-band gradient map, vertex colours, inverted-hull outlines, and **no textures anywhere** (the whole scene uses 2).

**Life and atmosphere**
- 455 trees, 385 bushes and 32,200 grass tufts, scattered by sampling the real terrain mesh after terracing.
- Plant size is skewed, not uniform: grass runs cubed so the median tuft is ankle height and only a few percent grow tall, and trees and bushes are scaled to a target WORLD height rather than by a shared multiplier, so a variant that happens to be twice as tall in its own file does not become a blob twice the player's height.
- **Vegetation thins where people are.** Ground cover drops to ~17% of normal inside a settlement and ~53% around a monument, so nothing grows through walls and the approach to a wonder stays open — but never bare earth.
- Grass blades taper, lean and vary in height, are tinted per instance across five greens, and dry toward straw near the waterline where the salt reaches.
- Wind as a vertex-shader injection into the existing toon material: per-instance flutter plus a slow travelling gust envelope, so gusts roll across the field. Zero per-frame CPU cost.
- Ocean waves — a swell with chop and turbulence on top, tuned so crests wash clean over the stilt houses at the waterline and leave the shore towns dry. Water is clear enough overhead to read a drowned settlement through, and seals up toward the horizon so you cannot see across the planet.
- Day cycle: the sun arcs from early morning through midday to afternoon and loops, never dipping below the horizon, with light, sky and fog all keyed to sun elevation. Currently pinned to a high sun (`PINNED_PHASE` in `render/daylight.ts`).
- Post-processing in a single fullscreen pass: anime diffusion glow, ACES tone mapping, colour grading, vignette, dither and sRGB conversion.

**The camera, and the album**
- Raise a camera with `F` and photograph the world. Four film stocks — Plate, Salt, Ink, Ochre — applied as a filter, vignette and grain on the captured frame, so they cost nothing until the shutter fires.
- **Photographs outlive the world.** The planet is procedural and unseeded, so every page load builds a place that has never existed and will not exist again. The album is stamped with a world number and kept in IndexedDB, so it is the only thing in the game with continuity — and the gallery says so, labelling every past world *gone*.
- Photograph one of the seven wonders and it tells you what it is: 21 stage-gated entries pairing what this world *believes* the monument was against what your photograph actually shows. The same monument says more the second time, once you have seen more of the world.
- The frame is grabbed inside the same task as the draw call, because `preserveDrawingBuffer` is off in a production build and one frame later the canvas is already blank.

**Sound**
- **Two musical beds, chosen by where you are.** Among people it is public-domain Chopin nocturnes — solo piano, domestic, unmistakably played by a person. Alone, at sea, or high up it thins to a flat CC0 ambient bed with almost no events in it. Both run continuously and only the gains cross, so walking into a village fades rather than restarting a track. 18 minutes in 6.8MB.
- The ambient beds were chosen by measurement, not by title: all 101 tracks in the source collection were screened on short-window RMS steadiness and hard-onset count, and the two flattest kept. Lofi was tried first and rejected for having a beat — measured at 17 onsets per 90 seconds, against 1 and 2 for the beds that shipped.
- Music is streamed rather than decoded — a five-minute nocturne decodes to ~26MB of float samples, and holding the set would cost most of a hundred megabytes of RAM for background music.
- **The sea is synthesised, not sampled.** Filtered brown noise driven by the simulation: the surf swells with the actual wave passing under your feet (the same wave function the water shader uses), the body opens from distant rumble to audible foam as you approach the waterline, and wind rises with altitude and with how fast you are moving. No bytes on disk, no loop seam, and it reacts to things a recording cannot.
- Step inside a cave and the whole mix — music included — drops through a lowpass, because there is rock over your head.
- **NPCs murmur when they speak.** Not recordings and not words: a short run of soft blips pitched to the speaker's age — a child at 520Hz, an elder at 215 — with the length taken from the actual line and a downward drift so it lands like a sentence. It suits a game where every line is already written down; an approximate murmur under your own reading is closer to overhearing than a voice actor would be.
- Nothing is fetched until you press Begin, and the audio context is unlocked inside that click, which is the only gesture a browser guarantees.

**Movement**
- An unhurried walk (3.8) with an optional sprint (6.8). At the old 5.4 a lap of the 471-unit circumference took 87 seconds, which made a planet feel like a courtyard; it now takes just over two minutes. Walk and run clips play at the rate the character is actually travelling, so the feet stay planted.
- Tangent-plane movement on the sphere with gravity, jumping, slope limits and step-up, substepped at 20 ms so sprinting cannot tunnel through terrain during a frame hitch.
- **Walls slide, they do not stick.** Only the part of your motion into a wall is removed, so walking at one on an angle carries you along it. Probes at knee and chest height: anything under a step's height (kerbs, stair risers, rocks) is walked up onto, rails and eaves still stop you.
- **Ground has a grade.** Walking uphill costs speed (about 40% straight up a 45-degree slope) and downhill gives a little back; ground too steep to stand on slides you down it instead of holding you there.
- **Forgiving jumps.** A jump still counts for 0.12s after running off an edge, a press up to 0.14s before landing fires on landing, and letting go early cuts the jump short - tap to hop, hold to clear something.
- **The boat is a boat.** Slow to get going, slow to turn, and it glides on when you let go; the hull pitches and rolls with the slope of the wave under it, and you rock with it.
- People are solid, and grass parts around your feet as you walk through it (in the vertex shader, one uniform a frame).
- **The body has width.** Collision used to be a line through the middle of the character, so shoulders went through door frames and tree trunks. Wall probes now run down each shoulder too, and a pass each frame pushes the body back out of anything it ended up overlapping. Tree trunks and fixtures (winches, bollards, crate stacks, rocks, signs) are solid; reeds and seaweed are walked through.
- **Loose things have mass.** Drums, jerrycans, buoys, stools, pots and the like are rigid bodies ([Rapier](https://rapier.rs/)): walk into one and it is shoved, rolls and settles, and at sea it floats. All of them start asleep and cost nothing until touched.
- **Fall far enough and she goes limp.** Past about a four-unit drop the character becomes a ragdoll - twelve bodies, ball joints at hips, shoulders and neck, hinges with real limits at knees, elbows and spine - carrying the speed she fell at. She tumbles down the slope she hit or floats if she went into the sea, then gets up where she came to rest, easing from that pose back into her walk. `npm run physics` checks all of the above against the real controller, the real physics world and the real character.
- Collision against the monuments' and buildings' real geometry — you can walk into the Colosseum and up Chichen Itza's steps, not bump an invisible box.
- Board a boat automatically on contact with water; it rides the actual wave surface rather than a flat sea.
- **Standing still means standing still.** The character keeps its facing when it stops, so the camera can be walked all the way round to their face. Previously an idle character faced the camera's forward vector, which meant orbiting swung them with it and their front was unreachable by construction.
- **The pointer does not steer the camera during play.** Walking does. The view holds a fixed pitch and eases in behind wherever you go, so it can never be dragged to the near-overhead shot that reads as a strategy game rather than as being there. Pointer look is a viewfinder privilege: raise the in-game camera with `F` and the drag aims freely, from just below level to a steep look-down, and walking will not pull your framing away while you compose.
- **Moving settles the view back over the shoulder**, slowly — the view eases in behind the direction of travel at about two seconds for a half-turn. The unhurried rate is the point: with no pointer look, walking back towards the camera is the only way to see the character's face, so the swing round behind them has to be a look rather than a flinch. Hold back and she turns and walks at you; let go and walk on and the shoulder shot returns.
- The body turns the whole way to face where it is going, with nothing capping it. A cap was tried, to stop a held strafe trailing the camera, and cost far more than it bought: back no longer turned her round, so she moonwalked, and it removed the last remaining way to see her face.
- The camera keeps clearance from the ground beneath wherever it lands, not just along the line back from the player — swinging round to the downhill side used to bury it 0.06 units above the terrain.
- Over-the-shoulder third-person camera that reorients to the local surface normal: close, near level, and slid sideways so the character sits low and off-centre and the frame is filled by what is ahead rather than by the ground underfoot.
- Minimap using an azimuthal projection, so the whole planet is always on screen and the antipode sits on the rim.

## Tech Stack

- [Vite](https://vitejs.dev/) — dev server & build tool
- [TypeScript](https://www.typescriptlang.org/) (strict)
- [Three.js](https://threejs.org/) — 3D rendering
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) — accelerated raycasting for terrain and collision
- [Rapier](https://rapier.rs/) (`@dimforge/rapier3d-compat`) — rigid bodies for the ragdoll and loose props. Loaded as its own chunk, alongside the models.

Three runtime dependencies. Everything else (glTF loading, geometry merging, surface sampling, post-processing) comes from `three/examples/jsm`. The character still walks on the hand-tuned raycast controller; Rapier is only what the world does back.

## Performance

Around 537k triangles and 620 draw calls per frame, holding 120fps on an Apple M5 against a 60fps target. The rules that keep it there:

- **Chunked culling.** Flora is split into 260 spatial cells so per-object frustum culling discards the ~98% of the planet beyond the horizon. The cell must be small *relative to the view*: at 96 cells the median cell radius was 12.6 units against a ~23-unit visible cap, and flora alone drew 1.1M triangles. Tightening the cells cut total draw by 72%.
- **Instancing.** Trees and bushes are baked to a single geometry with material colours folded into vertex colours, so a whole two-tone tree is one instanced draw. One species per cell, which also reads as groves rather than evenly mixed forest.
- Wind, waves and the day cycle are shader/uniform work — no per-frame CPU loops over instances.
- Skinned NPCs only have their animation stepped within 45 units; skinning is the real cost, not the triangles.
- **The far plane is cut to just past the fog in play** (96 against the title screen's 800). This is not a micro-optimisation: fog is fully opaque at 90, but a far plane sized for the title screen let a downward-tilted frustum run straight through the planet and submit the entire far side of the world — invisible behind terrain, fully drawn. Measured at a downward tilt: 1,359 draws and 741k triangles, against 208 and 248k level. With it fixed, looking down is *cheaper* than looking level, as it should be. The sky dome rides the camera at radius 88 so it still fits inside that far plane.
- No shadow maps; the player's shadow is a blob decal.
- No textures. The entire scene uses 2 (a toon gradient ramp and the blob shadow), so there is essentially no texture memory.

A production build is **38.5 MB**: 28.8 MB of models, 6.8 MB of music, 1.7 MB of world dressing, and ~700 KB of code and assets. Gzip barely touches it — 37.6 MB over the wire — because almost all of it is glTF and MP3, which are already compressed. The game's code is 220 KB gzipped, the physics engine another 762 KB (in its own chunk, fetched in parallel with the models), and the dialogue corpus 93 KB gzipped, so the bundle is not the problem and never will be: **the models are 75% of the build**, and the only lever that matters is decimating or Draco-compressing them.

(Measured as real bytes. `du` reports ~47 MB for the same directory because APFS allocates in blocks — worth knowing before optimising something that is already smaller than it looks.)

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

### Deploy to Vercel

Import the repository in Vercel and deploy - `vercel.json` sets everything: `npm ci`, `npm run build`, output in `dist/`. It is a static site with no server code and no environment variables.

`vercel.json` also sets caching: the hashed bundles in `assets/` are cached forever, and the models and music (about 40 MB, unhashed) for a day, revalidated in the background for a week, so a returning player does not download the world again. If you replace a model and need it live at once, rename the file.

### Smoke test

```bash
npm run dev          # in one terminal
npm run smoke        # in another
```

Headless Playwright check: dismisses the title, waits out the intro, then verifies the app renders (a grid of sampled pixels is lit), the player moves, and no console errors occur.

```bash
npm run placement    # with the dev server running; RUNS=5 for more worlds
npm run physics      # with the dev server running
npm run dialogue     # with the dev server running
```

`physics` drives the real movement controller against small known pieces of geometry - an angled wall, a low and a high step, a cliff, a ramp, a ledge, open water - and fails if walls stop sliding, steps stop being climbable, cliffs stop sliding you down, uphill stops costing speed, jumps lose their coyote time, buffer or tap-versus-hold height, the boat stops gliding, or you can walk through a person.

`dialogue` presses E over and over at every place, every monument and every kind of person at several story stages, and fails if a press ever shows the line already on screen, if a round skips a line, or if a newly unlocked stage is not heard first.

`placement` boots several fresh worlds and fails if any building overlaps another, if clutter, walkways or landmarks sit inside a building, if a building stands inside a monument, if a tree grows through a roof, or if dry buildings float off slopes.

Note that smoke runs under **software rendering** (`--use-angle=swiftshader`) for portability, so the `fps` it prints measures a CPU rasteriser and is *not* a performance signal. It is a boots / renders / moves / no-errors gate. Real performance is measured against a GPU separately.

## Project Structure

```
src/
  main.ts          # App entry: renderer, composer, scene, title/intro/play loop
  title.ts         # Opening screen, white bloom, descent handoff
  style.css        # Global styles, HUD, dialogue, title
  ui.ts            # HUD, minimap, wonder discovery
  touch.ts         # On-screen stick and buttons for phones and tablets
  photo.ts         # In-game camera, film stocks, IndexedDB album
  audio.ts         # Music, and synthesised sea / wind / cave muffle
  physics/
    world.ts       # Rapier world: gravity toward the core, buoyancy, loose props, the player's capsule
  player/
    input.ts       # Keyboard/pointer input
    ragdoll.ts     # The body going limp after a long fall, and its joints
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
  story/
    dialogue.ts    # Corpus loading, line selection, story stages
    interaction.ts # Proximity prompts, dialogue panel, ambient murmurs, chapter cards
    chapters.ts    # Chapter titles, the "what now" line, people pointing the way
    notes.ts       # The developer's notes: what they say and where they go
    keepsakes.ts   # The six unsent messages
  world/
    noise.ts       # Value noise, fbm, ridged multifractal
    planet.ts      # Terrain generation, colouring, terrace carving
    props.ts       # Instanced flora, chunked culling, clearings
    caves.ts       # Hollow rock outcrops, their contents and their collision
    dressing.ts    # Props, connectors, vines, vertical landmarks
    water.ts       # Ocean waves and depth-aware clarity
    assets.ts      # glTF loading, caching, toon material conversion
    wonders.ts     # Monument loading, placement, collision
    settlements.ts # Settlements, residents, speakers, landmarks
    boat.ts        # Boat model
    notes.ts       # Places the developer's notes and the keepsakes, well apart
scripts/
  smoke.mjs        # Headless smoke test
docs/
  STORY.md         # The story bible the dialogue is written against
plans.md           # Design for the favours (quest) system, not yet built
public/
  models/          # Wonders, characters, NPCs, structures, verticals, flora, camp props
  props/ connectors/ vines/    # World dressing
  story/corpus.json            # 1,775 dialogue lines + 217 lore entries
  audio/                       # Two piano + two ambient beds (everything else is synthesised)
```

## Controls

| Input | Action |
| --- | --- |
| `W` / `A` / `S` / `D` or arrow keys | Move |
| `Shift` | Run while held |
| `R` | Run toggle — stays running until pressed again |
| `Space` | Jump — hold for a full jump, tap for a hop |
| `E` | Talk to someone, or examine a place |
| `C` | Swap character model (remembered between visits) |
| `F` | Raise / lower the camera — drag aims, click or `Enter` shoots, `Tab` changes film |
| `G` | Open the album — open a photo to save it as a JPEG |
| `Esc` | Back out: close the photo, then the album, then lower the camera |
| `M` | Sound on / off |
| `H` | Show / hide the key list (it folds itself away once you have walked a while) |

On a phone or tablet the controls appear on screen: put a thumb anywhere on the left half to walk (however far you push, it walks; the » button above jump toggles running), tap the "Talk to …" prompt to talk and the open line to hear the next one, and use the buttons bottom-right to jump, raise the camera, open the album, swap character and toggle sound. With the camera up, drag to aim and tap to shoot. Portrait works too; the field of view widens so it is not a slot.

Walk into water and you board the boat automatically; step back onto land and you leave it.

## Tuning

Most of the feel lives in a few named constants:

| Constant | File | Controls |
| --- | --- | --- |
| `PLANET_RADIUS`, `WATER_Y` | `world/planet.ts` | World size and sea level |
| `MTN_AMP`, `MTN_FREQ`, `SHELF`, `PLAIN_H` | `world/planet.ts` | Mountain drama and how walkable the coast is |
| `SWELL`, `CHOP`, `TURB` | `world/water.ts` | Sea roughness |
| `NEAR_ALPHA`, `OPAQUE_AT`, `CLEAR_TO` | `world/water.ts` | How far you can see into the water |
| `TREE_COUNT`, `BUSH_COUNT`, `GRASS_COUNT`, `CHUNKS` | `world/props.ts` | Foliage density and culling granularity |
| `SETTLEMENT_SLOTS`, `MAX_RESIDENTS`, `ANIM_RANGE` | `world/settlements.ts` | How populated the world feels |
| `FOOTPRINT`, `MAX_BUILD_RELIEF`, `BUILD_TRIES` | `world/settlements.ts` | How tightly buildings pack, and how steep a slope they will stand on |
| `STICK_DEAD`, `STICK_FULL` | `player/controller.ts` | Touch stick dead zone, and how far to push it for full speed |
| `BODY_R` | `player/controller.ts` | How wide the body is for collision |
| `RAGDOLL_FALL` | `main.ts` | How fast a fall has to be before she goes limp |
| `PARTS`, `JOINTS` | `player/ragdoll.ts` | Ragdoll body sizes, and how far each joint bends |
| `LOOSE`, `WALK_THROUGH` | `world/settlements.ts` | Which clutter can be knocked about, and which is walked through |
| `PINNED_PHASE`, `DAY_SECONDS` | `render/daylight.ts` | Pin the sun, or run the day cycle |
| `GRADE`, `GLOW`, `VIGNETTE`, `DITHER` | `render/grade.ts` | Post-processing look |
| `WALK`, `RUN`, `JUMP`, `GRAVITY` | `player/controller.ts` | Movement feel |
| `UPHILL_DRAG`, `SLIDE`, `COYOTE`, `JUMP_BUFFER`, `JUMP_CUT` | `player/controller.ts` | How slopes and jumps feel |
| `BOAT`, `BOAT_ACCEL`, `BOAT_BRAKE` | `player/controller.ts` | How the boat handles |
| `CHAPTERS`, `LEADS` | `story/chapters.ts` | The chapter cards, and how people point the way |
| `DEV_NOTES` | `story/notes.ts` | The developer's notes |
| `KEEPSAKES`, `KEEPSAKE_TITLE` | `story/keepsakes.ts` | The six unsent messages, and where each one goes |
| `APART` | `world/notes.ts` | How far apart notes and keepsakes are kept |
| `VOICES`, `VOICE_GAIN` | `audio.ts` | Pitch and cadence of each age's murmur |
| `DIST`, `LOOK_HEIGHT`, `SHOULDER` | `player/camera.ts` | How close and how over-the-shoulder the camera sits |
| `RECENTRE_RATE`, `PLAY_PITCH` | `player/camera.ts` | How fast the view settles behind you, and the angle it holds |
| `PITCH_MIN`, `PITCH_MAX` | `player/camera.ts` | How far up and down the view tilts |
| `FAR_PLAY`, `FAR_TITLE` | `main.ts` | View distance in play vs on the title screen |
| `FILMS`, `MAX_PHOTOS` | `photo.ts` | Film stocks and album size |
| `BEDS`, `MUSIC_GAIN`, `SEA_EARSHOT` | `audio.ts` | Which music plays where, and how loud the sea is |

## Credits

- Music: Chopin nocturnes performed by Luke Faulkner and Xuan He — **public domain recordings** via [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:Nocturnes_(Chopin)); ambient beds from **[John Bartmann's Straylight Drones Collection](https://freemusicarchive.org/music/John_Bartmann/100-ambient-atmospheric-soundtracks-straylight-drones-collection)** — CC0 1.0, no attribution required. See `public/audio/LICENSE.txt`.
- Model licences and sources are recorded next to the assets themselves, in `LICENSE.txt` under each of `public/models/`, `public/models/camp/`, `public/models/flora/` and `public/models/special/`. Those files ship with the build.

## License

No license specified. All rights reserved.
