// Prints the pig's path at 0.1 s resolution between two x positions (for placing stars).
import RAPIER from '@dimforge/rapier3d-compat';
import { levelById } from '../src/game/levels.js';
import { Simulation } from '../src/game/simulation.js';
const [id, x0, x1] = process.argv.slice(2);
console.warn = () => {};
await RAPIER.init();
const level = levelById(id);
const sim = new Simulation(RAPIER, level, { dims: level.grid, cells: level.solution });
let held = [];
const fired = new Set();
while (sim.time < 40 && sim.state === 'running') {
  const p = sim.car.pigPosition();
  level.script.forEach((s, i) => {
    if (fired.has(i)) return;
    if ((s.t !== undefined && sim.time >= s.t) || (s.x !== undefined && p.x >= s.x)) {
      fired.add(i); held = s.keys ?? held;
      if (held.includes('fan') !== sim.car.fansOn) sim.toggleFans();
      for (const a of s.press ?? []) if (a === 'balloon') sim.popBalloon();
    }
  });
  sim.input.throttle = held.includes('forward') ? 1 : 0;
  sim.input.rocket = held.includes('rocket');
  sim.update(1 / 60);
  sim.events.length = 0;
  if (p.x >= +x0 && p.x <= +x1 && Math.round(sim.time * 60) % 6 === 0) console.log(`t=${sim.time.toFixed(1)} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} profile=${sim.terrain.profile(p.x).toFixed(1)}`);
}
