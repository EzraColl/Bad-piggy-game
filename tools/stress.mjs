// Stress test: blow up contraptions and smash them, checking the split/reattach logic never throws.
import RAPIER from '@dimforge/rapier3d-compat';
import { levelById } from '../src/game/levels.js';
import { Simulation } from '../src/game/simulation.js';
console.warn = () => {};
await RAPIER.init();
const level = levelById('sandbox');
const cells = [
  ['wheel', 1, 0, 1], ['wheel', 4, 0, 1], ['wheel', 1, 0, 3], ['wheel', 4, 0, 3],
  ['wood', 1, 0, 2], ['wood', 2, 0, 2], ['pig', 3, 0, 2], ['engine', 4, 0, 2],
  ['tnt', 2, 1, 2], ['wood', 3, 1, 2], ['balloon', 3, 2, 2], ['fan', 4, 1, 2, 1], ['rocket', 1, 1, 2, 0],
  ['metal', 5, 0, 2], ['wheel', 5, 0, 1], ['tnt', 6, 0, 2],
  // a box with TNT inside it and a box with the engine inside
  ['wood', 2, 1, 1], ['tnt', 2, 1, 1], ['wood', 4, 0, 1], ['engine', 4, 0, 1],
];
for (let run = 0; run < 3; run++) {
  const sim = new Simulation(RAPIER, level, { dims: level.grid, cells });
  const counts = {};
  sim.input.throttle = 1;
  sim.toggleFans();
  for (let f = 0; f < 60 * 12; f++) {
    if (f === 60 * (2 + run)) sim.detonate();
    if (f === 60 * 6) sim.popBalloon();
    sim.input.rocket = f > 60 && f < 200;
    sim.update(1 / 60);
    for (const e of sim.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    sim.events.length = 0;
  }
  const bodies = sim.car.bodies.size;
  const p = sim.car.pigPosition();
  console.log(`run ${run}: bodies=${bodies} pig=(${p.x.toFixed(1)},${p.y.toFixed(1)}) events=${JSON.stringify(counts)} alive=${sim.car.parts.filter((q) => q.alive).length}/${sim.car.parts.length}`);
  sim.dispose();
}
