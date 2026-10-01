// Mounting brackets: steel bars and bolt plates that tie a part (rocket, engine, TNT, propeller,
// balloon) to every neighbouring part it is bolted to, so nothing looks like it floats in its cell.
// Parts inside a box get clamps to the box's floor and sides instead.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { partMaterials } from './partMeshes.js';

// The part's solid body in its own frame (+X is its thrust direction): centre and half sizes.
const SHAPES = {
  rocket: { c: [0, 0, 0], h: [0.38, 0.15, 0.15] },
  tnt: { c: [0, 0, 0], h: [0.4, 0.4, 0.4] },
  engine: { c: [0, -0.12, 0], h: [0.31, 0.3, 0.24] },
  fan: { c: [0.1, 0, 0], h: [0.16, 0.14, 0.14], skip: [-1, 0, 0] }, // never through the propeller
  balloon: { c: [0, -0.4, 0], h: [0.22, 0.06, 0.22], skip: [0, 1, 0] }, // the string goes up
};

export const BRACKET_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const INSIDE_BRACKET_DIRS = [[0, -1, 0], [0, 0, 1], [0, 0, -1]];

export function hasBrackets(type) {
  return !!SHAPES[type];
}

const Z = new THREE.Vector3(0, 0, 1);

function box(w, h, len, dir, pos) {
  const g = new THREE.BoxGeometry(w, h, len);
  const q = new THREE.Quaternion().setFromUnitVectors(Z, dir);
  g.applyQuaternion(q);
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

// A Group in the cell's frame (origin at the cell centre). partQuat turns the part within its cell,
// dirs are the cell-frame directions to bolt towards, scale is the part's inside-a-box shrink.
export function buildBrackets(type, partQuat, dirs, scale = 1) {
  const shape = SHAPES[type];
  const group = new THREE.Group();
  group.name = 'brackets';
  if (!shape || !dirs.length) return group;
  const mats = partMaterials();
  const inv = partQuat.clone().invert();
  const centre = new THREE.Vector3(...shape.c).applyQuaternion(partQuat).multiplyScalar(scale);
  const skip = shape.skip ? new THREE.Vector3(...shape.skip) : null;
  const bars = [];
  const plates = [];
  const bolts = [];
  for (const d of dirs) {
    const dv = new THREE.Vector3(...d);
    const dl = dv.clone().applyQuaternion(inv);
    if (skip && dl.dot(skip) > 0.9) continue;
    const ext = (Math.abs(dl.x) * shape.h[0] + Math.abs(dl.y) * shape.h[1] + Math.abs(dl.z) * shape.h[2]) * scale;
    const along = centre.dot(dv);
    const start = along + ext - 0.03;
    const end = 0.5 - 0.02;
    // line the bars up with the part's centre, beside the direction of travel
    const base = centre.clone().addScaledVector(dv, -along);
    const side = Math.abs(d[1]) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const sep = 0.085 * Math.max(0.7, scale);
    const len = end - start;
    if (len > 0.02) {
      for (const s of [-1, 1]) {
        const mid = base.clone().addScaledVector(side, s * sep).addScaledVector(dv, (start + end) / 2);
        bars.push(box(0.045, 0.045, len, dv, mid));
      }
      // clamp where the bars grip the part
      const clamp = box(sep * 2 + 0.09, 0.07, 0.03, dv, base.clone().addScaledVector(dv, start + 0.015));
      plates.push(clamp);
    }
    // bolt plate on the neighbour's face, with four bolts
    plates.push(box(0.24, 0.24, 0.03, dv, base.clone().addScaledVector(dv, end + 0.005)));
    const other = new THREE.Vector3().crossVectors(dv, side).normalize();
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        const p = base.clone().addScaledVector(dv, end - 0.012).addScaledVector(side, a * 0.08).addScaledVector(other, b * 0.08);
        const bolt = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 6);
        bolt.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv));
        bolt.translate(p.x, p.y, p.z);
        bolts.push(bolt);
      }
    }
  }
  const add = (geos, mat) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  add(bars, mats.steel);
  add(plates, mats.darkSteel);
  add(bolts, mats.chrome);
  return group;
}
