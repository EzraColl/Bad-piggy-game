// Runs each level's hint build through the real game physics without a browser and reports
// whether the pig reaches the flag. Usage: node tools/simulate.mjs [levelId] [--verbose]

import RAPIER from '@dimforge/rapier3d-compat';
import { LEVELS } from '../src/game/levels.js';
import { Simulation, ScriptPilot } from '../src/game/simulation.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.find((a) => !a.startsWith('--'));

const origWarn = console.warn;
console.warn = (...a) => (String(a[0]).includes('deprecated') ? null : origWarn(...a));
await RAPIER.init();

function run(level) {
  const sim = new Simulation(RAPIER, level, { dims: level.grid, cells: level.solution });
  const pilot = new ScriptPilot(sim, level.script);
  const counts = {};
  let lastLog = -1;
  const maxTime = 60;
  while (sim.time < maxTime && sim.state === 'running') {
    pilot.update();
    sim.update(1 / 60);
    for (const e of sim.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    if (verbose) for (const e of sim.events) if (['break', 'destroy', 'star', 'explosion', 'impact'].includes(e.type)) console.log(`   ${sim.time.toFixed(2)}s ${e.type} ${e.part?.type ?? ''} ${e.force ? Math.round(e.force) + 'N' : ''}`);
    sim.events.length = 0;
    if (verbose && Math.floor(sim.time) !== lastLog) {
      lastLog = Math.floor(sim.time);
      const q = sim.car.pigPosition();
      console.log(`   t=${sim.time.toFixed(1)} pig=(${q.x.toFixed(1)}, ${q.y.toFixed(1)}, ${q.z.toFixed(1)}) road=${sim.terrain.center(q.x).toFixed(1)} speed=${sim.car.speed().toFixed(1)} m/s`);
    }
  }
  const stars = sim.stars();
  const q = sim.car.pigPosition();
  const ok = level.sandbox ? sim.state !== 'failed' : sim.state === 'won';
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${level.id.padEnd(8)} state=${sim.state.padEnd(7)} time=${sim.time.toFixed(1)}s (limit ${level.timeLimit}s) ` +
      `stars=${[stars.finish, stars.star, stars.time].map((s) => (s ? '*' : '.')).join('')} topSpeed=${sim.maxSpeed.toFixed(1)}m/s ` +
      `pig=(${q.x.toFixed(1)}, ${q.y.toFixed(1)}) events=${JSON.stringify(counts)}`,
  );
  sim.dispose();
  return ok;
}

let failures = 0;
for (const level of LEVELS) {
  if (only && level.id !== only) continue;
  if (!run(level)) failures++;
}
process.exit(failures ? 1 : 0);
