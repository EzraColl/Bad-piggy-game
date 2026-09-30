// Detailed procedural models for every buildable part. Each builder returns an Object3D centred
// on its build cell (1 m cube) with +X as forward and +Y as up.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { woodTextures, metalTextures, tireTextures, tntTexture, crateTextures } from './textures.js';
import { WHEEL_RADIUS, WHEEL_HALF_WIDTH, WHEEL_DROP } from '../game/parts.js';

let M = null;

export function partMaterials() {
  if (M) return M;
  const wood = woodTextures();
  const metal = metalTextures();
  const tire = tireTextures();
  M = {
    wood: new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.74, color: 0xffffff }),
    steel: new THREE.MeshStandardMaterial({ color: 0xa7afb8, metalness: 1, roughness: 0.34, roughnessMap: metal.roughnessMap, normalMap: metal.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.85, roughness: 0.42, roughnessMap: metal.roughnessMap }),
    iron: new THREE.MeshStandardMaterial({ color: 0x24272b, metalness: 0.7, roughness: 0.55 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe9edf2, metalness: 1, roughness: 0.07 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.28 }),
    paintRed: new THREE.MeshPhysicalMaterial({ color: 0xb8201a, roughness: 0.32, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06 }),
    paintYellow: new THREE.MeshPhysicalMaterial({ color: 0xf0b21d, roughness: 0.35, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tire.map, normalMap: tire.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.92 }),
    rubberPlain: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 }),
    pigSkin: new THREE.MeshPhysicalMaterial({ color: 0x5fae2e, roughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(0xb8f090), sheenRoughness: 0.6, clearcoat: 0.12, clearcoatRoughness: 0.5 }),
    pigSnout: new THREE.MeshPhysicalMaterial({ color: 0x7cc84a, roughness: 0.5, sheen: 0.5, sheenColor: new THREE.Color(0xeaffd8), clearcoat: 0.2 }),
    pigDark: new THREE.MeshStandardMaterial({ color: 0x2f5a1c, roughness: 0.6 }),
    eyeWhite: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.02 }),
    pupil: new THREE.MeshPhysicalMaterial({ color: 0x0c0c0c, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.62 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fd6ff, roughness: 0.02, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.45 }),
    balloon: new THREE.MeshPhysicalMaterial({ color: 0xe3261f, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.4, sheenColor: new THREE.Color(0xff9b8f) }),
    string: new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.9 }),
    bottle: new THREE.MeshPhysicalMaterial({ color: 0x2f9a4c, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, metalness: 0, sheen: 0.2 }),
    label: new THREE.MeshStandardMaterial({ color: 0xd8342a, roughness: 0.5 }),
    labelWhite: new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5 }),
    tnt: new THREE.MeshStandardMaterial({ map: tntTexture(), normalMap: crateTextures().normalMap, roughness: 0.7 }),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2.6, 0.7), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    flameCore: new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8, 6), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  };
  return M;
}

// Box beam from a to b (axis aligned), with UVs following the grain.
function beam(len, t, axis, pos) {
  const g = new THREE.BoxGeometry(len, t, t);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len * 0.9, uv.getY(i) * 0.22 + Math.random() * 0.7);
  if (axis === 'y') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateY(Math.PI / 2);
  g.translate(pos[0], pos[1], pos[2]);
  return g;
}

function frameGeometry(t, inset = 0.5) {
  const e = inset - t / 2;
  const L = inset * 2;
  const parts = [];
  for (const a of [-e, e]) {
    for (const b of [-e, e]) {
      parts.push(beam(L, t, 'x', [0, a, b]));
      parts.push(beam(L - 2 * t, t, 'y', [a, 0, b]));
      parts.push(beam(L - 2 * t, t, 'z', [a, b, 0]));
    }
  }
  return parts;
}

function mesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function buildWood() {
  const mats = partMaterials();
  const g = new THREE.Group();
  const t = 0.13;
  const parts = frameGeometry(t, 0.49);
  // diagonal braces on the two sides
  for (const z of [-0.49 + t / 2, 0.49 - t / 2]) {
    const d = beam(Math.SQRT2 * (0.98 - 2 * t), t * 0.8, 'x', [0, 0, 0]);
    d.rotateZ(Math.PI / 4 * (z > 0 ? 1 : -1));
    d.translate(0, 0, z);
    parts.push(d);
  }
  // floor slats
  for (let i = -1; i <= 1; i++) parts.push(beam(0.98 - 2 * t, 0.05, 'z', [i * 0.24, -0.49 + 0.04, 0]).scale(1, 1, 1));
  g.add(mesh(mergeGeometries(parts), mats.wood));
  // steel corner brackets
  const b = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const c = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    c.translate(x * 0.42, y * 0.42, z * 0.42);
    b.push(c);
  }
  g.add(mesh(mergeGeometries(b), mats.iron));
  return g;
}

