// The player's vehicle at run time.
//
// Every group of touching parts is one compound rigid body (stable and fast). Wheels are separate
// bodies hung from the chassis on a sprung prismatic joint (suspension) plus a revolute joint (axle).
// When parts break off or get blown up, the chassis is split into new bodies along the gaps.

import { Vector3, Quaternion } from 'three';
import { PARTS, DIRS, WHEEL_RADIUS, WHEEL_HALF_WIDTH, WHEEL_DROP, cellLocal, cellKey, isStructural } from './parts.js';
import { G, groups } from './physics.js';

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q1 = new Quaternion();
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const Y_AXIS = new Vector3(0, 1, 0);
const WHEEL_ROT = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }; // Rapier cylinders point along Y

const NEIGHBOURS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];

export const ENGINE = {
  torquePerWheel: 34, // N·m for one engine, scaled by engines^0.8
  baseSpeed: 25, // rad/s wheel speed limit with one engine
  speedPerEngine: 8,
  steerMix: 0.85,
  yawRate: 1.7,
  yawGain: 5,
};

function toV(v) {
  return { x: v.x, y: v.y, z: v.z };
}

export class Contraption {
  constructor(phys, blueprint, spawn, events) {
    this.phys = phys;
    this.R = phys.R;
    this.world = phys.world;
    this.events = events;
    this.dims = blueprint.dims;
    this.spawn = new Vector3(spawn.x, spawn.y, spawn.z);
    this.spawnQuat = new Quaternion();
    this.parts = [];
    this.bodies = new Set();
    this.colliderPart = new Map();
    this.fansOn = false;
    this.pig = null;
    this.nextId = 1;

    for (const [type, i, j, k, dir = 0] of blueprint.cells) {
      if (!PARTS[type]) continue;
      const l = cellLocal(this.dims, i, j, k);
      const part = {
        id: this.nextId++,
        type,
        cell: [i, j, k],
        key: cellKey(i, j, k),
        dir,
        local: new Vector3(l[0], l[1], l[2]),
        localQuat: new Quaternion().setFromUnitVectors(X_AXIS, new Vector3(...DIRS[dir].v)),
        alive: true,
        broken: false,
        body: null,
        collider: null,
        fuel: PARTS[type].fuel ?? 0,
        popped: false,
        firing: false,
        spin: 0,
        throttle: 0,
      };
      if (type === 'pig') this.pig = part;
      this.parts.push(part);
    }
    this.byKey = new Map(this.parts.map((p) => [p.key, p]));

    // 1. structural parts -> compound bodies
    const structural = this.parts.filter((p) => isStructural(p.type));
    for (const comp of this._components(structural)) {
      const rec = this._createBody(this.spawn, this.spawnQuat, null, null);
      for (const p of comp) this._attachCollider(p, rec);
    }

    // 2. wheels
    this.wheels = this.parts.filter((p) => p.type === 'wheel');
    for (const w of this.wheels) this._createWheel(w);
    for (const w of this.wheels) this._attachWheel(w, this._findWheelParent(w));
    this._tuneSuspension();
  }

  // ---------------------------------------------------------------- building helpers

