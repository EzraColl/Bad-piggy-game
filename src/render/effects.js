// GPU particles (smoke, dust, fire, sparks, confetti), flying debris and explosion flashes.

import * as THREE from 'three';
import { woodTextures } from './textures.js';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
attribute float aSeed;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = min(aSize * uScale / max(0.1, -mvPosition.z), 512.0);
  vAlpha = aAlpha;
  vColor = aColor;
  vSeed = aSeed;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
uniform float uHard;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a;
  if (uHard > 0.5) {
    a = 1.0 - smoothstep(0.55, 1.0, r);
  } else {
    float ang = atan(c.y, c.x);
    float lumps = 0.82 + 0.18 * sin(ang * 5.0 + vSeed * 31.0) * sin(ang * 3.0 - vSeed * 17.0 + r * 4.0);
    a = smoothstep(1.0, 0.0, r / lumps) ;
    a *= a;
  }
  gl_FragColor = vec4(vColor, vAlpha * a);
  #include <fog_fragment>
}`;

class ParticlePool {
  constructor(max, blending, hard = false) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.fade = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setAttribute('aSeed', this.aSeed);
    g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 500 }, uHard: { value: hard ? 1 : 0 } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
      fog: true,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 3 : 2;
  }

  emit(p, v, color, size, life, opts = {}) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = size;
    this.life[i] = life;
    this.age[i] = 0;
    this.seed[i] = Math.random();
    this.grow[i] = opts.grow ?? 1;
    this.grav[i] = opts.gravity ?? 0;
    this.drag[i] = opts.drag ?? 1;
    this.a0[i] = opts.alpha ?? 1;
    this.alpha[i] = this.a0[i];
    this.fade[i] = opts.fadeIn ?? 0.1;
  }

  update(dt, ground) {
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this._kill(i);
        continue;
      }
      const t = this.age[i] / this.life[i];
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (ground && this.grav[i] > 0) {
        const gy = ground(this.pos[i * 3], this.pos[i * 3 + 2]) + 0.03;
        if (this.pos[i * 3 + 1] < gy) {
          this.pos[i * 3 + 1] = gy;
          this.vel[i * 3] *= 0.4;
          this.vel[i * 3 + 2] *= 0.4;
          this.vel[i * 3 + 1] = Math.abs(this.vel[i * 3 + 1]) * 0.25;
        }
      }
      this.size[i] *= 1 + (this.grow[i] - 1) * dt;
      const fadeIn = Math.min(1, t / this.fade[i]);
      this.alpha[i] = this.a0[i] * fadeIn * (1 - t) * (1 - t * 0.3);
      i++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.count);
    for (const a of [this.aPos, this.aCol, this.aSize, this.aAlpha, this.aSeed]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  _kill(i) {
    const last = --this.count;
    if (i === last) return;
    for (const [arr, n] of [[this.pos, 3], [this.vel, 3], [this.col, 3]]) {
      for (let k = 0; k < n; k++) arr[i * n + k] = arr[last * n + k];
    }
    for (const arr of [this.size, this.alpha, this.seed, this.life, this.age, this.grow, this.fade, this.grav, this.drag, this.a0]) arr[i] = arr[last];
  }

  clear() {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();
const rnd = (a, b) => a + Math.random() * (b - a);

export class Effects {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.ground = (x, z) => terrain.height(x, z);
    this.smoke = new ParticlePool(3500, THREE.NormalBlending);
    this.fire = new ParticlePool(2500, THREE.AdditiveBlending);
    this.bits = new ParticlePool(1500, THREE.NormalBlending, true);
    scene.add(this.smoke.points, this.fire.points, this.bits.points);
    this.shake = 0;

    // constant number of lights so shaders never need recompiling mid-game
    this.flashes = [0, 1].map(() => {
      const l = new THREE.PointLight(0xffa050, 0, 30, 2);
      scene.add(l);
      return l;
    });
    this.flashIndex = 0;
    this.rocketLight = new THREE.PointLight(0xff8a3a, 0, 12, 2);
    scene.add(this.rocketLight);

    // wooden debris chunks
    const wood = woodTextures();
    const dg = new THREE.BoxGeometry(0.42, 0.09, 0.13);
    this.debrisMat = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughness: 0.8 });
    this.debrisMax = 160;
    this.debris = new THREE.InstancedMesh(dg, this.debrisMat, this.debrisMax);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.castShadow = true;
    this.debris.receiveShadow = true;
    this.debris.frustumCulled = false;
    this.debris.count = 0;
    this.debrisList = [];
    scene.add(this.debris);
  }

  setPixelScale(heightPx, fovDeg) {
    const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    for (const p of [this.smoke, this.fire, this.bits]) p.material.uniforms.uScale.value = s;
  }

  dust(pos, strength = 1, tint = null) {
    _c.copy(tint ?? new THREE.Color(0.52, 0.43, 0.32));
    _c.multiplyScalar(rnd(0.85, 1.15));
    _v.set(rnd(-0.6, 0.6), rnd(0.3, 1.2) * strength, rnd(-0.6, 0.6));
    this.smoke.emit(pos, _v, _c, rnd(0.5, 0.9) * (0.6 + strength * 0.5), rnd(1.1, 2.0), { grow: 1.9, drag: 1.4, alpha: 0.33 * Math.min(1, strength), fadeIn: 0.15 });
  }

  puff(pos, vel, color, size = 1, life = 2, alpha = 0.6) {
    this.smoke.emit(pos, vel, color, size, life, { grow: 2.2, drag: 1.1, alpha, fadeIn: 0.08 });
  }

  exhaust(pos, dir, sideVel) {
    // flame core
    for (let i = 0; i < 2; i++) {
      _v.copy(dir).multiplyScalar(rnd(6, 11)).add(sideVel);
      _v.x += rnd(-0.6, 0.6); _v.y += rnd(-0.6, 0.6); _v.z += rnd(-0.6, 0.6);
      _c.setRGB(rnd(5, 8), rnd(2.2, 3.4), rnd(0.5, 0.9));
      this.fire.emit(pos, _v, _c, rnd(0.25, 0.45), rnd(0.08, 0.18), { grow: 0.4, drag: 3, fadeIn: 0.01 });
    }
    // white soda-smoke trail
    _v.copy(dir).multiplyScalar(rnd(2, 4)).add(sideVel.clone().multiplyScalar(0.5));
    _v.y += rnd(0.2, 0.8);
    _c.setRGB(0.92, 0.92, 0.9);
    this.smoke.emit(pos, _v, _c, rnd(0.35, 0.55), rnd(1.2, 2.4), { grow: 2.6, drag: 1.2, alpha: 0.45, fadeIn: 0.05 });
  }

  explosion(pos, power = 1) {
    const n = Math.round(55 * power);
    for (let i = 0; i < n; i++) {
      _v.randomDirection().multiplyScalar(rnd(3, 11) * power);
      _v.y = Math.abs(_v.y) * 0.8 + 1;
      const heat = rnd(0.6, 1);
      _c.setRGB(4.2 * heat, 1.7 * heat, 0.4 * heat);
      this.fire.emit(pos, _v, _c, rnd(0.9, 1.9) * power, rnd(0.25, 0.6), { grow: 1.6, drag: 3.5, fadeIn: 0.02, alpha: 0.8 });
    }
    for (let i = 0; i < 70 * power; i++) {
      _v.randomDirection().multiplyScalar(rnd(1.5, 7) * power);
      _v.y = Math.abs(_v.y) + rnd(0.5, 2.5);
      const g = rnd(0.12, 0.3);
      _c.setRGB(g, g * 0.95, g * 0.9);
      this.smoke.emit(pos, _v, _c, rnd(1.1, 2.1) * power, rnd(2.2, 4.2), { grow: 1.6, drag: 1.6, alpha: 0.75, fadeIn: 0.06 });
    }
    for (let i = 0; i < 60 * power; i++) {
      _v.randomDirection().multiplyScalar(rnd(8, 22));
      _v.y = Math.abs(_v.y) * 0.9 + 2;
      _c.setRGB(6, 3.2, 1);
      this.fire.emit(pos, _v, _c, rnd(0.05, 0.1), rnd(0.6, 1.4), { grow: 0.5, drag: 0.6, gravity: 9.8, fadeIn: 0.01 });
    }
    const light = this.flashes[this.flashIndex++ % this.flashes.length];
    light.position.copy(pos);
    light.intensity = 70 * power;
    light.userData.decay = 11;
    this.shake = Math.min(1.4, this.shake + 0.9 * power);
    this.splinters(pos, 10 * power);
  }

  pop(pos, color = new THREE.Color(0.85, 0.12, 0.1)) {
    for (let i = 0; i < 26; i++) {
      _v.randomDirection().multiplyScalar(rnd(2, 6));
      this.bits.emit(pos, _v, color, rnd(0.06, 0.12), rnd(0.7, 1.4), { grow: 1, drag: 1.2, gravity: 6, fadeIn: 0.01 });
    }
    _c.setRGB(0.95, 0.95, 0.95);
    for (let i = 0; i < 6; i++) this.puff(pos, _v.randomDirection().multiplyScalar(1.2), _c, 0.5, 0.8, 0.25);
  }

  sparkle(pos) {
    for (let i = 0; i < 70; i++) {
      _v.randomDirection().multiplyScalar(rnd(1.5, 6));
      _c.setRGB(rnd(5, 8), rnd(3.5, 5.5), rnd(0.6, 1.4));
      this.fire.emit(pos, _v, _c, rnd(0.08, 0.2), rnd(0.6, 1.3), { grow: 0.6, drag: 1.5, gravity: 1.5, fadeIn: 0.01 });
    }
  }

  confetti(pos) {
    const palette = [[0.95, 0.2, 0.2], [0.2, 0.6, 0.95], [0.98, 0.8, 0.15], [0.3, 0.85, 0.35], [0.9, 0.35, 0.85], [1, 1, 1]];
    for (let i = 0; i < 260; i++) {
      _v.set(rnd(-5, 5), rnd(7, 15), rnd(-5, 5));
      const c = palette[i % palette.length];
      _c.setRGB(c[0], c[1], c[2]);
      this.bits.emit(pos, _v, _c, rnd(0.08, 0.14), rnd(2.5, 4.5), { grow: 1, drag: 1.1, gravity: 4.5, fadeIn: 0.01 });
    }
  }

  splinters(pos, count = 8, vel = null) {
    for (let i = 0; i < count; i++) {
      if (this.debrisList.length >= this.debrisMax) this.debrisList.shift();
      const v = new THREE.Vector3().randomDirection().multiplyScalar(rnd(3, 9));
      v.y = Math.abs(v.y) + 2;
      if (vel) v.add(vel);
      this.debrisList.push({
        p: pos.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3))),
        v,
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6))),
        w: new THREE.Vector3(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12)),
        s: rnd(0.6, 1.3),
        age: 0,
        rest: false,
      });
    }
  }

  update(dt) {
    this.smoke.update(dt, this.ground);
    this.fire.update(dt, this.ground);
    this.bits.update(dt, this.ground);
    for (const l of this.flashes) {
      if (l.intensity > 0) l.intensity = Math.max(0, l.intensity * Math.exp(-(l.userData.decay ?? 6) * dt) - 1);
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    // debris
    const m4 = new THREE.Matrix4();
    const dq = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    let n = 0;
    for (let i = this.debrisList.length - 1; i >= 0; i--) {
      const d = this.debrisList[i];
      d.age += dt;
      if (d.age > 9) {
        this.debrisList.splice(i, 1);
        continue;
      }
    }
    for (const d of this.debrisList) {
      if (!d.rest) {
        d.v.y -= 9.81 * dt;
        d.p.addScaledVector(d.v, dt);
        const gy = this.terrain.height(d.p.x, d.p.z) + 0.05;
        if (d.p.y < gy) {
          d.p.y = gy;
          d.v.multiplyScalar(0.45);
          d.v.y = Math.abs(d.v.y) * 0.4;
          d.w.multiplyScalar(0.5);
          if (d.v.lengthSq() < 0.3) d.rest = true;
        }
        const ang = d.w.length() * dt;
        if (ang > 0) {
          dq.setFromAxisAngle(_v.copy(d.w).normalize(), ang);
          d.q.premultiply(dq);
        }
      }
      const shrink = d.age > 7 ? Math.max(0.01, 1 - (d.age - 7) / 2) : 1;
      scl.setScalar(d.s * shrink);
      m4.compose(d.p, d.q, scl);
      this.debris.setMatrixAt(n++, m4);
    }
    this.debris.count = n;
    this.debris.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.smoke.clear();
    this.fire.clear();
    this.bits.clear();
    this.debrisList.length = 0;
    this.debris.count = 0;
    for (const l of this.flashes) l.intensity = 0;
    this.rocketLight.intensity = 0;
    this.shake = 0;
  }

  dispose() {
    for (const p of [this.smoke, this.fire, this.bits]) {
      this.scene.remove(p.points);
      p.points.geometry.dispose();
      p.material.dispose();
    }
    for (const l of this.flashes) this.scene.remove(l);
    this.scene.remove(this.rocketLight, this.debris);
    this.debris.geometry.dispose();
  }
}
