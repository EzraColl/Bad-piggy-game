// Chase camera for driving (drag to orbit, wheel or pinch to zoom) with a classic side-on mode.

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _t = new THREE.Vector3();

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.mode = 'chase';
    this.target = new THREE.Vector3();
    this.heading = 0;
    this.yawOffset = 0;
    this.pitch = 0.32;
    this.distance = 9;
    this.enabled = false;
    this.lastDrag = 0;
    this.fovBase = 55;
    this._pos = new THREE.Vector3();
    this.initialised = false;
    this._pointers = new Map(); // one pointer drags the view round, two pinch to zoom
    this._spread = 0;

    const spread = () => {
      const [a, b] = [...this._pointers.values()];
      return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._spread = spread();
    });
    const up = (e) => {
      this._pointers.delete(e.pointerId);
      this._spread = spread();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!this.enabled || !p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this.lastDrag = performance.now();
      if (this._pointers.size > 1) {
        const d = spread();
        if (this._spread > 0 && d > 0) this.distance = THREE.MathUtils.clamp((this.distance * this._spread) / d, 4, 40);
        this._spread = d;
        return;
      }
      this.yawOffset -= dx * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, -0.05, 1.3);
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.001), 4, 40);
      },
      { passive: false },
    );
  }

  reset(target, heading = 0, size = 3) {
    this.target.copy(target);
    this.heading = heading;
    this.yawOffset = 0;
    this.pitch = 0.3;
    this.distance = 6 + size * 1.3;
    this.initialised = false;
  }

  toggleMode() {
    this.mode = this.mode === 'chase' ? 'side' : 'chase';
    this.yawOffset = 0;
    this.initialised = false;
    return this.mode;
  }

  // focus: point to look at; forward: vehicle forward vector; speed: m/s
  update(dt, focus, forward, velocity, terrain, shake = 0) {
    const cam = this.camera;
    const k = 1 - Math.exp(-dt * 6);
    this.target.lerp(focus, this.initialised ? k : 1);
    const speed = velocity.length();

    if (this.mode === 'chase') {
      // follow the direction of travel when moving, otherwise the vehicle's nose
      let want = this.heading;
      const flat = _v.set(forward.x, 0, forward.z);
      if (speed > 2.5 && Math.hypot(velocity.x, velocity.z) > 2) want = Math.atan2(velocity.z, velocity.x);
      else if (flat.lengthSq() > 0.05) want = Math.atan2(flat.z, flat.x);
      let d = want - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * (1 - Math.exp(-dt * (speed > 2 ? 2.2 : 0.8)));
      if (this._pointers.size === 0 && performance.now() - this.lastDrag > 2500) {
        this.yawOffset *= Math.exp(-dt * 0.8);
      }
      const yaw = this.heading + Math.PI + this.yawOffset;
      const dist = this.distance + Math.min(speed * 0.12, 4);
      _t.set(Math.cos(yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.sin(yaw) * Math.cos(this.pitch)).multiplyScalar(dist);
    } else {
      // side view like the original 2D game: +X runs left to right across the screen
      const dist = this.distance * 1.6 + 4;
      const yaw = Math.PI / 2 + this.yawOffset;
      _t.set(Math.cos(yaw) * dist, 2 + this.pitch * 4, Math.sin(yaw) * dist);
    }
    const desired = _v.copy(this.target).add(_t);
    const ground = terrain.height(desired.x, desired.z) + 1.0;
    if (desired.y < ground) desired.y = ground;
    if (!this.initialised) {
      this._pos.copy(desired);
      this.initialised = true;
    } else {
      this._pos.lerp(desired, 1 - Math.exp(-dt * 8));
    }
    cam.position.copy(this._pos);
    if (shake > 0) {
      const s = shake * shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    cam.lookAt(_t.copy(this.target).add(_v.set(0, 0.6, 0)));
    const fov = this.fovBase + Math.min(14, speed * 0.45);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 3));
      cam.updateProjectionMatrix();
    }
  }
}