  _components(parts) {
    const set = new Set(parts);
    const seen = new Set();
    const comps = [];
    for (const start of parts) {
      if (seen.has(start)) continue;
      const comp = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const p = stack.pop();
        comp.push(p);
        if (p.broken) continue;
        for (const [dx, dy, dz] of NEIGHBOURS) {
          const q = this.byKey.get(cellKey(p.cell[0] + dx, p.cell[1] + dy, p.cell[2] + dz));
          if (q && set.has(q) && !seen.has(q) && !q.broken && q.alive) {
            seen.add(q);
            stack.push(q);
          }
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  _createBody(pos, quat, linvel, angvel) {
    const R = this.R;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setCcdEnabled(true)
      .setLinearDamping(0.02)
      .setAngularDamping(0.12);
    const rb = this.world.createRigidBody(desc);
    if (linvel) rb.setLinvel(linvel, true);
    if (angvel) rb.setAngvel(angvel, true);
    const rec = { rb, parts: new Set(), mass: 0, engines: 0, alive: true };
    this.bodies.add(rec);
    return rec;
  }

  _colliderDesc(part) {
    const R = this.R;
    const def = PARTS[part.type];
    let desc;
    const offset = _v1.set(0, 0, 0);
    let rot = { x: 0, y: 0, z: 0, w: 1 };
    switch (part.type) {
      case 'wood':
      case 'metal':
        desc = R.ColliderDesc.roundCuboid(0.43, 0.43, 0.43, 0.05);
        break;
      case 'engine':
        desc = R.ColliderDesc.roundCuboid(0.4, 0.36, 0.38, 0.06);
        offset.set(0, -0.04, 0);
        break;
      case 'pig':
        desc = R.ColliderDesc.ball(0.44);
        break;
      case 'balloon':
        desc = R.ColliderDesc.cuboid(0.22, 0.2, 0.22);
        offset.set(0, -0.26, 0);
        break;
      case 'fan':
        desc = R.ColliderDesc.cuboid(0.3, 0.3, 0.3);
        break;
      case 'rocket':
        desc = R.ColliderDesc.roundCuboid(0.36, 0.16, 0.16, 0.04);
        rot = { x: part.localQuat.x, y: part.localQuat.y, z: part.localQuat.z, w: part.localQuat.w };
        break;
      case 'tnt':
        desc = R.ColliderDesc.cuboid(0.4, 0.4, 0.4);
        break;
      default:
        desc = R.ColliderDesc.cuboid(0.45, 0.45, 0.45);
    }
    const g = part.broken ? groups(G.DEBRIS, 0xffff) : groups(G.VEHICLE, G.GROUND | G.PROP | G.VEHICLE | G.DEBRIS);
    return desc
      .setTranslation(part.local.x + offset.x, part.local.y + offset.y, part.local.z + offset.z)
      .setRotation(rot)
      .setMass(def.mass)
      .setFriction(def.friction)
      .setRestitution(0.12)
      .setCollisionGroups(g)
      .setActiveEvents(this.R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(1500);
  }

  _attachCollider(part, rec) {
    if (part.collider) {
      this.colliderPart.delete(part.collider.handle);
      this.world.removeCollider(part.collider, true);
    }
    if (part.body) part.body.parts.delete(part);
    part.collider = this.world.createCollider(this._colliderDesc(part), rec.rb);
    part.body = rec;
    rec.parts.add(part);
    this.colliderPart.set(part.collider.handle, part);
    this._refreshBody(rec);
  }

  _refreshBody(rec) {
    let mass = 0;
    let engines = 0;
    for (const p of rec.parts) {
      if (!p.alive) continue;
      mass += PARTS[p.type].mass;
      if (p.type === 'engine' && !p.broken) engines++;
    }
    rec.mass = mass;
    rec.engines = engines;
  }

  _createWheel(w) {
    const R = this.R;
    const anchor = _v1.copy(w.local).add(_v2.set(0, -WHEEL_DROP, 0));
    w.anchorLocal = anchor.clone();
    const world = anchor.clone().applyQuaternion(this.spawnQuat).add(this.spawn);
    const q = this.spawnQuat;
    const hubDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(world.x, world.y, world.z)
      .setRotation(toV4(q))
      .setAdditionalMassProperties(1.2, { x: 0, y: 0, z: 0 }, { x: 0.03, y: 0.03, z: 0.03 }, { x: 0, y: 0, z: 0, w: 1 });
    w.hub = this.world.createRigidBody(hubDesc);
    const wheelDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(world.x, world.y, world.z)
      .setRotation(toV4(q))
      .setCcdEnabled(true)
      .setAngularDamping(0.05);
    w.wheelBody = this.world.createRigidBody(wheelDesc);
    const cd = R.ColliderDesc.roundCylinder(WHEEL_HALF_WIDTH - 0.05, WHEEL_RADIUS - 0.05, 0.05)
      .setRotation(WHEEL_ROT)
      .setMass(PARTS.wheel.mass)
      .setFriction(PARTS.wheel.friction)
      .setRestitution(0.15)
      .setCollisionGroups(groups(G.WHEEL, G.GROUND | G.PROP | G.DEBRIS))
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(1500);
    w.collider = this.world.createCollider(cd, w.wheelBody);
    this.colliderPart.set(w.collider.handle, w);
    const axle = R.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    w.axleJoint = this.world.createImpulseJoint(axle, w.hub, w.wheelBody, true);
    w.susJoint = null;
    w.parentPart = null;
    w.grounded = false;
  }

  _findWheelParent(w) {
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const q = this.byKey.get(cellKey(w.cell[0] + dx, w.cell[1] + dy, w.cell[2] + dz));
      if (q && q.alive && !q.broken && isStructural(q.type)) return q;
    }
    return null;
  }

  _attachWheel(w, parent) {
    const R = this.R;
    if (w.susJoint) {
      this.world.removeImpulseJoint(w.susJoint, true);
      w.susJoint = null;
    }
    w.parentPart = parent;
    if (!parent) {
      w.broken = true;
      w.collider.setCollisionGroups(groups(G.DEBRIS, 0xffff));
      return;
    }
    const jd = R.JointData.prismatic(toV(w.anchorLocal), { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    jd.limitsEnabled = true;
    jd.limits = [-0.13, 0.13];
    w.susJoint = this.world.createImpulseJoint(jd, parent.body.rb, w.hub, true);
    w.susJoint.configureMotorModel(R.MotorModel.ForceBased);
    w.susJoint.configureMotorPosition(0, 4000, 250);
  }

  _tuneSuspension() {
    const perBody = new Map();
    for (const w of this.wheels) {
      if (!w.susJoint) continue;
      const rec = w.parentPart.body;
      perBody.set(rec, (perBody.get(rec) ?? 0) + 1);
    }
    for (const w of this.wheels) {
      if (!w.susJoint) continue;
      const rec = w.parentPart.body;
      const n = perBody.get(rec);
      const sprung = Math.max(8, (rec.mass + n * 1.2) / n);
      const k = (sprung * 9.81) / 0.055;
      const c = 2 * 0.6 * Math.sqrt(k * sprung);
      w.susJoint.configureMotorPosition(0, k, c);
    }
    // wheel "side" for skid steering: which side of its chassis the wheel is on
    const centres = new Map();
    for (const w of this.wheels) {
      if (!w.parentPart) continue;
      const rec = w.parentPart.body;
      const c = centres.get(rec) ?? { sum: 0, n: 0 };
      c.sum += w.local.z;
      c.n++;
      centres.set(rec, c);
    }
    for (const w of this.wheels) {
      if (!w.parentPart) { w.side = 0; continue; }
      const c = centres.get(w.parentPart.body);
      const dz = w.local.z - c.sum / c.n;
      w.side = Math.abs(dz) < 0.25 ? 0 : Math.sign(dz);
    }
  }

  // ---------------------------------------------------------------- queries

  partWorldPosition(part, target = new Vector3()) {
    if (part.type === 'wheel') {
      const t = part.wheelBody.translation();
      return target.set(t.x, t.y, t.z);
    }
    const rb = part.body.rb;
    const t = rb.translation();
    const r = rb.rotation();
    _q1.set(r.x, r.y, r.z, r.w);
    return target.copy(part.local).applyQuaternion(_q1).add(_v3.set(t.x, t.y, t.z));
  }

  partWorldQuaternion(part, target = new Quaternion()) {
    if (part.type === 'wheel') {
      const r = part.wheelBody.rotation();
      return target.set(r.x, r.y, r.z, r.w);
    }
    const r = part.body.rb.rotation();
    return target.set(r.x, r.y, r.z, r.w).multiply(part.localQuat);
  }

  bodyQuaternion(rec, target = new Quaternion()) {
    const r = rec.rb.rotation();
    return target.set(r.x, r.y, r.z, r.w);
  }

  pigPosition(target = new Vector3()) {
    return this.partWorldPosition(this.pig, target);
  }

  pigBody() {
    return this.pig.body;
  }

  speed() {
    const v = this.pig.body.rb.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  alive(type) {
    return this.parts.filter((p) => p.alive && p.type === type);
  }

  // ---------------------------------------------------------------- per-step control

  step(dt, input, ctx) {
    this.lastThrottle = input.throttle;
    // wheel drive
    const bodyGround = new Map();
    for (const w of this.wheels) {
      if (!w.alive) continue;
      const t = w.wheelBody.translation();
      const d = this.phys.groundDistance(t.x, t.y, t.z, WHEEL_RADIUS + 0.16);
      w.grounded = d !== null;
      if (!w.susJoint) continue;
      const rec = w.parentPart.body;
      const g = bodyGround.get(rec) ?? { grounded: 0, total: 0 };
      g.total++;
      if (w.grounded) g.grounded++;
      bodyGround.set(rec, g);

      const parentRb = rec.rb;
      const r = parentRb.rotation();
      _q1.set(r.x, r.y, r.z, r.w);
      const axle = _v1.copy(Z_AXIS).applyQuaternion(_q1);
      const wa = w.wheelBody.angvel();
      const pa = parentRb.angvel();
      const rel = (wa.x - pa.x) * axle.x + (wa.y - pa.y) * axle.y + (wa.z - pa.z) * axle.z;
      const fwdSpeed = -rel; // rad/s, positive when rolling towards +X
      let torque = 0;
      const engines = rec.engines;
      let drive = 0;
      if (engines > 0) {
        const rev = input.throttle < 0 ? -1 : 1; // steer like a car when reversing
        drive = Math.max(-1, Math.min(1, input.throttle - input.steer * w.side * ENGINE.steerMix * rev));
      }
      w.throttle = drive;
      if (drive !== 0) {
        const maxW = Math.min(60, ENGINE.baseSpeed + ENGINE.speedPerEngine * (engines - 1));
        const t0 = ENGINE.torquePerWheel * Math.pow(engines, 0.8);
        const dirSpeed = fwdSpeed * Math.sign(drive);
        const f = dirSpeed < 0 ? 1 : Math.max(0, Math.min(1, (maxW - dirSpeed) / (maxW * 0.3)));
        torque = t0 * drive * f;
      } else {
        torque = -fwdSpeed * 0.08; // rolling resistance
      }
      if (input.brake) {
        torque += -Math.sign(fwdSpeed) * Math.min(Math.abs(fwdSpeed) * 6, 90);
      }
      if (torque !== 0) {
        const imp = torque * dt;
        w.wheelBody.applyTorqueImpulse({ x: -axle.x * imp, y: -axle.y * imp, z: -axle.z * imp }, true);
        parentRb.applyTorqueImpulse({ x: axle.x * imp, y: axle.y * imp, z: axle.z * imp }, true);
      }
    }

    // steering assist: turns the chassis like real tank tracks would, only with wheels on the ground
    if (input.steer !== 0 || input.throttle !== 0) {
      for (const [rec, g] of bodyGround) {
        if (rec.engines === 0 || g.grounded === 0) continue;
        const rb = rec.rb;
        const r = rb.rotation();
        _q1.set(r.x, r.y, r.z, r.w);
        const up = _v2.copy(Y_AXIS).applyQuaternion(_q1);
        if (up.y < 0.3) continue;
        const av = rb.angvel();
        const yaw = av.x * up.x + av.y * up.y + av.z * up.z;
        const target = -input.steer * ENGINE.yawRate * (input.throttle < 0 ? -1 : 1);
        const frac = g.grounded / g.total;
        const inertia = rec.mass * 1.1 + g.total * 6;
        const tq = Math.max(-1, Math.min(1, (target - yaw) * 0.6)) * ENGINE.yawGain * inertia * frac * dt;
        rb.applyTorqueImpulse({ x: up.x * tq, y: up.y * tq, z: up.z * tq }, true);
      }
    }

    // thrusters, balloons
    const ceilingY = ctx.balloonCeilingY;
    for (const p of this.parts) {
      if (!p.alive) continue;
      if (p.type === 'fan') {
        if (this.fansOn) {
          p.spin += dt * 55;
          this._thrust(p, PARTS.fan.thrust * dt);
        } else {
          p.spin += dt * 1.5; // idles in the breeze
        }
      } else if (p.type === 'rocket') {
        p.firing = input.rocket && p.fuel > 0;
        if (p.firing) {
          p.fuel = Math.max(0, p.fuel - dt);
          this._thrust(p, PARTS.rocket.thrust * dt);
        }
      } else if (p.type === 'balloon' && !p.popped) {
        const pos = this.partWorldPosition(p, _v1);
        const fade = 1 - smooth(ceilingY - 6, ceilingY + 5, pos.y);
        const lift = PARTS.balloon.lift * fade;
        const vel = p.body.rb.velocityAtPoint(toV(pos));
        const drag = 14;
        p.body.rb.applyImpulseAtPoint(
          { x: -vel.x * drag * dt, y: (lift - vel.y * drag) * dt, z: -vel.z * drag * dt },
          toV(pos),
          true,
        );
      } else if (p.type === 'engine') {
        p.spin += dt * (8 + Math.abs(input.throttle) * 40);
      }
    }
  }

  _thrust(part, impulse) {
    const rb = part.body.rb;
    const pos = this.partWorldPosition(part, _v1);
    const dir = _v2.copy(X_AXIS).applyQuaternion(this.partWorldQuaternion(part, _q1));
    rb.applyImpulseAtPoint({ x: dir.x * impulse, y: dir.y * impulse, z: dir.z * impulse }, toV(pos), true);
  }

  toggleFans() {
    if (!this.alive('fan').length) return false;
    this.fansOn = !this.fansOn;
    return true;
  }

  popBalloon() {
    const b = this.parts.find((p) => p.alive && p.type === 'balloon' && !p.popped);
    if (!b) return null;
    b.popped = true;
    this.events.push({ type: 'pop', part: b, pos: this.partWorldPosition(b).add(_v1.set(0, 1.9, 0)) });
    return b;
  }

  // ---------------------------------------------------------------- damage

  breakThreshold(part) {
    const rec = part.type === 'wheel' ? part.parentPart?.body : part.body;
    const mass = rec ? rec.mass : 20;
    return PARTS[part.type].strength * (8000 + 150 * mass);
  }

  // Detach a part from the vehicle; it keeps flying as debris.
  breakPart(part, force = 0) {
    if (!part.alive || part.broken || part.type === 'pig') return;
    if (part.type === 'wheel') {
      if (!part.susJoint) return;
      this.world.removeImpulseJoint(part.susJoint, true);
      part.susJoint = null;
      part.parentPart = null;
      part.broken = true;
      part.collider.setCollisionGroups(groups(G.DEBRIS, 0xffff));
      this.events.push({ type: 'break', part, force, pos: this.partWorldPosition(part) });
      this._tuneSuspension();
      return;
    }
    part.broken = true;
    this.events.push({ type: 'break', part, force, pos: this.partWorldPosition(part) });
    this._split(part.body);
  }

  // Remove a part from the world completely (blown up).
  destroyPart(part) {
    if (!part.alive || part.type === 'pig') return;
    const pos = this.partWorldPosition(part);
    part.alive = false;
    if (part.type === 'wheel') {
      if (part.susJoint) this.world.removeImpulseJoint(part.susJoint, true);
      part.susJoint = null;
      this.colliderPart.delete(part.collider.handle);
      this.world.removeRigidBody(part.wheelBody);
      this.world.removeRigidBody(part.hub);
      this.events.push({ type: 'destroy', part, pos });
      this._tuneSuspension();
      return;
    }
    this.colliderPart.delete(part.collider.handle);
    const rec = part.body;
    this.world.removeCollider(part.collider, true);
    part.collider = null;
    rec.parts.delete(part);
    this.events.push({ type: 'destroy', part, pos });
    this._split(rec);
  }

  _split(rec) {
    const members = [...rec.parts].filter((p) => p.alive);
    if (members.length === 0) {
      this._removeBody(rec);
      this._reattachWheels();
      return;
    }
    const comps = this._components(members);
    if (comps.length > 1) {
      let keep = comps.find((c) => c.includes(this.pig) && !this.pig.broken);
      if (!keep) keep = comps.reduce((a, b) => (mass(b) > mass(a) ? b : a));
      const rb = rec.rb;
      const t = rb.translation();
      const r = rb.rotation();
      const pos = new Vector3(t.x, t.y, t.z);
      const quat = new Quaternion(r.x, r.y, r.z, r.w);
      const lv = rb.linvel();
      const av = rb.angvel();
      const com = rb.worldCom();
      for (const comp of comps) {
        if (comp === keep) continue;
        // velocity of this chunk's centre in the old body
        const c = new Vector3();
        let m = 0;
        for (const p of comp) {
          const pm = PARTS[p.type].mass;
          c.addScaledVector(this.partWorldPosition(p, _v1), pm);
          m += pm;
        }
        c.divideScalar(m);
        const rx = c.x - com.x, ry = c.y - com.y, rz = c.z - com.z;
        const vel = { x: lv.x + av.y * rz - av.z * ry, y: lv.y + av.z * rx - av.x * rz, z: lv.z + av.x * ry - av.y * rx };
        const nrec = this._createBody(pos, quat, vel, av);
        for (const p of comp) this._attachCollider(p, nrec);
      }
      this._refreshBody(rec);
    } else {
      this._refreshBody(rec);
    }
    this._reattachWheels();
  }

  _removeBody(rec) {
    this.bodies.delete(rec);
    rec.alive = false;
    this.world.removeRigidBody(rec.rb);
  }

  _reattachWheels() {
    let changed = false;
    for (const w of this.wheels) {
      if (!w.alive || w.broken) continue;
      const parent = w.parentPart;
      const stillOk = parent && parent.alive && !parent.broken && w.susJoint && w.susJoint.isValid() && w.susJoint.body1().handle === parent.body.rb.handle;
      if (stillOk) continue;
      const np = this._findWheelParent(w);
      this._attachWheel(w, np);
      changed = true;
    }
    for (const rec of [...this.bodies]) {
      if (![...rec.parts].some((p) => p.alive)) this._removeBody(rec);
    }
    if (changed) this._tuneSuspension();
  }

  dispose() {
    // bodies are freed together with the world
    this.parts.length = 0;
    this.bodies.clear();
  }
}

function toV4(q) {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

function mass(comp) {
  return comp.reduce((s, p) => s + PARTS[p.type].mass, 0);
}

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