function buildMetal() {
  const mats = partMaterials();
  const g = new THREE.Group();
  const t = 0.11;
  const parts = frameGeometry(t, 0.49);
  for (const z of [-0.49 + t / 2, 0.49 - t / 2]) {
    for (const s of [1, -1]) {
      const d = new THREE.BoxGeometry(Math.SQRT2 * 0.78, 0.05, 0.05);
      d.rotateZ((Math.PI / 4) * s);
      d.translate(0, 0, z);
      parts.push(d);
    }
  }
  g.add(mesh(mergeGeometries(parts), mats.steel));
  const bolts = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const plate = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    plate.translate(x * 0.405, y * 0.405, z * 0.405);
    bolts.push(plate);
  }
  g.add(mesh(mergeGeometries(bolts), mats.darkSteel));
  const rivets = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const r = new THREE.SphereGeometry(0.03, 8, 6);
    r.translate(x * 0.5, y * 0.44, z * 0.44);
    rivets.push(r);
  }
  g.add(mesh(mergeGeometries(rivets), mats.chrome));
  return g;
}

export function buildWheelMesh() {
  const mats = partMaterials();
  const g = new THREE.Group();
  const R = WHEEL_RADIUS;
  const W = WHEEL_HALF_WIDTH;
  // tyre cross-section revolved around Y, then turned so the axle is Z
  const prof = [];
  const rim = 0.3;
  const steps = 10;
  prof.push(new THREE.Vector2(rim, -W * 0.92));
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI;
    const sh = 0.07;
    // rounded shoulder profile
    const y = Math.sin(a) * W;
    const r = R - sh + Math.cos(a) * sh * (Math.abs(Math.sin(a)) > 0.7 ? 1 : 1);
    prof.push(new THREE.Vector2(Math.max(r, R - 0.075 - (1 - Math.cos(a)) * 0.06), y));
  }
  prof.push(new THREE.Vector2(rim, W * 0.92));
  const tyreGeo = new THREE.LatheGeometry(prof, 64);
  tyreGeo.rotateX(Math.PI / 2);
  const tyre = mesh(tyreGeo, mats.rubber);
  mats.rubber.map.repeat.set(1, 1);
  g.add(tyre);
  // rim barrel
  const barrel = new THREE.CylinderGeometry(rim, rim, W * 1.7, 40, 1, true);
  barrel.rotateX(Math.PI / 2);
  g.add(mesh(barrel, mats.steel));
  // spokes + faces on both sides
  const spokes = [];
  for (const side of [-1, 1]) {
    const disc = new THREE.CylinderGeometry(rim * 0.98, rim * 0.98, 0.02, 40);
    disc.rotateX(Math.PI / 2);
    disc.translate(0, 0, side * W * 0.55);
    spokes.push(disc);
  }
  g.add(mesh(mergeGeometries(spokes), mats.darkSteel));
  const bright = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const s = new THREE.BoxGeometry(0.05, rim * 0.95, 0.03);
      s.translate(0, rim * 0.48, 0);
      s.rotateZ((i / 5) * Math.PI * 2);
      s.translate(0, 0, side * (W * 0.55 + 0.02));
      bright.push(s);
    }
    const lip = new THREE.TorusGeometry(rim, 0.022, 8, 48);
    lip.translate(0, 0, side * W * 0.86);
    bright.push(lip);
  }
  g.add(mesh(mergeGeometries(bright), mats.chrome));
  const hub = new THREE.CylinderGeometry(0.075, 0.09, W * 2.3, 24);
  hub.rotateX(Math.PI / 2);
  g.add(mesh(hub, mats.chrome));
  const nuts = [];
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const n = new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6);
    n.rotateX(Math.PI / 2);
    const a = (i / 5) * Math.PI * 2 + 0.6;
    n.translate(Math.cos(a) * 0.12, Math.sin(a) * 0.12, side * (W * 0.62 + 0.03));
    nuts.push(n);
  }
  g.add(mesh(mergeGeometries(nuts), mats.brass));
  return g;
}

