// Instanced grass (wind-animated, chunked for culling), trees and rocks scattered over the valley.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D, fbm, mulberry32 } from '../util/noise.js';
import { barkTexture, leafCardTexture, needleCardTexture } from './textures.js';

export const GRASS_LAYER = 1;
const windUniforms = { uTime: { value: 0 } };

export function updateWind(time) {
  windUniforms.uTime.value = time;
}

function slopeAt(terrain, x, z) {
  const e = 0.6;
  const dx = terrain.height(x + e, z) - terrain.height(x - e, z);
  const dz = terrain.height(x, z + e) - terrain.height(x, z - e);
  return 1 / Math.sqrt(1 + (dx / (2 * e)) ** 2 + (dz / (2 * e)) ** 2); // normal.y
}

function grassClumpGeometry(rand) {
  const blades = 8;
  const pos = [];
  const col = [];
  const nrm = [];
  const idx = [];
  let base = 0;
  for (let b = 0; b < blades; b++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 0.14;
    const ox = Math.cos(a) * r;
    const oz = Math.sin(a) * r;
    const h = 0.22 + rand() * 0.36;
    const w = 0.02 + rand() * 0.014;
    const facing = rand() * Math.PI;
    const fx = Math.cos(facing);
    const fz = Math.sin(facing);
    const bend = (rand() - 0.3) * 0.18;
    const segs = [0, 0.55, 1];
    for (let s = 0; s < segs.length; s++) {
      const t = segs[s];
      const width = w * (1 - t) * (s === segs.length - 1 ? 0 : 1);
      const lean = bend * t * t;
      const cx = ox + -fz * lean;
      const cz = oz + fx * lean;
      const y = h * t;
      pos.push(cx - fx * width, y, cz - fz * width);
      pos.push(cx + fx * width, y, cz + fz * width);
      const shade = 0.3 + 0.72 * t;
      col.push(shade, shade, shade, shade, shade, shade);
      // normals mostly up so grass is lit like the ground it grows on
      nrm.push(-fz * 0.35, 0.93, fx * 0.35, -fz * 0.35, 0.93, fx * 0.35);
    }
    for (let s = 0; s < segs.length - 1; s++) {
      const i0 = base + s * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
    base += segs.length * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function windMaterial(params) {
  // grass normals are faked to point up, so keep specular low or blades glint white at grazing angles
  const m = new THREE.MeshPhysicalMaterial({ specularIntensity: 0.12, ...params });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  vec3 ip = instanceMatrix[3].xyz;
#else
  vec3 ip = vec3(0.0);
#endif
  float hh = position.y;
  float gust = sin(uTime * 0.9 + ip.x * 0.045 + ip.z * 0.03) * 0.5 + 0.5;
  float wv = sin(uTime * 2.1 + ip.x * 0.55 + ip.z * 0.35) * 0.6 + sin(uTime * 3.7 + ip.x * 1.3) * 0.25;
  float bendAmt = hh * hh * (0.5 + 1.6 * gust);
  mvPosition.x += (0.35 + wv * 0.35) * bendAmt;
  mvPosition.z += wv * 0.18 * bendAmt;
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  m.customProgramCacheKey = () => 'wind-grass';
  return m;
}

export function buildGrass(level, terrain, theme, density) {
  const group = new THREE.Group();
  group.name = 'grass';
  if (density <= 0) return group;
  const rand = mulberry32(level.seed * 7 + 1);
  const noise = createNoise2D(level.seed + 77);
  const geo = grassClumpGeometry(mulberry32(5));
  const mat = windMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
  const b = terrain.bounds;
  const chunk = 24;
  const zRange = 44;
  const perSquareMetre = 1.25 * density;
  const g1 = new THREE.Color().setRGB(theme.grass[0], theme.grass[1], theme.grass[2], THREE.SRGBColorSpace);
  const g2 = new THREE.Color().setRGB(theme.grass2[0], theme.grass2[1], theme.grass2[2], THREE.SRGBColorSpace);
  const dry = new THREE.Color().setRGB(0.55, 0.5, 0.25, THREE.SRGBColorSpace);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (let cx = b.x0 + 4; cx < b.x1 - 4; cx += chunk) {
    for (let cz = -zRange; cz < zRange; cz += chunk) {
      const target = Math.floor(chunk * chunk * perSquareMetre);
      const mats = [];
      const cols = [];
      for (let i = 0; i < target * 1.6 && mats.length < target; i++) {
        const x = cx + rand() * chunk;
        const zRel = cz + rand() * chunk;
        const z = terrain.center(x) + zRel;
        if (terrain.roadMask(x, z) > 0.25) continue;
        if (terrain.pitDepth(x) > 0.3) continue;
        const ny = slopeAt(terrain, x, z);
        if (ny < 0.8) continue;
        const h = terrain.height(x, z);
        if (theme.snowLine !== Infinity && h > theme.snowLine - 2) continue;
        // patchy meadows rather than a uniform carpet
        const patch = 0.5 + 0.5 * fbm(noise, x * 0.06, z * 0.06, 2);
        if (rand() > 0.35 + patch * 0.8) continue;
        const sc = 0.7 + rand() * 0.7 + patch * 0.3;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        s.set(sc, sc * (0.8 + rand() * 0.5), sc);
        p.set(x, h - 0.03, z);
        m4.compose(p, q, s);
        mats.push(m4.clone());
        c.copy(g1).lerp(g2, rand() * 0.7 + patch * 0.3);
        if (rand() < 0.12) c.lerp(dry, 0.5);
        cols.push(c.clone());
      }
      if (!mats.length) continue;
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      for (let i = 0; i < mats.length; i++) {
        im.setMatrixAt(i, mats[i]);
        im.setColorAt(i, cols[i]);
      }
      im.receiveShadow = true;
      im.castShadow = false;
      im.layers.set(GRASS_LAYER);
      im.computeBoundingSphere();
      im.userData.centre = new THREE.Vector3(cx + chunk / 2, terrain.height(cx + chunk / 2, terrain.center(cx + chunk / 2)), terrain.center(cx + chunk / 2) + cz + chunk / 2);
      group.add(im);
    }
  }
  return group;
}

// Hide grass chunks far from the camera; fog hides the edge.
export function cullGrass(group, cameraPos, maxDist = 110) {
  const d2 = maxDist * maxDist;
  for (const im of group.children) {
    im.visible = im.userData.centre.distanceToSquared(cameraPos) < d2;
  }
}

function blob(radius, detail, rand, noise, squash = 1) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const off = rand() * 100;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const d = 1 + 0.22 * fbm(noise, n.x * 2 + off, n.y * 2 + n.z * 1.7, 3) + 0.06 * noise(n.x * 9 + off, n.z * 9);
    v.multiplyScalar(d);
    v.y *= squash;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const merged = g.index ? g.toNonIndexed() : g;
  return mergeVerticesSmooth(merged);
}

function mergeVerticesSmooth(g) {
  // Icosahedron comes non-indexed; average normals of coincident vertices for a soft look.
  const p = g.attributes.position;
  const map = new Map();
  const index = [];
  const verts = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      map.set(key, id);
      verts.push(p.getX(i), p.getY(i), p.getZ(i));
    }
    index.push(id);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(index);
  out.computeVertexNormals();
  return out;
}

function colorize(g, color, aoBottom = 0.45, yMin = -1, yMax = 1) {
  const p = g.attributes.position;
  const cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - yMin) / (yMax - yMin), 0, 1);
    const k = aoBottom + (1 - aoBottom) * t;
    cols[i * 3] = color.r * k;
    cols[i * 3 + 1] = color.g * k;
    cols[i * 3 + 2] = color.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

