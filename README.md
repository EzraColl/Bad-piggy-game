# Pig Rig 3D

A 3D physics building game in the spirit of Bad Piggies. Bolt wheels, engines, balloons,
propellers, soda rockets and TNT onto a grid, press **GO**, and get the pig across the finish
line in one piece (or at least the pig part).

Runs in any modern browser on a laptop. Nothing to install.

## Play it

**Easiest:** download [`PigRig3D.html`](PigRig3D.html) (click it, then the download button) and
double-click the file. Everything, including the physics engine, is inside that one file, so it
works offline.

**From the source code:**

```bash
npm install
npm run dev      # opens a local server with live reload
npm run build    # rebuilds PigRig3D.html
npm test         # drives every level's hint build to the finish without a browser
```

## What's in it

- **9 levels + a sandbox.** Meadow Run, Hog Leap (canyon jump), Balloon Mesa (float onto a
  cliff), Crate Crusher (smash through crate walls), Summit Climb (steep mountain road), Rocket
  Canyon, and three flying levels: Floating Island, Helicopter Peak (a rock spire you can only
  reach by helicopter) and Sky Islands (three islands, each higher than the last). Each has three
  stars: finish, grab the golden star, beat the clock.
- **Flying:** with propellers on, W/S give more or less power to climb or sink and A/D steer in
  the air, with a gentle stabiliser keeping the craft level. Point propellers up to build a
  helicopter.
- **9 parts:** wooden frame, steel frame, wheel (with real suspension), V8 engine, pig pilot,
  balloon, propeller, soda rocket and TNT. Propellers and rockets can point forward, up,
  backward or down.
- **Real physics** (Rapier). Parts snap off in big crashes, TNT blasts things apart and the
  vehicle splits into separate pieces that keep flying.
- **Quick building:** click or drag across the grid to lay down a whole row of parts, turn on
  **Mirror** to copy everything to the other side, and use **Inside boxes** to drop the pig,
  engine, TNT or thrusters inside a wooden or steel frame (the box protects what's inside).
- **Brackets:** rockets, engines, TNT, propellers and balloons are bolted to their neighbours
  with steel bars and bolt plates (or clamped into their box), so nothing floats.
- **Axles:** wheels bolt onto whatever box they touch. A wheel beside a box gets a straight axle;
  under or in front of one it hangs from a two-armed fork. Both move with the suspension.
- **Hint button** in every level that loads a build known to finish (the automated test drives
  each one to the flag).
- Synthesised sound: V8 rumble, propeller buzz, rocket roar, explosions, balloon pops, oinks.

## Graphics

- Physically based materials, a physically based sky (Rayleigh and Mie scattering with clouds)
  and image-based lighting generated from that sky.
- Sun shadows with soft filtering, ambient occlusion (GTAO), HDR bloom for fire and sparks, ACES
  filmic tone mapping.
- Live reflections: a cube camera follows your vehicle so chrome, paint and glass reflect the
  world around them.
- Procedural everything: textures, tens of thousands of wind-animated grass tufts, leafy trees
  that cast dappled shadows, rocks, dust, smoke and fire particles.
- Smooth motion: physics runs at 120 steps a second and every frame blends between steps, so
  movement glides on 60, 90, 120 and 144 Hz screens alike. Steering and throttle ease in and out.
- Aims for 40+ frames per second: the resolution trims itself on the fly when a scene gets heavy,
  and if that isn't enough the game steps its quality preset (Low, Medium, High, Ultra) down. Pick
  a preset yourself any time in **Graphics & sound** (turn on the frame counter there too).
- A soft, realistic sun: the sky is drawn at the same brightness it lights the world with, so
  looking towards the sun no longer floods the screen white.

### Ray tracing

Press **P** (or the **Ray-trace photo** button) to freeze the action and path-trace the scene
with [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer). That is real ray
tracing: light bounces up to five times, the sky lights everything, reflections and soft shadows
come out physically correct, and a camera lens adds depth of field focused on the pig. The image
starts grainy and gets cleaner the longer you leave it. Save it as a PNG when it looks good.

Normal gameplay uses rasterised rendering with the effects above, because path tracing a whole
game at 60 frames per second needs dedicated ray-tracing hardware that browsers can't use yet.

## Controls

| Building | |
| --- | --- |
| Click / drag on the grid | place parts (dragging paints a row) |
| Right-click | remove a part |
| Drag empty space / mouse wheel | look around / zoom |
| `Q` `E` | turn the view |
| `1`–`9` | pick a part |
| `I` | inside boxes: put the pig, engine or TNT inside a frame |
| `M` | mirror to the other side |
| `R` | turn rockets and propellers |
| `X` | eraser (drag to erase lots) |
| `Ctrl` + `Z` | undo |
| `Enter` | GO |

| Driving | |
| --- | --- |
| `W` `S` or arrows | forward / reverse (needs an engine) |
| `A` `D` | steer |
| `Shift` | brake |
| `Space` | fire soda rockets (hold) |
| `F` | propellers on / off |
| `W` `S` while flying | more or less propeller power (climb / sink) |
| `A` `D` while flying | steer in the air |
| `B` | pop a balloon |
| `T` | detonate TNT |
| `C` | chase camera or classic side view |
| `P` | ray-traced photo |
| `R` / `Esc` | restart / back to building |

## Project layout

```
src/game/      levels, terrain, physics world, contraption, simulation rules, builder, camera
src/render/    renderer and post-processing, sky, terrain, vegetation, part models, effects,
               path-traced photo mode
src/audio/     Web Audio synthesiser
src/ui/        menus and HUD
tools/         headless level tests, stress test, build packaging
```

## Credits

Built with [three.js](https://threejs.org), [Rapier](https://rapier.rs) and
[three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer). A fan-made game
inspired by Bad Piggies. Not affiliated with or endorsed by Rovio.