function buildWheel() {
  // in the build grid the wheel sits a little below its cell centre, like it will on the car
  const g = new THREE.Group();
  const w = buildWheelMesh();
  w.position.y = -WHEEL_DROP;
  g.add(w);
  return g;
}

function buildEngine() {
  const mats = partMaterials();
  const g = new THREE.Group();
  const shaker = new THREE.Group();
  shaker.name = 'shaker';
  g.add(shaker);
  const block = mesh(new RoundedBoxGeometry(0.62, 0.42, 0.44, 3, 0.05), mats.darkSteel);
  block.position.y = -0.14;
  shaker.add(block);
  const pan = mesh(new RoundedBoxGeometry(0.56, 0.12, 0.36, 2, 0.03), mats.iron);
  pan.position.y = -0.38;
  shaker.add(pan);
  // two cylinder banks in a V with red valve covers
  for (const s of [-1, 1]) {
    const bank = new THREE.Group();
    bank.position.set(0, 0.08, s * 0.13);
    bank.rotation.x = s * 0.62;
    const head = mesh(new RoundedBoxGeometry(0.6, 0.18, 0.2, 2, 0.03), mats.darkSteel);
    head.position.y = 0.06;
    bank.add(head);
    const cover = mesh(new RoundedBoxGeometry(0.62, 0.1, 0.19, 3, 0.04), mats.paintRed);
    cover.position.y = 0.18;
    bank.add(cover);
    const ribs = [];
    for (let i = 0; i < 5; i++) {
      const r = new THREE.BoxGeometry(0.02, 0.03, 0.15);
      r.translate(-0.22 + i * 0.11, 0.245, 0);
      ribs.push(r);
    }
    bank.add(mesh(mergeGeometries(ribs), mats.chrome));
    // exhaust header
    const pts = [];
    for (let i = 0; i < 4; i++) pts.push(new THREE.Vector3(-0.2 + i * 0.13, 0.02, s * 0.12));
    const pipes = [];
    for (const p of pts) {
      const curve = new THREE.CatmullRomCurve3([
        p.clone(),
        p.clone().add(new THREE.Vector3(0, -0.02, s * 0.07)),
        new THREE.Vector3(p.x * 0.6 - 0.12, -0.14, s * 0.22),
      ]);
      pipes.push(new THREE.TubeGeometry(curve, 10, 0.022, 8));
    }
    bank.add(mesh(mergeGeometries(pipes), mats.chrome));
    shaker.add(bank);
  }
  // air filter + blower on top
  const blower = mesh(new RoundedBoxGeometry(0.34, 0.1, 0.2, 2, 0.03), mats.chrome);
  blower.position.y = 0.3;
  shaker.add(blower);
  const filter = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.07, 32), mats.darkSteel);
  filter.position.y = 0.39;
  shaker.add(filter);
  const filterTop = mesh(new THREE.CylinderGeometry(0.12, 0.155, 0.02, 32), mats.chrome);
  filterTop.position.y = 0.435;
  shaker.add(filterTop);
  // front pulley and belt that spin
  const pulley = new THREE.Group();
  pulley.name = 'pulley';
  pulley.position.set(0.33, -0.1, 0);
  const wheelGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.04, 24);
  wheelGeo.rotateZ(Math.PI / 2);
  pulley.add(mesh(wheelGeo, mats.chrome));
  const spoke = new THREE.BoxGeometry(0.045, 0.17, 0.03);
  pulley.add(mesh(spoke, mats.darkSteel));
  shaker.add(pulley);
  const fanBlades = new THREE.Group();
  fanBlades.name = 'fan';
  fanBlades.position.set(0.37, 0.08, 0);
  for (let i = 0; i < 6; i++) {
    const b = mesh(new THREE.BoxGeometry(0.01, 0.13, 0.05), mats.iron);
    b.position.y = 0.075;
    const piv = new THREE.Group();
    piv.rotation.x = (i / 6) * Math.PI * 2;
    b.rotation.y = 0.4;
    piv.add(b);
    fanBlades.add(piv);
  }
  shaker.add(fanBlades);
  // mounting skids so it bolts to neighbours
  const skid = mesh(new THREE.BoxGeometry(0.9, 0.06, 0.1), mats.iron);
  skid.position.set(0, -0.46, 0.2);
  g.add(skid);
  const skid2 = skid.clone();
  skid2.position.z = -0.2;
  g.add(skid2);
  return g;
}

