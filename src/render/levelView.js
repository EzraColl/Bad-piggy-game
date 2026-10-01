// Everything visible in a level apart from the player's contraption: terrain, plants, props,
// the finish gate and the bonus star.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTerrainMeshes } from './terrainView.js';
import { buildGrass, buildScatter, cullGrass, cullScatter, buildTopDecor } from './vegetation.js';
import { crateTextures, tntTexture, woodTextures, hayTexture, checkerTexture, signTexture } from './textures.js';
import { goalPoint, finishHalfWidth } from '../game/simulation.js';
import { createNoise2D, fbm } from '../util/noise.js';

function shadowed(m) {
  m.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return m;
}

let propMats = null;
function materials() {
  if (propMats) return propMats;
  const crate = crateTextures();
  const wood = woodTextures();
  propMats = {
    crate: new THREE.MeshStandardMaterial({ map: crate.map, normalMap: crate.normalMap, roughness: 0.78 }),
    tnt: new THREE.MeshStandardMaterial({ map: tntTexture(), normalMap: crate.normalMap, roughness: 0.66 }),
    wood: new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughness: 0.8 }),
    hay: new THREE.MeshStandardMaterial({ map: hayTexture(), roughness: 0.95 }),
    drum: new THREE.MeshPhysicalMaterial({ color: 0x1d5fa8, metalness: 0.6, roughness: 0.38, clearcoat: 0.6 }),
    pole: new THREE.MeshStandardMaterial({ color: 0xe8e4dc, metalness: 0.2, roughness: 0.4 }),
    checker: new THREE.MeshStandardMaterial({ map: checkerTexture(12, 2), roughness: 0.6, side: THREE.DoubleSide }),
    checkerGround: new THREE.MeshStandardMaterial({ map: checkerTexture(2, 16), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xd83a2a, roughness: 0.6, side: THREE.DoubleSide }),
    rock: new THREE.MeshStandardMaterial({ color: 0x8a837a, roughness: 0.9 }),
    gold: new THREE.MeshPhysicalMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.18, emissive: 0xffa21a, emissiveIntensity: 0.45, clearcoat: 1 }),
  };
  return propMats;
}

function wedgeGeometry(L, W, H) {
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, -0.6);
  shape.lineTo(L / 2, -0.6);
  shape.lineTo(L / 2, H);
  shape.lineTo(-L / 2, 0);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
  g.translate(0, 0, -W / 2);
  // UVs from world-ish coordinates so the planks read correctly
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.25 + p.getY(i) * 0.1, p.getZ(i) * 0.35);
  g.computeVertexNormals();
  return g;
}

function starGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.28 : 0.62;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.08, bevelSegments: 3 });
  g.translate(0, 0, -0.08);
  g.computeVertexNormals();
  return g;
}

