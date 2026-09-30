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

- **6 levels + a sandbox.** Meadow Run, Hog Leap (canyon jump), Balloon Mesa (float onto a
  cliff), Crate Crusher (smash through crate walls), Summit Climb (steep mountain road) and
  Rocket Canyon. Each has three stars: finish, grab the golden star, beat the clock.
- **9 parts:** wooden frame, steel frame, wheel (with real suspension), V8 engine, pig pilot,
  balloon, propeller, soda rocket and TNT. Propellers and rockets can point forward, up,
  backward or down.
- **Real physics** (Rapier). Parts snap off in big crashes, TNT blasts things apart and the
  vehicle splits into separate pieces that keep flying.
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
- Quality presets (Low, Medium, High, Ultra). The game picks one from your graphics chip and
  steps down once if the first drive stutters. Change it any time in **Graphics & sound**.

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
| Click | place the selected part |
| Right-click | remove a part |
| Drag / mouse wheel | look around / zoom |
| `1`–`9` | pick a part |
| `R` | turn rockets and propellers |
| `E` | eraser |
| `Ctrl` + `Z` | undo |
| `Enter` | GO |

| Driving | |
| --- | --- |
| `W` `S` or arrows | forward / reverse (needs an engine) |
| `A` `D` | steer |
| `Shift` | brake |
| `Space` | fire soda rockets (hold) |
| `F` | propellers on / off |
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