export function buildPigMesh() {
  const mats = partMaterials();
  const g = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.4, 48, 32), mats.pigSkin);
  body.scale.set(1, 0.93, 1);
  g.add(body);
  // snout
  const snoutGeo = new THREE.CylinderGeometry(0.15, 0.165, 0.13, 36);
  snoutGeo.rotateZ(-Math.PI / 2);
  const snout = mesh(snoutGeo, mats.pigSnout);
  snout.position.set(0.39, -0.04, 0);
  g.add(snout);
  const snoutFace = mesh(new THREE.SphereGeometry(0.15, 32, 16), mats.pigSnout);
  snoutFace.scale.set(0.25, 1, 1);
  snoutFace.position.set(0.455, -0.04, 0);
  g.add(snoutFace);
  for (const s of [-1, 1]) {
    const nostril = mesh(new THREE.SphereGeometry(0.034, 16, 12), mats.pigDark);
    nostril.scale.set(0.5, 1.25, 0.85);
    nostril.position.set(0.487, -0.035, s * 0.058);
    g.add(nostril);
    // eyes
    const eye = mesh(new THREE.SphereGeometry(0.105, 32, 20), mats.eyeWhite);
    eye.position.set(0.28, 0.14, s * 0.155);
    g.add(eye);
    const pupil = mesh(new THREE.SphereGeometry(0.045, 20, 14), mats.pupil);
    pupil.position.set(0.37, 0.15, s * 0.14);
    g.add(pupil);
    // eyebrows
    const brow = mesh(new RoundedBoxGeometry(0.03, 0.035, 0.14, 2, 0.012), mats.pigDark);
    brow.position.set(0.33, 0.265, s * 0.15);
    brow.rotation.x = s * -0.25;
    g.add(brow);
    // ears
    const earGeo = new THREE.ConeGeometry(0.075, 0.14, 20);
    const ear = mesh(earGeo, mats.pigSkin);
    ear.position.set(0.02, 0.35, s * 0.21);
    ear.rotation.x = s * 0.55;
    ear.rotation.z = -0.25;
    g.add(ear);
    // cheek bumps
    const cheek = mesh(new THREE.SphereGeometry(0.1, 20, 14), mats.pigSkin);
    cheek.position.set(0.26, -0.13, s * 0.22);
    g.add(cheek);
  }
  // aviator goggles pushed up on the forehead, held by a leather strap
  const strapGeo = new THREE.TorusGeometry(0.405, 0.024, 10, 64);
  strapGeo.rotateX(Math.PI / 2);
  const strap = mesh(strapGeo, mats.leather);
  strap.rotation.z = -0.5;
  strap.position.set(0.03, 0.05, 0);
  strap.scale.set(1, 1, 1.02);
  g.add(strap);
  for (const s of [-1, 1]) {
    const cupGeo = new THREE.CylinderGeometry(0.075, 0.085, 0.07, 24);
    cupGeo.rotateZ(Math.PI / 2);
    const cup = mesh(cupGeo, mats.brass);
    cup.position.set(0.3, 0.27, s * 0.095);
    cup.rotation.z = 0.95;
    g.add(cup);
    const lens = mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.02, 24), mats.glass);
    lens.rotation.z = Math.PI / 2 + 0.95;
    lens.position.set(0.328, 0.29, s * 0.095);
    lens.castShadow = false;
    g.add(lens);
  }
  const tail = mesh(new THREE.TorusGeometry(0.05, 0.015, 8, 20, Math.PI * 1.6), mats.pigSkin);
  tail.position.set(-0.41, 0.02, 0);
  tail.rotation.y = Math.PI / 2;
  g.add(tail);
  return g;
}

function buildPig() {
  const mats = partMaterials();
  const g = new THREE.Group();
  const pig = buildPigMesh();
  pig.name = 'pig';
  pig.position.y = 0.03;
  g.add(pig);
  const seat = mesh(new RoundedBoxGeometry(0.62, 0.07, 0.62, 2, 0.02), mats.wood);
  seat.position.y = -0.44;
  g.add(seat);
  return g;
}

export function buildBalloonMesh() {
  const mats = partMaterials();
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = t * Math.PI;
    // teardrop: slightly narrower at the bottom
    const r = Math.sin(a) * (0.5 + 0.08 * (1 - t)) * (t < 0.1 ? 0.9 + t : 1);
    pts.push(new THREE.Vector2(Math.max(0.001, r * (1 - 0.18 * Math.pow(1 - t, 3))), -Math.cos(a) * 0.62));
  }
  const b = mesh(new THREE.LatheGeometry(pts, 48), mats.balloon);
  b.name = 'skin';
  g.add(b);
  const knot = mesh(new THREE.ConeGeometry(0.05, 0.08, 12), mats.balloon);
  knot.position.y = -0.65;
  g.add(knot);
  return g;
}

