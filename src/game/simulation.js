// Headless game rules: runs the physics, the player's contraption, explosions, stars and the finish.
// The renderer and UI only read from this and push input into it, so tools/simulate.mjs can
// run exactly the same game without a browser.

import { Vector3 } from 'three';
import { createTerrain } from './terrain.js';
import { LevelPhysics } from './physics.js';
import { Contraption } from './contraption.js';
import { PARTS } from './parts.js';

const STEP = 1 / 120;
export const FINISH_HALF_WIDTH = 6.5;
const _v = new Vector3();

export class Simulation {
  constructor(RAPIER, level, blueprint, terrain = null) {
    this.R = RAPIER;
    this.level = level;
    this.terrain = terrain ?? createTerrain(level);
    this.phys = new LevelPhysics(RAPIER, level, this.terrain);
    this.events = [];
    this.time = 0;
    this.state = 'running';
    this.starCollected = false;
    this.accum = 0;
    this.pending = [];
    this.input = { throttle: 0, steer: 0, brake: false, rocket: false };
    this.maxSpeed = 0;

    const t = this.terrain;
    const gx = level.goal;
    const gz = t.center(gx);
    this.goal = new Vector3(gx, t.height(gx, gz), gz);
    this.starPos = level.star ? new Vector3(level.star.x, t.profile(level.star.x) + level.star.lift, t.center(level.star.x)) : null;
    this.balloonCeilingY = t.profile(level.start) + (level.balloonCeiling ?? 32);

    this.spawn = this.computeSpawn(blueprint.dims);
    this.car = new Contraption(this.phys, blueprint, this.spawn, this.events);
  }

  computeSpawn(dims) {
    const t = this.terrain;
    const x = this.level.start;
    const z = t.center(x);
    let maxH = -Infinity;
    for (let dx = -dims[0] / 2 - 0.6; dx <= dims[0] / 2 + 0.6; dx += 0.5) {
      for (let dz = -dims[2] / 2 - 0.6; dz <= dims[2] / 2 + 0.6; dz += 0.5) {
        maxH = Math.max(maxH, t.height(x + dx, z + dz));
      }
    }
    return new Vector3(x, maxH + 0.42, z);
  }

  // ---------------------------------------------------------------- player commands

  toggleFans() {
    const ok = this.car.toggleFans();
    if (ok) this.events.push({ type: this.car.fansOn ? 'fansOn' : 'fansOff' });
    return ok;
  }

  popBalloon() {
    return this.car.popBalloon();
  }

  detonate() {
    const tnts = this.car.alive('tnt');
    tnts.forEach((p, i) => this.pending.push({ at: this.time + i * 0.07, part: p }));
    return tnts.length > 0;
  }

  // ---------------------------------------------------------------- stepping

  update(frameDt) {
    this.accum = Math.min(this.accum + frameDt, STEP * 10);
    let steps = 0;
    while (this.accum >= STEP) {
      this.accum -= STEP;
      this._step(STEP);
      steps++;
    }
    return steps;
  }

  _step(dt) {
    const car = this.car;
    car.step(dt, this.input, { balloonCeilingY: this.balloonCeilingY });
    this.phys.world.step(this.phys.eventQueue);
    this.time += dt;

    // collect first, then react: the world must not be changed while Rapier drains its queue
    const hits = [];
    this.phys.eventQueue.drainContactForceEvents((ev) => {
      hits.push([ev.collider1(), ev.collider2(), ev.maxForceMagnitude()]);
    });
    for (const [h1, h2, force] of hits) {
      for (const h of [h1, h2]) {
        const part = car.colliderPart.get(h);
        if (part && part.alive && this.time > 0.6) {
          if (force > car.breakThreshold(part)) {
            if (part.type === 'tnt') {
              if (!this.pending.some((e) => e.part === part)) this.pending.push({ at: this.time, part });
            } else {
              car.breakPart(part, force);
            }
          }
        }
        const prop = this.phys.propByCollider.get(h);
        if (prop && prop.alive && prop.explosive && force > 2600) {
          if (!this.pending.some((e) => e.prop === prop)) this.pending.push({ at: this.time + 0.05, prop });
        }
      }
      if (force > 3000) {
        const p = car.colliderPart.get(h1) ?? car.colliderPart.get(h2);
        if (p && p.alive) this.events.push({ type: 'impact', force, pos: car.partWorldPosition(p) });
      }
    }

    // explosions that are due
    if (this.pending.length) {
      const due = this.pending.filter((e) => e.at <= this.time);
      this.pending = this.pending.filter((e) => e.at > this.time);
      for (const e of due) {
        if (e.part && e.part.alive) {
          const pos = car.partWorldPosition(e.part);
          car.destroyPart(e.part);
          this.explode(pos, 1);
        } else if (e.prop && e.prop.alive) {
          const t = e.prop.body.translation();
          this.phys.removeProp(e.prop);
          this.explode(new Vector3(t.x, t.y, t.z), 1.1);
        }
      }
    }

    this._rules();
  }