// Builds alpha-tested leaf cards. Normals point away from the canopy centre so the whole crown is
// lit like a soft volume instead of a pile of flat quads.
function cardGeometry(cards, centre, radii) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const col = [];
  const idx = [];
  const n = new THREE.Vector3();
  const cardN = new THREE.Vector3();
  for (const c of cards) {
    const base = pos.length / 3;
    cardN.crossVectors(c.u, c.v).normalize();
    const corners = [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0], [0.5, 0.5, 1, 1], [-0.5, 0.5, 0, 1]];
    for (const [a, b, s, t] of corners) {
      const p = c.p.clone().addScaledVector(c.u, a * c.w).addScaledVector(c.v, b * c.h);
      pos.push(p.x, p.y, p.z);
      n.set((p.x - centre.x) / radii.x, (p.y - centre.y) / radii.y, (p.z - centre.z) / radii.z).normalize();
      if (cardN.dot(n) < 0) cardN.negate();
      n.lerp(cardN, 0.25).normalize();
      nrm.push(n.x, n.y, n.z);
      uv.push(s, t);
      // darker deep inside and underneath the crown
      const depth = Math.min(1, p.clone().sub(centre).divide(radii).length());
      const under = THREE.MathUtils.clamp((p.y - (centre.y - radii.y)) / (2 * radii.y), 0, 1);
      const k = 0.42 + 0.58 * (0.35 + 0.65 * depth) * (0.55 + 0.45 * under);
      col.push(k, k, k);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function randomUnit(rand) {
  const u = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return new THREE.Vector3(r * Math.cos(a), u, r * Math.sin(a));
}

function broadleafTree(seed) {
  const rand = mulberry32(seed);
  const trunkParts = [];
  const H = 3.2 + rand() * 1.6;
  const trunk = new THREE.CylinderGeometry(0.15, 0.3, H + 0.8, 9, 4);
  trunk.translate(0, (H + 0.8) / 2, 0);
  trunkParts.push(trunk);
  const centre = new THREE.Vector3((rand() - 0.5) * 0.4, H + 1.5, (rand() - 0.5) * 0.4);
  const radii = new THREE.Vector3(2.1 + rand() * 0.7, 1.7 + rand() * 0.5, 2.1 + rand() * 0.7);
  for (let i = 0; i < 5; i++) {
    const L = 1.4 + rand() * 0.9;
    const br = new THREE.CylinderGeometry(0.04, 0.1, L, 6);
    br.translate(0, L / 2, 0);
    br.rotateZ(0.55 + rand() * 0.5);
    br.rotateY(rand() * Math.PI * 2);
    br.translate(0, H * (0.6 + rand() * 0.35), 0);
    trunkParts.push(br);
  }
  const cards = [];
  const count = 95;
  for (let i = 0; i < count; i++) {
    const d = randomUnit(rand);
    const r = Math.pow(rand(), 0.35);
    const p = centre.clone().add(d.clone().multiply(radii).multiplyScalar(r));
    // a lumpy crown: a few sub-clumps
    const size = 1.2 + rand() * 0.9;
    const u = randomUnit(rand);
    const v = new THREE.Vector3().crossVectors(u, randomUnit(rand)).normalize();
    cards.push({ p, u: u.normalize(), v, w: size, h: size });
  }
  const leafGeo = cardGeometry(cards, centre, radii);
  const trunkGeo = mergeGeometries(trunkParts.map((g) => g.toNonIndexed()));
  return { trunk: trunkGeo, leaves: leafGeo, kind: 'broad' };
}

function pineTree(seed) {
  const rand = mulberry32(seed);
  const H = 6 + rand() * 3.5;
  const trunk = new THREE.CylinderGeometry(0.08, 0.26, H, 8);
  trunk.translate(0, H / 2, 0);
  const cards = [];
  const whorls = 11;
  const centre = new THREE.Vector3(0, H * 0.5, 0);
  const radii = new THREE.Vector3(1.8, H * 0.5, 1.8);
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = H * (0.18 + t * 0.8);
    const len = 2.4 * (1 - t * 0.85) + 0.35;
    const branches = 6 + Math.floor(rand() * 2);
    for (let b = 0; b < branches; b++) {
      const a = (b / branches) * Math.PI * 2 + rand() * 0.6 + w;
      const out = new THREE.Vector3(Math.cos(a), -0.25 - rand() * 0.2, Math.sin(a)).normalize();
      const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const tilt = new THREE.Vector3().crossVectors(side, out).normalize();
      // card runs from the trunk outwards; v axis along the branch
      const p = new THREE.Vector3(0, y, 0).addScaledVector(out, len / 2);
      const across = side.clone().multiplyScalar(0.8).addScaledVector(tilt, 0.6).normalize();
      cards.push({ p, u: across, v: out, w: len * 0.62, h: len });
    }
  }
  // crown tip
  cards.push({ p: new THREE.Vector3(0, H + 0.2, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0), w: 0.6, h: 1.2 });
  cards.push({ p: new THREE.Vector3(0, H + 0.2, 0), u: new THREE.Vector3(0, 0, 1), v: new THREE.Vector3(0, 1, 0), w: 0.6, h: 1.2 });
  const leafGeo = cardGeometry(cards, centre, radii);
  return { trunk: trunk.toNonIndexed(), leaves: leafGeo, kind: 'pine' };
}

