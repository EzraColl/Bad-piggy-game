// Headless game rules: runs the physics, the player's contraption, explosions, stars and the finish.
// The renderer and UI only read from this and push input into it, so tools/simulate.mjs can
// run exactly the same game without a browser.

import { Vector3, Quaternion } from 'three';
import { createTerrain } from './terrain.js';
import { LevelPhysics } from './physics.js';
import { Contraption } from './contraption.js';
import { PARTS } from './parts.js';

const STEP = 1 / 120;
export const FINISH_HALF_WIDTH = 6.5;
const _v = new Vector3();

// Where the build grid's base sits: just above the highest ground under its footprint.
export function computeSpawn(terrain, level, dims) {
  const x = level.start;
  const z = terrain.center(x);
  let maxH = -Infinity;
  for (let dx = -dims[0] / 2 - 0.6; dx <= dims[0] / 2 + 0.6; dx += 0.5) {
    for (let dz = -dims[2] / 2 - 0.6; dz <= dims[2] / 2 + 0.6; dz += 0.5) {
      maxH = Math.max(maxH, terrain.height(x + dx, z + dz));
    }
  }
  return new Vector3(x, maxH + 0.42, z);
}

// Simple driver used by the title-screen demo and the level tests: aim at the road ahead.
export function autopilotSteer(sim) {
  const p = sim.car.pigPosition();
  const r = sim.car.pig.body.rb.rotation();
  const fx = 1 - 2 * (r.y * r.y + r.z * r.z);
  const fz = 2 * (r.x * r.z - r.w * r.y);
  const heading = Math.atan2(fz, fx);
  const ax = p.x + 10;
  const want = Math.atan2(sim.terrain.center(ax) - p.z, ax - p.x);
  let err = want - heading;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  return Math.max(-1, Math.min(1, err * 2.5));
}

// Replays a level's scripted key presses (see levels.js) with autopilot steering.
export class ScriptPilot {
  constructor(sim, script) {
    this.sim = sim;
    this.script = script ?? [{ t: 0, keys: ['forward'] }];
    this.fired = new Set();
    this.held = [];
  }

  update() {
    const sim = this.sim;
    const p = sim.car.pigPosition();
    this.script.forEach((s, i) => {
      if (this.fired.has(i)) return;
      if ((s.t !== undefined && sim.time >= s.t) || (s.x !== undefined && p.x >= s.x)) {
        this.fired.add(i);
        this.held = s.keys ?? this.held;
        if (this.held.includes('fan') !== sim.car.fansOn) sim.toggleFans();
        for (const a of s.press ?? []) {
          if (a === 'balloon') sim.popBalloon();
          if (a === 'tnt') sim.detonate();
        }
      }
    });
    const h = this.held;
    sim.input.throttle = h.includes('forward') ? 1 : h.includes('back') ? -1 : 0;
    sim.input.steer = autopilotSteer(sim);
    sim.input.rocket = h.includes('rocket');
    sim.input.brake = h.includes('brake');
  }
}

// Where the finish line is: on the road, or on top of a floating island / spire.
export function goalPoint(level, terrain) {
  const gx = level.goal;
  const gz = terrain.center(gx);
  const gy = level.goalLift !== undefined ? terrain.profile(gx) + level.goalLift : terrain.height(gx, gz);
  return new Vector3(gx, gy, gz);
}

export function finishHalfWidth(level) {
  return level.finishHalf ?? FINISH_HALF_WIDTH;
}

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
    this.goal = goalPoint(level, t);
    this.starPos = level.star ? new Vector3(level.star.x, t.profile(level.star.x) + level.star.lift, t.center(level.star.x)) : null;
    this.balloonCeilingY = t.profile(level.start) + (level.balloonCeiling ?? 32);

    this.spawn = computeSpawn(this.terrain, level, blueprint.dims);
    this.car = new Contraption(this.phys, blueprint, this.spawn, this.events);
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
      this._capturePoses();
      this._step(STEP);
      steps++;
    }
    // how far we are between the last two physics states, for smooth drawing
    this.alpha = this.accum / STEP;
    return steps;
  }

  // Remember where every body was before a step so the renderer can blend between steps.
  // Physics runs at 120 Hz while screens run at 60, 90, 120 or 144 Hz: without blending,
  // some frames get two steps and some one, which looks like stutter.
  _capturePoses() {
    if (!this.prevPoses) {
      this.prevPoses = new Map();
      this.poseStamp = 0;
    }
    this.poseStamp++;
    const stamp = this.poseStamp;
    const map = this.prevPoses;
    this.phys.world.forEachRigidBody((rb) => {
      let e = map.get(rb.handle);
      if (!e) {
        e = { p: new Vector3(), q: new Quaternion(), stamp: 0 };
        map.set(rb.handle, e);
      }
      const t = rb.translation();
      const r = rb.rotation();
      e.p.set(t.x, t.y, t.z);
      e.q.set(r.x, r.y, r.z, r.w);
      e.stamp = stamp;
    });
  }

  // Interpolated pose of a rigid body for drawing.
  pose(rb, outP, outQ) {
    const t = rb.translation();
    const r = rb.rotation();
    outP.set(t.x, t.y, t.z);
    outQ?.set(r.x, r.y, r.z, r.w);
    const e = this.prevPoses?.get(rb.handle);
    if (!e || e.stamp !== this.poseStamp || this.alpha === undefined) return;
    outP.lerpVectors(e.p, outP, this.alpha);
    if (outQ) outQ.slerpQuaternions(e.q, outQ, this.alpha);
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
      // up in the sky you have to actually come down to the flag, not just fly over it
      const sky = this.level.goalLift !== undefined;
      const above = sky ? 4.5 : 7;
      const past = sky ? pig.x - this.goal.x < 10 : true;
      if (pig.x >= this.goal.x && past && Math.abs(dz) < finishHalfWidth(this.level) && pig.y < this.goal.y + above && pig.y > this.goal.y - 2.5) {
        this.state = 'won';
        this.finishTime = this.time;
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
      time: won && lvl.timeLimit > 0 && this.finishTime <= lvl.timeLimit,
    };
  }

  dispose() {
    this.car.dispose();
    this.phys.dispose();
  }
}