  explode(pos, power) {
    const car = this.car;
    const R = 5.5 * power;
    this.events.push({ type: 'explosion', pos: pos.clone(), power });
    // parts close to the blast
    for (const p of car.parts) {
      if (!p.alive) continue;
      const d = car.partWorldPosition(p, _v).distanceTo(pos);
      if (d > 1.7) continue;
      if (p.type === 'tnt') {
        if (!this.pending.some((e) => e.part === p)) this.pending.push({ at: this.time + 0.09, part: p });
      } else if (p.type === 'pig') {
        continue;
      } else if (PARTS[p.type].strength <= 1.5) {
        car.destroyPart(p);
      } else {
        car.breakPart(p);
      }
    }
    // props close to the blast
    for (const prop of this.phys.props) {
      if (!prop.alive || !prop.body) continue;
      const t = prop.body.translation();
      const d = Math.hypot(t.x - pos.x, t.y - pos.y, t.z - pos.z);
      if (prop.explosive && d < 3.6) {
        if (!this.pending.some((e) => e.prop === prop)) this.pending.push({ at: this.time + 0.1 + Math.random() * 0.08, prop });
      } else if (prop.kind === 'crate' && d < 1.6) {
        this.events.push({ type: 'splinter', pos: new Vector3(t.x, t.y, t.z), prop });
        this.phys.removeProp(prop);
      }
    }
    // shock wave
    this.phys.world.forEachRigidBody((rb) => {
      if (!rb.isDynamic()) return;
      const c = rb.worldCom();
      const dx = c.x - pos.x;
      const dy = c.y - pos.y;
      const dz = c.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > R) return;
      const fall = 1 - d / R;
      const inv = 1 / Math.max(d, 0.3);
      const m = Math.min(rb.mass(), 90);
      const k = fall * m * 13 * power;
      rb.applyImpulse({ x: dx * inv * k, y: (dy * inv + 0.45) * k, z: dz * inv * k }, true);
      const s = fall * m * 1.5;
      rb.applyTorqueImpulse({ x: (Math.random() - 0.5) * s, y: (Math.random() - 0.5) * s, z: (Math.random() - 0.5) * s }, true);
    });
  }

  _rules() {
    if (this.state !== 'running') return;
    const pig = this.car.pigPosition(_v);
    this.maxSpeed = Math.max(this.maxSpeed, this.car.speed());

    if (this.starPos && !this.starCollected) {
      for (const p of this.car.parts) {
        if (!p.alive) continue;
        const pos = this.car.partWorldPosition(p);
        if (pos.distanceTo(this.starPos) < 2.1) {
          this.starCollected = true;
          this.events.push({ type: 'star', pos: this.starPos.clone() });
          break;
        }
      }
    }

    if (!this.level.sandbox) {
      // the finish is a line across the road: cross it anywhere between the flag poles
      const dz = pig.z - this.goal.z;
      if (pig.x >= this.goal.x && Math.abs(dz) < FINISH_HALF_WIDTH && pig.y < this.goal.y + 7 && pig.y > this.goal.y - 2.5) {
        this.state = 'won';
        this.events.push({ type: 'win', time: this.time });
        return;
      }
    }

    if (pig.y < this.terrain.killY(pig.x)) {
      this.state = 'failed';
      this.events.push({ type: 'fail', reason: 'fell' });
    }
  }

  // Stars earned so far if the level ended now.
  stars() {
    const won = this.state === 'won';
    const lvl = this.level;
    return {
      finish: won,
      star: this.starCollected,
      time: won && lvl.timeLimit > 0 && this.time <= lvl.timeLimit,
    };
  }

  dispose() {
    this.car.dispose();
    this.phys.dispose();
  }
}
