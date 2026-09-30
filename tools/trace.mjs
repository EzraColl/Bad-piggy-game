// Prints the pig's path at 0.1 s resolution between two x positions (for placing stars).
import RAPIER from '@dimforge/rapier3d-compat';
import { levelById } from '../src/game/levels.js';
import { Simulation, ScriptPilot } from '../src/game/simulation.js';
const [id, x0, x1] = process.argv.slice(2);
console.warn = () => {};
await RAPIER.init();
const level = levelById(id);
const sim = new Simulation(RAPIER, level, { dims: level.grid, cells: level.solution });
const pilot = new ScriptPilot(sim, level.script);
while (sim.time < 40 && sim.state === 'running') {
  const p = sim.car.pigPosition();
  pilot.update();
  sim.update(1 / 60);
  sim.events.length = 0;
  if (p.x >= +x0 && p.x <= +x1 && Math.round(sim.time * 60) % 6 === 0) console.log(`t=${sim.time.toFixed(1)} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} profile=${sim.terrain.profile(p.x).toFixed(1)}`);
}