function rockGeometry(seed) {
  const rand = mulberry32(seed);
  const noise = createNoise2D(seed + 3);
  const g = blob(1, 2, rand, noise, 0.6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    // flatten into facets for a chiselled look
    const y = p.getY(i);
    p.setY(i, y < -0.25 ? -0.25 + (y + 0.25) * 0.2 : y);
  }
  g.computeVertexNormals();
  colorize(g, new THREE.Color(1, 1, 1), 0.55, -0.4, 0.6);
  return g;
}

export function buildScatter(level, terrain, theme, quality) {
  const group = new THREE.Group();
  group.name = 'scatter';
  const rand = mulberry32(level.seed * 13 + 3);
  const b = terrain.bounds;
  const half = level.trackHalf ?? 7;
  const bark = barkTexture();
  const trunkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.92 });
  const leafParams = { vertexColors: true, roughness: 0.72, specularIntensity: 0.3, alphaTest: 0.45, side: THREE.DoubleSide };
  const leafMats = {
    broad: new THREE.MeshPhysicalMaterial({ ...leafParams, map: leafCardTexture() }),
    pine: new THREE.MeshPhysicalMaterial({ ...leafParams, map: needleCardTexture() }),
  };
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });

  const variants = [];
  for (let i = 0; i < 3; i++) variants.push(theme.pines ? pineTree(level.seed + i * 17) : broadleafTree(level.seed + i * 17));
  if (theme.pines) variants.push(broadleafTree(level.seed + 99));

  // the leaf textures carry the greens; instance colours only nudge the tint per tree
  const leafA = new THREE.Color(0.85, 0.9, 0.8);
  const leafB = new THREE.Color(1.1, 1.08, 0.85);
  const autumn = new THREE.Color(1.6, 1.0, 0.45);

  const trees = variants.map(() => []);
  const want = Math.round((b.x1 - b.x0) * 1.6 * theme.trees * quality.trees);
  let tries = 0;
  const placed = [];
  while (placed.length < want && tries < want * 12) {
    tries++;
    const x = b.x0 + 8 + rand() * (b.x1 - b.x0 - 16);
    const side = rand() < 0.5 ? -1 : 1;
    const off = half + 4 + Math.pow(rand(), 0.8) * 70;
    const z = terrain.center(x) + side * off;
    if (terrain.pitDepth(x) > 0.2) continue;
    const ny = slopeAt(terrain, x, z);
    if (ny < 0.75) continue;
    const h = terrain.height(x, z);
    if (theme.snowLine !== Infinity && h > theme.snowLine + 4) continue;
    if (placed.some((p) => Math.abs(p[0] - x) < 3.2 && Math.abs(p[1] - z) < 3.2)) continue;
    placed.push([x, z]);
    const v = Math.floor(rand() * variants.length);
    trees[v].push({ x, z, y: h - 0.15, s: 0.75 + rand() * 0.6, r: rand() * Math.PI * 2 });
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  variants.forEach((vg, vi) => {
    const list = trees[vi];
    if (!list.length) return;
    const trunks = new THREE.InstancedMesh(vg.trunk, trunkMat, list.length);
    const leaves = new THREE.InstancedMesh(vg.leaves, leafMats[vg.kind], list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, t.r);
      m4.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + (i % 5) * 0.05), t.s));
      trunks.setMatrixAt(i, m4);
      leaves.setMatrixAt(i, m4);
      const pine = vg.kind === 'pine';
      c.copy(leafA).lerp(leafB, rand());
      if (!pine && rand() < 0.07) c.lerp(autumn, 0.5);
      leaves.setColorAt(i, c);
    });
    for (const im of [trunks, leaves]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  });

  // rocks
  const rockVariants = [rockGeometry(level.seed + 1), rockGeometry(level.seed + 2), rockGeometry(level.seed + 3)];
  const rockLists = rockVariants.map(() => []);
  const rockCount = Math.round((b.x1 - b.x0) * 0.7);
  for (let i = 0; i < rockCount * 3 && rockLists.flat().length < rockCount; i++) {
    const x = b.x0 + 6 + rand() * (b.x1 - b.x0 - 12);
    const side = rand() < 0.5 ? -1 : 1;
    const off = half + 1.5 + rand() * 60;
    const z = terrain.center(x) + side * off;
    const ny = slopeAt(terrain, x, z);
    const pit = terrain.pitDepth(x);
    // more rocks on slopes and along canyon rims
    if (ny > 0.9 && rand() > 0.25 && pit < 0.1) continue;
    const s = (0.25 + Math.pow(rand(), 3) * 1.8) * (ny < 0.8 ? 1.4 : 1);
    rockLists[Math.floor(rand() * 3)].push({ x, z, y: terrain.height(x, z) - s * 0.15, s, r: rand() * Math.PI * 2 });
  }
  const rockTint = new THREE.Color().setRGB(theme.rock[0], theme.rock[1], theme.rock[2], THREE.SRGBColorSpace);
  rockVariants.forEach((g, vi) => {
    const list = rockLists[vi];
    if (!list.length) return;
    const im = new THREE.InstancedMesh(g, rockMat, list.length);
    list.forEach((r, i) => {
      q.setFromEuler(new THREE.Euler(rand() * 0.4, r.r, rand() * 0.4));
      m4.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.s, r.s * (0.7 + rand() * 0.5), r.s * (0.8 + rand() * 0.4)));
      im.setMatrixAt(i, m4);
      c.copy(rockTint).multiplyScalar(0.75 + rand() * 0.4);
      im.setColorAt(i, c);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}
