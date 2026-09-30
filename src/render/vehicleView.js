// Draws the player's contraption and keeps every model in sync with the physics.

import * as THREE from 'three';
import { createPartMesh, buildWheelMesh, buildBalloonMesh, setString, partMaterials } from './partMeshes.js';
import { WHEEL_RADIUS } from '../game/parts.js';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const DIRT = new THREE.Color(0.5, 0.41, 0.3);
const GRASSY = new THREE.Color(0.42, 0.4, 0.3);
const SNOW = new THREE.Color(0.95, 0.96, 1.0);

export class VehicleView {
  constructor(scene, car, effects, terrain, theme) {
    this.scene = scene;
    this.car = car;
    this.effects = effects;
    this.terrain = terrain;
    this.theme = theme;
    this.group = new THREE.Group();
    this.group.name = 'vehicle';
    scene.add(this.group);
    this.meshes = new Map();
    this.balloons = new Map();
    this.time = 0;
    for (const p of car.parts) {
      let m;
      if (p.type === 'wheel') {
        m = buildWheelMesh();
      } else {
        m = createPartMesh(p.type);
        if (p.type === 'balloon') {
          m.getObjectByName('balloon').visible = false;
          m.getObjectByName('string').visible = false;
          const b = buildBalloonMesh();
          b.scale.setScalar(1.05);
          const str = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 5), partMaterials().string);
          this.group.add(b, str);
          this.balloons.set(p, { mesh: b, string: str, pos: null, vel: new THREE.Vector3(), phase: Math.random() * 10 });
        }
      }
      this.meshes.set(p, m);
      this.group.add(m);
    }
    this.sync(0);
  }

  // Every mesh is placed from the physics state; balloons trail behind on their strings.
  sync(dt) {
    this.time += dt;
    const car = this.car;
    let rocketLight = 0;
    const lightPos = new THREE.Vector3();
    for (const [p, m] of this.meshes) {
      if (!p.alive) continue;
      car.partWorldPosition(p, m.position);
      car.partWorldQuaternion(p, m.quaternion);
      if (p.type === 'fan') {
        const rotor = m.getObjectByName('rotor');
        if (rotor) rotor.rotation.x = p.spin;
      } else if (p.type === 'engine') {
        const pul = m.getObjectByName('pulley');
        const fan = m.getObjectByName('fan');
        if (pul) pul.rotation.x = p.spin;
        if (fan) fan.rotation.x = p.spin * 1.3;
        const sh = m.getObjectByName('shaker');
        if (sh) {
          const j = 0.003 + Math.abs(car.lastThrottle ?? 0) * 0.012;
          sh.position.set((Math.random() - 0.5) * j, (Math.random() - 0.5) * j * 2, (Math.random() - 0.5) * j);
        }
      } else if (p.type === 'rocket') {
        const f = m.getObjectByName('flame');
        if (f) {
          f.visible = p.firing;
          if (p.firing) {
            const s = 0.8 + Math.random() * 0.45;
            f.scale.set(s, 0.85 + Math.random() * 0.3, 0.85 + Math.random() * 0.3);
            const dir = _v.copy(X).applyQuaternion(m.quaternion).negate();
            const nozzle = _p.copy(m.position).addScaledVector(dir, 0.45);
            const bv = p.body.rb.linvel();
            _w.set(bv.x, bv.y, bv.z);
            if (dt > 0) this.effects.exhaust(nozzle, dir, _w);
            rocketLight += 1;
            lightPos.add(nozzle);
          }
        }
      } else if (p.type === 'balloon') {
        this._balloon(p, m, dt);
      } else if (p.type === 'wheel' && dt > 0) {
        this._wheelDust(p, m);
      }
    }
    const rl = this.effects.rocketLight;
    if (rocketLight > 0) {
      rl.position.copy(lightPos.divideScalar(rocketLight));
      rl.intensity = (35 + Math.random() * 25) * Math.min(2, rocketLight);
    } else {
      rl.intensity = 0;
    }
  }

  _balloon(p, m, dt) {
    const b = this.balloons.get(p);
    if (!b || p.popped) return;
    const anchor = _p.set(0, -0.3, 0).applyQuaternion(m.quaternion).add(m.position);
    const sway = Math.sin(this.time * 1.3 + b.phase) * 0.18;
    const target = _w.copy(anchor).add(_v.set(sway * 0.6, 1.95, Math.cos(this.time * 1.1 + b.phase) * 0.15));
    if (!b.pos) b.pos = target.clone();
    // springy follow so balloons lag and bob like real ones
    if (dt > 0) {
      const k = 40;
      const c = 7;
      const acc = target.clone().sub(b.pos).multiplyScalar(k).addScaledVector(b.vel, -c);
      b.vel.addScaledVector(acc, dt);
      b.pos.addScaledVector(b.vel, dt);
      // keep the string length
      const d = b.pos.clone().sub(anchor);
      if (d.length() > 2.2) b.pos.copy(anchor).addScaledVector(d.normalize(), 2.2);
    }
    b.mesh.position.copy(b.pos);
    const tilt = b.pos.clone().sub(anchor).normalize();
    b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tilt);
    const bottom = b.pos.clone().addScaledVector(tilt, -0.66 * b.mesh.scale.y);
    setString(b.string, anchor, bottom);
  }

  _wheelDust(p, m) {
    if (!p.grounded) return;
    const v = p.wheelBody.linvel();
    const speed = Math.hypot(v.x, v.z);
    const av = p.wheelBody.angvel();
    const spin = Math.hypot(av.x, av.y, av.z) * WHEEL_RADIUS;
    const slip = Math.abs(spin - speed);
    const amount = speed * 0.03 + slip * 0.07;
    if (Math.random() > amount) return;
    const x = m.position.x;
    const z = m.position.z;
    const road = this.terrain.roadMask(x, z);
    const h = this.terrain.height(x, z);
    let tint = road > 0.5 ? DIRT : GRASSY;
    if (this.theme.snowLine !== Infinity && h > this.theme.snowLine - 2) tint = SNOW;
    _p.set(x - v.x * 0.03, h + 0.12, z - v.z * 0.03);
    this.effects.dust(_p, Math.min(1.6, 0.4 + amount), tint);
  }

  handle(e) {
    const m = this.meshes.get(e.part);
    if (e.type === 'destroy' && m) {
      this.group.remove(m);
      const b = this.balloons.get(e.part);
      if (b) {
        this.group.remove(b.mesh, b.string);
        this.effects.pop(b.mesh.position);
      }
      const t = e.part.type;
      if (t === 'wood' || t === 'balloon' || t === 'fan' || t === 'tnt') this.effects.splinters(e.pos, 7);
      else this.effects.splinters(e.pos, 3);
      this.effects.puff(e.pos, new THREE.Vector3(0, 1, 0), new THREE.Color(0.3, 0.3, 0.3), 1.2, 2, 0.6);
    } else if (e.type === 'pop') {
      const b = this.balloons.get(e.part);
      if (b) {
        this.group.remove(b.mesh, b.string);
        this.effects.pop(b.mesh.position);
      }
    } else if (e.type === 'break' && m) {
      this.effects.splinters(e.pos, e.part.type === 'wood' ? 4 : 1);
    }
  }

  // All meshes, for the ray-traced photo mode.
  objects() {
    return this.group;
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
