// Procedural terrain for a level: a dirt road running along +X through a grassy valley.
// Pure functions only, so the same heights feed the physics, the renderer and the simulator.

import { createNoise2D, fbm, smoothstep, clamp } from '../util/noise.js';

// Monotone cubic interpolation (Fritsch-Carlson) so cliffs and plateaus never overshoot.
function makeProfile(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return function profile(x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export function createTerrain(level) {
  const noiseA = createNoise2D(level.seed);
  const noiseB = createNoise2D(level.seed + 101);
  const noiseC = createNoise2D(level.seed + 202);
  const profile = makeProfile(level.profile);
  const half = level.trackHalf ?? 7;
  const wallH = level.wallHeight ?? 9;
  const pits = level.pits ?? [];
  const meander = level.meander ?? 2.4;
  const beginX = Math.min(level.start - 70, level.profile[0][0]);
  const endX = level.goal + 90;

  // The road gently wanders left and right; everything in a level is placed relative to it.
  const center = (x) => meander * Math.sin(x * 0.021 + level.seed) * smoothstep(-20, 30, x) + 0.6 * meander * Math.sin(x * 0.047 + 1.3);

  function pitDepth(x) {
    let d = 0;
    for (const [x0, x1, depth] of pits) {
      const m = smoothstep(x0, x0 + 2.2, x) * (1 - smoothstep(x1 - 2.2, x1, x));
      d = Math.max(d, m * depth);
    }
    return d;
  }

  function wallMask(x, z) {
    const az = Math.abs(z - center(x));
    return smoothstep(half, half + 17, az);
  }

  function height(x, z) {
    const dz = z - center(x);
    const az = Math.abs(dz);
    const w = smoothstep(half, half + 17, az);
    let h = profile(x);
    h += w * w * wallH * (0.7 + 0.6 * (0.5 + 0.5 * fbm(noiseA, x * 0.011, z * 0.011, 3)));
    h += fbm(noiseB, x * 0.028, z * 0.028, 4) * 3.2 * w;
    h += fbm(noiseC, x * 0.17 + 7, z * 0.17, 2) * 0.07 * (1 - w);
    // far away the land rolls into big hills
    const far = smoothstep(half + 30, half + 110, az);
    h += far * (8 + 18 * (0.5 + 0.5 * fbm(noiseA, x * 0.006 + 3, z * 0.006, 3)));
    // hills close off both ends of the valley so nobody drives off the edge of the world
    const ends = Math.max(smoothstep(endX - 55, endX, x), smoothstep(beginX + 45, beginX, x));
    h += ends * ends * 26;
    h -= pitDepth(x);
    return h;
  }

  // 1 on the packed-dirt road, 0 on grass.
  function roadMask(x, z) {
    const dz = Math.abs(z - center(x));
    const wobble = fbm(noiseC, x * 0.08, z * 0.08, 2) * 1.2;
    return 1 - smoothstep(half * 0.42 + wobble, half * 0.62 + wobble, dz);
  }

  const groundAt = (x, dz = 0) => height(x, center(x) + dz);
  const bounds = {
    x0: beginX,
    x1: endX,
    z0: -80,
    z1: 80,
  };

  return {
    profile,
    center,
    height,
    roadMask,
    wallMask,
    pitDepth,
    groundAt,
    bounds,
    // The pig has fallen out of the world when it is this far below the road.
    killY: (x) => profile(clamp(x, bounds.x0, bounds.x1)) - 9,
  };
}

// Samples the terrain on a regular grid. Heights are stored row-major with X varying fastest.
export function sampleGrid(terrain, x0, x1, z0, z1, step) {
  const nx = Math.round((x1 - x0) / step);
  const nz = Math.round((z1 - z0) / step);
  const heights = new Float32Array((nx + 1) * (nz + 1));
  for (let iz = 0; iz <= nz; iz++) {
    const z = z0 + iz * step;
    for (let ix = 0; ix <= nx; ix++) {
      heights[iz * (nx + 1) + ix] = terrain.height(x0 + ix * step, z);
    }
  }
  return { nx, nz, x0, z0, step, heights };
}