function buildBalloon() {
  const mats = partMaterials();
  const g = new THREE.Group();
  const base = mesh(new RoundedBoxGeometry(0.44, 0.12, 0.44, 2, 0.03), mats.wood);
  base.position.y = -0.4;
  g.add(base);
  const hook = mesh(new THREE.TorusGeometry(0.06, 0.015, 8, 20), mats.brass);
  hook.position.y = -0.3;
  g.add(hook);
  // in build mode the balloon floats right above its cell
  const balloon = buildBalloonMesh();
  balloon.name = 'balloon';
  balloon.position.y = 0.72;
  balloon.scale.setScalar(0.85);
  g.add(balloon);
  const str = mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 5), mats.string);
  str.name = 'string';
  str.castShadow = false;
  g.add(str);
  setString(str, new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, 0.72 - 0.55, 0));
  return g;
}

const _up = new THREE.Vector3(0, 1, 0);
export function setString(str, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  str.position.copy(a).addScaledVector(d, 0.5);
  str.scale.set(1, Math.max(0.001, len), 1);
  str.quaternion.setFromUnitVectors(_up, d.normalize());
}

function buildFan() {
  const mats = partMaterials();
  const g = new THREE.Group();
  const frame = mesh(new RoundedBoxGeometry(0.5, 0.08, 0.5, 2, 0.02), mats.darkSteel);
  frame.position.set(0.05, -0.44, 0);
  g.add(frame);
  const post = mesh(new THREE.BoxGeometry(0.08, 0.44, 0.08), mats.darkSteel);
  post.position.set(0.1, -0.2, 0);
  g.add(post);
  const motorGeo = new THREE.CylinderGeometry(0.13, 0.14, 0.34, 28);
  motorGeo.rotateZ(Math.PI / 2);
  const motor = mesh(motorGeo, mats.paintYellow);
  motor.position.set(0.08, 0, 0);
  g.add(motor);
  const cool = [];
  for (let i = 0; i < 6; i++) {
    const r = new THREE.TorusGeometry(0.142, 0.01, 6, 28);
    r.rotateY(Math.PI / 2);
    r.translate(0.0 + i * 0.045, 0, 0);
    cool.push(r);
  }
  g.add(mesh(mergeGeometries(cool), mats.darkSteel));
  const rotor = new THREE.Group();
  rotor.name = 'rotor';
  rotor.position.set(-0.14, 0, 0);
  const spinner = new THREE.SphereGeometry(0.075, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  spinner.rotateZ(Math.PI / 2);
  rotor.add(mesh(spinner, mats.chrome));
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.SphereGeometry(0.2, 20, 8);
    blade.scale(0.05, 1, 0.26);
    blade.translate(0, 0.2, 0);
    const bm = mesh(blade, mats.wood);
    bm.rotation.y = 0.45;
    const piv = new THREE.Group();
    piv.rotation.x = (i / 3) * Math.PI * 2;
    piv.add(bm);
    rotor.add(piv);
  }
  g.add(rotor);
  // guard ring
  const ringGeo = new THREE.TorusGeometry(0.45, 0.018, 8, 56);
  ringGeo.rotateY(Math.PI / 2);
  const ring = mesh(ringGeo, mats.steel);
  ring.position.x = -0.14;
  g.add(ring);
  return g;
}

