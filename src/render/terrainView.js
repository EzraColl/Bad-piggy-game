// Terrain meshes: a detailed 1 m grid around the course plus a coarse far ring of hills.
// Colours come from slope, height and the road mask, baked into vertex colours.

import * as THREE from 'three';
import { createNoise2D, fbm, smoothstep } from '../util/noise.js';
import { groundTextures } from './textures.js';

function srgb(c) {
  return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
}

export function terrainColorer(level, terrain, theme) {
  const n1 = createNoise2D(level.seed + 5);
  const n2 = createNoise2D(level.seed + 6);
  const grass = srgb(theme.grass);
  const grass2 = srgb(theme.grass2);
  const dirt = srgb(theme.dirt);
  const rock = srgb(theme.rock);
  const snow = srgb([0.9, 0.92, 0.95]);
  const tmp = new THREE.Color();
  const tmp2 = new THREE.Color();
  return function color(x, z, h, ny, out) {
    const m = 0.5 + 0.5 * fbm(n1, x * 0.035, z * 0.035, 3);
    out.copy(grass).lerp(grass2, m);
    out.multiplyScalar(0.8 + 0.35 * (0.5 + 0.5 * fbm(n2, x * 0.25, z * 0.25, 2)));
    // road with darker tyre ruts
    const r = terrain.roadMask(x, z);
    if (r > 0.001) {
      const dz = Math.abs(z - terrain.center(x));
      const rut = Math.exp(-((dz - 1.0) ** 2) / 0.05);
      tmp.copy(dirt).multiplyScalar((0.82 + 0.3 * (0.5 + 0.5 * fbm(n2, x * 0.6, z * 0.6, 2))) * (1 - 0.22 * rut));
      out.lerp(tmp, r);
    }
    // rock on steep slopes
    const s = smoothstep(0.86, 0.66, ny);
    if (s > 0) {
      // layered rock: strata bands plus darker cracks
      const strata = 0.82 + 0.18 * Math.sin(h * 2.3 + fbm(n2, x * 0.05, z * 0.05, 2) * 5);
      const crack = 0.75 + 0.25 * smoothstep(-0.2, 0.3, fbm(n1, x * 0.45, z * 0.45 + h * 0.6, 3));
      tmp2.copy(rock).multiplyScalar((0.62 + 0.4 * (0.5 + 0.5 * fbm(n1, x * 0.18, z * 0.4 + h * 0.3, 3))) * strata * crack);
      out.lerp(tmp2, s);
    }
    // snow cap
    if (theme.snowLine !== Infinity) {
      const sn = smoothstep(theme.snowLine - 3, theme.snowLine + 3, h + fbm(n2, x * 0.05, z * 0.05, 2) * 5) * smoothstep(0.55, 0.8, ny);
      if (sn > 0) out.lerp(snow, sn);
    }
    // deep canyon walls get darker
    const depth = terrain.pitDepth(x);
    if (depth > 0.5) out.multiplyScalar(1 - Math.min(0.45, depth * 0.012));
    return out;
  };
}

function buildGrid(terrain, colorer, x0, x1, z0, z1, step, sink) {
  const nx = Math.round((x1 - x0) / step);
  const nz = Math.round((z1 - z0) / step);
  const count = (nx + 1) * (nz + 1);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      const i = iz * (nx + 1) + ix;
      const x = x0 + ix * step;
      const z = z0 + iz * step;
      let h = terrain.height(x, z);
      if (sink) h -= sink(x, z);
      pos[i * 3] = x;
      pos[i * 3 + 1] = h;
      pos[i * 3 + 2] = z;
      uv[i * 2] = x / 3.5;
      uv[i * 2 + 1] = z / 3.5;
    }
  }
  const idx = new Uint32Array(nx * nz * 6);
  let k = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * (nx + 1) + ix;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      // alternate the diagonal to avoid visible zig-zag banding
      if ((ix + iz) % 2) {
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      } else {
        idx[k++] = a; idx[k++] = c; idx[k++] = d;
        idx[k++] = a; idx[k++] = d; idx[k++] = b;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const nrm = g.attributes.normal.array;
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    colorer(pos[i * 3], pos[i * 3 + 2], pos[i * 3 + 1], nrm[i * 3 + 1], c);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function buildTerrainMeshes(level, terrain, theme) {
  const tex = groundTextures();
  const material = new THREE.MeshPhysicalMaterial({
    specularIntensity: 0.35,
    vertexColors: true,
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.94,
    metalness: 0,
  });
  const colorer = terrainColorer(level, terrain, theme);
  const b = terrain.bounds;
  const DZ = 80;
  const near = new THREE.Mesh(buildGrid(terrain, colorer, b.x0, b.x1, -DZ, DZ, 1, null), material);
  near.receiveShadow = true;
  near.castShadow = true;
  near.name = 'terrain';

  // Coarse ring of hills to the horizon. Inside the detailed area it tucks itself underground.
  const farMat = material.clone();
  farMat.polygonOffset = true;
  farMat.polygonOffsetFactor = 2;
  farMat.polygonOffsetUnits = 2;
  const pad = 6;
  const sink = (x, z) => {
    const inX = Math.min(x - b.x0, b.x1 - x);
    const inZ = DZ - Math.abs(z);
    const inside = Math.min(inX, inZ);
    return inside > pad ? 4 : 0;
  };
  const far = new THREE.Mesh(buildGrid(terrain, colorer, b.x0 - 720, b.x1 + 720, -900, 900, 10, sink), farMat);
  far.receiveShadow = true;
  far.name = 'terrain-far';
  return { near, far, material };
}