function boulderGeometry(r, seed) {
  const g = new THREE.IcosahedronGeometry(r, 3);
  const noise = createNoise2D(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    v.multiplyScalar(1 + 0.13 * fbm(noise, n.x * 2.5 + n.y, n.z * 2.5 - n.y, 4));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class LevelView {
  constructor(level, terrain, phys, theme, quality) {
    this.level = level;
    this.theme = theme;
    this.terrain = terrain;
    this.phys = phys;
    this.group = new THREE.Group();
    this.group.name = 'level';
    const { near, far } = buildTerrainMeshes(level, terrain, theme);
    this.terrainNear = near;
    this.terrainFar = far;
    this.group.add(near, far);
    this.grass = buildGrass(level, terrain, theme, quality.grass);
    this.grassDist = quality.grassDist ?? 100;
    this.treeDist = quality.treeDist ?? 250;
    this.group.add(this.grass);
    this.scatter = buildScatter(level, terrain, theme, quality);
    this.group.add(this.scatter);
    this.propMeshes = new Map();
    this.buildProps();
    this.buildFinish();
    this.buildStar();
    this.time = 0;
  }

  setPhysics(phys, pose = null) {
    // a fresh physics world was created for a retry: rebuild dynamic props
    for (const m of this.propMeshes.values()) {
      this.group.remove(m);
      // islands and spires are rebuilt per run: free their one-off geometry
      if (m.userData.worldPlaced) m.traverse((o) => o.isMesh && !o.isInstancedMesh && o.geometry.dispose());
    }
    this.propMeshes.clear();
    this.phys = phys;
    this.pose = pose;
    this.buildProps();
    this.star.visible = !!this.level.star;
  }

  buildProps() {
    const mats = materials();
    for (const prop of this.phys.props) {
      const def = prop.def;
      let obj;
      switch (def.type) {
        case 'crate': {
          const s = def.size ?? 1;
          obj = new THREE.Mesh(new RoundedBoxGeometry(s, s, s, 2, 0.025), mats.crate);
          break;
        }
        case 'tnt':
          obj = new THREE.Mesh(new RoundedBoxGeometry(0.88, 0.88, 0.88, 2, 0.025), mats.tnt);
          break;
        case 'barrel': {
          const g = new THREE.Group();
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 28), mats.drum));
          for (const y of [-0.22, 0.22]) {
            const rib = new THREE.Mesh(new THREE.TorusGeometry(0.322, 0.018, 8, 28), mats.drum);
            rib.rotation.x = Math.PI / 2;
            rib.position.y = y;
            g.add(rib);
          }
          obj = g;
          break;
        }
        case 'hay': {
          const g = new THREE.CylinderGeometry(0.62, 0.62, 1.1, 32, 1);
          obj = new THREE.Mesh(g, mats.hay);
          break;
        }
        case 'ramp':
          obj = new THREE.Mesh(wedgeGeometry(def.len ?? 6, def.width ?? 4, def.height ?? 1.8), mats.wood);
          break;
        case 'fence': {
          const L = def.len ?? 10;
          const parts = [];
          for (let x = -L / 2; x <= L / 2 + 0.01; x += 2) {
            const post = new THREE.BoxGeometry(0.12, 1.2, 0.12);
            post.translate(x, 0.05, 0);
            parts.push(post);
          }
          for (const y of [0.05, 0.4]) {
            const rail = new THREE.BoxGeometry(L, 0.1, 0.05);
            rail.translate(0, y, 0.07);
            parts.push(rail);
          }
          obj = new THREE.Mesh(mergeGeometries(parts), mats.wood);
          break;
        }
        case 'boulder':
          obj = new THREE.Mesh(boulderGeometry(def.r ?? 1.5, Math.round(def.x)), mats.rock);
          break;
        case 'island':
        case 'spire':
          obj = this._skyRock(prop);
          break;
        case 'sign': {
          const g = new THREE.Group();
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2, 10), mats.wood);
          g.add(post);
          const text = this.level.id === 'meadow' ? 'GO!' : this.level.id === 'mesa' ? 'UP!' : 'JUMP';
          const board = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.9), [
            mats.wood, mats.wood, mats.wood, mats.wood,
            new THREE.MeshStandardMaterial({ map: signTexture(text), roughness: 0.6 }),
            new THREE.MeshStandardMaterial({ map: signTexture(text), roughness: 0.6 }),
          ]);
          board.rotation.y = Math.PI / 2;
          board.position.set(0, 0.85, 0);
          g.add(board);
          obj = g;
          break;
        }
        default:
          continue;
      }
      if (obj.userData.worldPlaced) {
        this.propMeshes.set(prop, obj);
        this.group.add(obj);
        continue;
      }
      shadowed(obj);
      const pos = prop.home;
      obj.position.set(pos.x, pos.y, pos.z);
      obj.quaternion.set(prop.rotation.x, prop.rotation.y, prop.rotation.z, prop.rotation.w);
      this.propMeshes.set(prop, obj);
      this.group.add(obj);
    }
  }

  // A floating island (grassy cap over a craggy cone of rock) or a tall rock spire, built around
  // the top-centre point. Returned already in world position.
  _skyRock(prop) {
    const def = prop.def;
    const theme = this.theme;
    const top = prop.home;
    const r = def.r ?? 8;
    const noise = createNoise2D(Math.round(def.x * 13 + r * 7));
    const rock = new THREE.Color().setRGB(theme.rock[0], theme.rock[1], theme.rock[2], THREE.SRGBColorSpace);
    const dirt = new THREE.Color().setRGB(theme.dirt[0], theme.dirt[1], theme.dirt[2], THREE.SRGBColorSpace);
    const grass = new THREE.Color().setRGB(theme.grass[0], theme.grass[1], theme.grass[2], THREE.SRGBColorSpace);
    let prof;
    let height;
    if (def.type === 'island') {
      const depth = def.depth ?? r * 1.2;
      height = depth + 2.4;
      prof = [[0.01, -height], [r * 0.18, -height + depth * 0.12], [r * 0.45, -height + depth * 0.45], [r * 0.78, -2.4 - depth * 0.15], [r * 0.97, -1.4], [r, -0.25], [r * 0.96, 0], [0.01, 0.02]];
    } else {
      const ground = this.terrain.height(def.x, top.z) - 2;
      height = top.y - ground;
      prof = [[r * 1.4, -height], [r * 1.28, -height * 0.7], [r * 1.12, -height * 0.4], [r * 1.04, -height * 0.15], [r, -0.25], [r * 0.96, 0], [0.01, 0.02]];
    }
    const pts = prof.map(([x, y]) => new THREE.Vector2(x, y));
    const geo = new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(48), 56);
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const ang = Math.atan2(v.z, v.x);
      const rad = Math.hypot(v.x, v.z);
      const isTop = v.y > -0.05 && rad < r * 0.97;
      if (!isTop && rad > 0.05) {
        // craggy, layered rock
        const bump = 1 + 0.14 * noise(ang * 3, v.y * 0.25) + 0.06 * noise(ang * 9, v.y * 0.9);
        const ledge = 1 + 0.05 * Math.sign(Math.sin(v.y * 1.7 + noise(ang, v.y * 0.1) * 2));
        v.x *= bump * ledge;
        v.z *= bump * ledge;
        p.setXYZ(i, v.x, v.y, v.z);
      }
      if (isTop) c.copy(grass);
      else if (v.y > -0.9) c.copy(dirt).lerp(grass, 0.25);
      else c.copy(rock).multiplyScalar(0.7 + 0.35 * (0.5 + 0.5 * Math.sin(v.y * 2.1 + noise(ang * 2, v.y * 0.2) * 3)));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const tex = this.terrainNear.material;
    const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, map: tex.map, normalMap: tex.normalMap, roughness: 0.92, specularIntensity: 0.35 });
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(top);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    g.add(buildTopDecor(top, r, Math.round(def.x * 7), theme));
    g.userData.worldPlaced = true;
    return g;
  }

  buildFinish() {
    const mats = materials();
    const t = this.terrain;
    const gx = this.level.goal;
    const gz = t.center(gx);
    const g = new THREE.Group();
    g.name = 'finish';
    if (this.level.sandbox) {
      this.finish = g;
      return;
    }
    const W = finishHalfWidth(this.level);
    const goal = goalPoint(this.level, t);
    const sky = this.level.goalLift !== undefined;
    const baseL = sky ? goal.y : t.height(gx, gz - W);
    const baseR = sky ? goal.y : t.height(gx, gz + W);
    const top = Math.max(baseL, baseR) + 5.2;
    for (const [z, base] of [[gz - W, baseL], [gz + W, baseR]]) {
      const h = top - base + 0.6;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, h, 16), mats.pole);
      pole.position.set(gx, base + h / 2 - 0.3, z);
      g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7, 8, 2), mats.flag);
      flag.position.set(gx - 0.6, top + 0.55, z);
      flag.name = 'flag';
      g.add(flag);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mats.gold);
      knob.position.set(gx, top + 0.95, z);
      g.add(knob);
    }
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 1.1, 30, 1), mats.checker);
    banner.rotation.y = Math.PI / 2;
    banner.position.set(gx, top - 0.3, gz);
    banner.name = 'banner';
    g.add(banner);
    // checkered strip painted on the road
    const strip = new THREE.PlaneGeometry(1.6, W * 2, 4, 40);
    strip.rotateX(-Math.PI / 2);
    const p = strip.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = gx + p.getX(i);
      const z = gz + p.getZ(i);
      p.setXYZ(i, x, (sky ? goal.y : t.height(x, z)) + 0.03, z);
    }
    strip.computeVertexNormals();
    const stripMesh = new THREE.Mesh(strip, mats.checkerGround);
    stripMesh.receiveShadow = true;
    g.add(stripMesh);
    shadowed(g);
    stripMesh.castShadow = false;
    this.finish = g;
    this.group.add(g);
  }

  buildStar() {
    const mats = materials();
    const g = new THREE.Group();
    g.name = 'star';
    const star = new THREE.Mesh(starGeometry(), mats.gold);
    star.castShadow = true;
    g.add(star);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc860, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.scale.setScalar(3.2);
    g.add(glow);
    const light = new THREE.PointLight(0xffb640, 6, 9, 2);
    g.add(light);
    this.star = g;
    if (this.level.star) {
      const s = this.level.star;
      g.position.set(s.x, this.terrain.profile(s.x) + s.lift, this.terrain.center(s.x));
      this.starBase = g.position.y;
      this.group.add(g);
    } else {
      g.visible = false;
    }
  }

  collectStar() {
    this.star.visible = false;
  }

  update(dt, camera) {
    this.time += dt;
    for (const [prop, mesh] of this.propMeshes) {
      if (!prop.alive) {
        if (mesh.parent) this.group.remove(mesh);
        continue;
      }
      if (prop.body) {
        if (this.pose) {
          this.pose(prop.body, mesh.position, mesh.quaternion);
        } else {
          const t = prop.body.translation();
          const r = prop.body.rotation();
          mesh.position.set(t.x, t.y, t.z);
          mesh.quaternion.set(r.x, r.y, r.z, r.w);
        }
      }
    }
    if (this.star.visible) {
      this.star.rotation.y += dt * 1.6;
      this.star.position.y = this.starBase + Math.sin(this.time * 2.2) * 0.18;
    }
    // flags ripple in the wind
    this.finish.traverse((o) => {
      if (o.name === 'flag' || o.name === 'banner') {
        const p = o.geometry.attributes.position;
        if (!o.userData.base) o.userData.base = Float32Array.from(p.array);
        const b = o.userData.base;
        const flag = o.name === 'flag';
        for (let i = 0; i < p.count; i++) {
          const x = b[i * 3];
          const w = flag ? (x + 0.6) : 1;
          p.setZ(i, b[i * 3 + 2] + Math.sin(this.time * 5 + x * (flag ? 5 : 0.8)) * 0.08 * w);
        }
        p.needsUpdate = true;
        o.geometry.computeVertexNormals();
      }
    });
    if (camera) {
      cullGrass(this.grass, camera.position, this.grassDist);
      cullScatter(this.scatter, camera.position, this.treeDist);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) o.geometry?.dispose();
    });
  }
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,230,160,0.55)');
  g.addColorStop(0.5, 'rgba(255,190,90,0.15)');
  g.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

