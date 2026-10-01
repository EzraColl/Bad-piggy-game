// Visible axles: steel struts from a wheel's hub to the part it is bolted to.
// A wheel beside a box gets a straight axle; under, over, in front of or behind a box it gets a
// two-armed fork. Struts are re-aimed every frame so they follow the suspension.

import * as THREE from 'three';
import { partMaterials } from './partMeshes.js';
import { WHEEL_DROP, WHEEL_HALF_WIDTH } from '../game/parts.js';

const strutGeo = new THREE.CylinderGeometry(0.034, 0.034, 1, 12);
const bracketGeo = new THREE.BoxGeometry(0.26, 0.26, 0.05);
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();

function aim(mesh, a, b) {
  _d.subVectors(b, a);
  const len = _d.length();
  mesh.position.copy(a).addScaledVector(_d, 0.5);
  mesh.scale.set(1, Math.max(0.001, len), 1);
  if (len > 1e-5) mesh.quaternion.setFromUnitVectors(UP, _d.divideScalar(len));
}

export class AxleView {
  // mount: [dx, dy, dz] direction from the wheel's cell to the part it hangs from
  constructor(mount) {
    const m = partMaterials();
    this.mount = mount;
    this.side = mount[2] !== 0;
    this.group = new THREE.Group();
    this.group.name = 'axle';
    this.struts = [];
    const count = this.side ? 1 : 3; // a fork has two arms plus the bar through the hub
    for (let i = 0; i < count; i++) {
      const s = new THREE.Mesh(strutGeo, m.steel);
      s.castShadow = true;
      s.receiveShadow = true;
      this.struts.push(s);
      this.group.add(s);
    }
    this.bracket = new THREE.Mesh(bracketGeo, m.darkSteel);
    this.bracket.castShadow = true;
    this.group.add(this.bracket);
  }

  // cell: world position of the wheel's cell centre (in the chassis frame), quat: chassis rotation,
  // hub: wheel centre in the world. The axle runs along the chassis' Z axis.
  update(cell, quat, hub) {
    const d = this.mount;
    const axle = _n.copy(Z).applyQuaternion(quat);
    const off = WHEEL_HALF_WIDTH + 0.06;
    if (this.side) {
      _a.set(0, -WHEEL_DROP, d[2] * 0.5).applyQuaternion(quat).add(cell);
      aim(this.struts[0], _a, hub);
    } else {
      // attach points on the face of the neighbouring cell
      const face = new THREE.Vector3(d[0] * 0.5, d[1] !== 0 ? d[1] * 0.5 : -WHEEL_DROP, 0);
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1;
        _a.set(face.x, face.y, s * off).applyQuaternion(quat).add(cell);
        _b.copy(hub).addScaledVector(axle, s * off);
        aim(this.struts[i], _a, _b);
      }
      _a.copy(hub).addScaledVector(axle, -off);
      _b.copy(hub).addScaledVector(axle, off);
      aim(this.struts[2], _a, _b);
    }
    // bracket bolted to the neighbouring part's face
    const fx = d[0] * 0.5;
    const fy = d[1] * 0.5 + (d[1] === 0 ? -WHEEL_DROP : 0);
    const fz = d[2] * 0.5;
    this.bracket.position.set(fx, fy, fz).applyQuaternion(quat).add(cell);
    _d.set(d[0], d[1], d[2]).applyQuaternion(quat);
    this.bracket.quaternion.setFromUnitVectors(Z, _d);
  }
}