function buildRocket() {
  const mats = partMaterials();
  const g = new THREE.Group();
  // soda bottle lying along X with the cap pointing backwards
  const prof = [
    [0.0, -0.4], [0.1, -0.4], [0.13, -0.37], [0.14, -0.3], [0.14, 0.12], [0.12, 0.2],
    [0.07, 0.28], [0.045, 0.31], [0.045, 0.35], [0.0, 0.35],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bottleGeo = new THREE.LatheGeometry(prof, 40);
  bottleGeo.rotateZ(Math.PI / 2); // +Y (neck) -> -X
  const bottle = mesh(bottleGeo, mats.bottle);
  g.add(bottle);
  const labelGeo = new THREE.CylinderGeometry(0.143, 0.143, 0.2, 40, 1, true);
  labelGeo.rotateZ(Math.PI / 2);
  const label = mesh(labelGeo, mats.label);
  label.position.x = 0.02;
  g.add(label);
  const band = new THREE.CylinderGeometry(0.1445, 0.1445, 0.04, 40, 1, true);
  band.rotateZ(Math.PI / 2);
  const bandM = mesh(band, mats.labelWhite);
  bandM.position.x = 0.02;
  g.add(bandM);
  const capGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 20);
  capGeo.rotateZ(Math.PI / 2);
  const cap = mesh(capGeo, mats.paintRed);
  cap.position.x = -0.37;
  g.add(cap);
  const fins = [];
  for (let i = 0; i < 3; i++) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.22, 0);
    shape.lineTo(0.04, 0.14);
    shape.lineTo(0, 0.14);
    const f = new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false });
    f.translate(-0.02, 0.1, -0.0075);
    f.rotateX((i / 3) * Math.PI * 2);
    f.translate(-0.3, 0, 0);
    fins.push(f);
  }
  g.add(mesh(mergeGeometries(fins), mats.paintRed));
  // strap that bolts it down
  const strap = new THREE.TorusGeometry(0.15, 0.02, 8, 30);
  strap.rotateY(Math.PI / 2);
  const s1 = mesh(strap, mats.darkSteel);
  s1.position.x = 0.15;
  g.add(s1);
  const s2 = s1.clone();
  s2.position.x = -0.15;
  g.add(s2);
  // flame (hidden until fired)
  const flame = new THREE.Group();
  flame.name = 'flame';
  flame.visible = false;
  const outer = new THREE.ConeGeometry(0.075, 0.7, 20, 1, true);
  outer.rotateZ(Math.PI / 2);
  outer.translate(-0.35 - 0.4, 0, 0);
  const o = new THREE.Mesh(outer, mats.flame);
  flame.add(o);
  const inner = new THREE.ConeGeometry(0.04, 0.35, 16, 1, true);
  inner.rotateZ(Math.PI / 2);
  inner.translate(-0.35 - 0.2, 0, 0);
  flame.add(new THREE.Mesh(inner, mats.flameCore));
  g.add(flame);
  return g;
}

function buildTnt() {
  const mats = partMaterials();
  const g = new THREE.Group();
  const box = mesh(new RoundedBoxGeometry(0.8, 0.8, 0.8, 2, 0.03), mats.tnt);
  g.add(box);
  const fuse = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6), mats.string);
  fuse.position.set(0.1, 0.48, 0.1);
  fuse.rotation.z = 0.4;
  g.add(fuse);
  return g;
}

const BUILDERS = {
  wood: buildWood,
  metal: buildMetal,
  wheel: buildWheel,
  engine: buildEngine,
  pig: buildPig,
  balloon: buildBalloon,
  fan: buildFan,
  rocket: buildRocket,
  tnt: buildTnt,
};

const templates = new Map();

// Returns a fresh copy of a part model (geometry and materials are shared).
export function createPartMesh(type) {
  if (!templates.has(type)) templates.set(type, BUILDERS[type]());
  const clone = templates.get(type).clone(true);
  clone.userData.partType = type;
  return clone;
}

// Renders a small picture of every part for the build palette.
export function renderThumbnails(types, size = 112) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(r);
  const envScene = new THREE.Scene();
  const envGeo = new THREE.SphereGeometry(10, 16, 8);
  const envMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec3 p; void main(){ float t = normalize(p).y*0.5+0.5; gl_FragColor = vec4(mix(vec3(0.35,0.3,0.28), vec3(1.2,1.25,1.4), t), 1.); }',
  });
  envScene.add(new THREE.Mesh(envGeo, envMat));
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 2.5);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  cam.position.set(1.6, 1.25, 2.4);
  cam.lookAt(0, -0.02, 0);
  const out = {};
  for (const type of types) {
    const m = createPartMesh(type);
    if (type === 'balloon') {
      m.getObjectByName('balloon').position.y = 0.35;
      m.getObjectByName('balloon').scale.setScalar(0.6);
      m.getObjectByName('string').visible = false;
    }
    if (type === 'wheel') m.children[0].position.y = 0;
    m.position.y = type === 'balloon' ? -0.05 : 0;
    scene.add(m);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    out[type] = c.toDataURL('image/png');
    scene.remove(m);
  }
  pm.dispose();
  r.dispose();
  r.forceContextLoss?.();
  return out;
}
