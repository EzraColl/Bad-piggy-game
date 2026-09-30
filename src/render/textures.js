// Procedural textures painted on canvases at startup, so the game ships as a single file with no
// image assets. Each material gets an albedo map plus a normal map derived from a height field.

import * as THREE from 'three';
import { createNoise2D, fbm, mulberry32 } from '../util/noise.js';

const cache = new Map();

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(c, { srgb = true, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// Height field (Float32Array, size*size, 0..1) -> tangent-space normal map canvas.
function normalFromHeight(height, size, strength = 2) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = height[y * size + ((x - 1 + size) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const u = height[((y - 1 + size) % size) * size + x];
      const b = height[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (u - b) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function paintField(size, fn) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const out = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      d[i] = out[0] * 255;
      d[i + 1] = out[1] * 255;
      d[i + 2] = out[2] * 255;
      d[i + 3] = 255;
      h[y * size + x] = out[3] ?? 0.5;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, height: h };
}

// Tileable noise by sampling a torus-mapped 4D-ish trick: blend four offset samples.
function tileNoise(noise, u, v, scale, octaves = 4) {
  const a = fbm(noise, u * scale, v * scale, octaves);
  const b = fbm(noise, (u - 1) * scale, v * scale, octaves);
  const c = fbm(noise, u * scale, (v - 1) * scale, octaves);
  const d = fbm(noise, (u - 1) * scale, (v - 1) * scale, octaves);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function memo(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

export function woodTextures() {
  return memo('wood', () => {
    const size = 512;
    const n = createNoise2D(7);
    const n2 = createNoise2D(8);
    const rand = mulberry32(3);
    const planks = 4;
    const tints = Array.from({ length: planks }, () => 0.85 + rand() * 0.3);
    const { canvas: c, height } = paintField(size, (u, v) => {
      const p = Math.floor(v * planks);
      const pv = v * planks - p;
      const grain = tileNoise(n, u, v * planks * 0.25 + p * 0.37, 3, 3);
      const rings = Math.sin((v * planks * 18 + grain * 7 + tileNoise(n2, u, v, 2, 2) * 4) * Math.PI) * 0.5 + 0.5;
      const fine = tileNoise(n2, u * 1, v * 8, 16, 2) * 0.5 + 0.5;
      const seam = Math.min(1, Math.min(pv, 1 - pv) * 40);
      const t = tints[p] * (0.78 + 0.22 * rings) * (0.9 + 0.1 * fine) * (0.55 + 0.45 * seam);
      const knot = Math.max(0, 1 - Math.hypot(((u * 3 + p * 0.71) % 1) - 0.5, (pv - 0.5) * 1.6) * 7);
      const k = 1 - knot * 0.45;
      return [0.66 * t * k, 0.43 * t * k, 0.24 * t * k, 0.5 + 0.2 * rings * seam - (1 - seam) * 0.5 + fine * 0.05];
    });
    return {
      map: toTexture(c),
      normalMap: toTexture(normalFromHeight(height, size, 3), { srgb: false }),
    };
  });
}

export function crateTextures() {
  return memo('crate', () => {
    const size = 512;
    const wood = woodTextures();
    const c = canvas(size);
    const ctx = c.getContext('2d');
    ctx.drawImage(wood.map.image, 0, 0, size, size);
    // darker frame boards around the edge and a diagonal brace
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(170,140,110)';
    const b = size * 0.13;
    ctx.fillRect(0, 0, size, b);
    ctx.fillRect(0, size - b, size, b);
    ctx.fillRect(0, 0, b, size);
    ctx.fillRect(size - b, 0, b, size);
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.fillRect(-size * 0.7, -b / 2, size * 1.4, b);
    ctx.restore();
    ctx.strokeStyle = 'rgba(40,24,10,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(b, b, size - 2 * b, size - 2 * b);
    ctx.strokeRect(1, 1, size - 2, size - 2);
    // nails
    ctx.fillStyle = 'rgba(60,60,60,0.9)';
    for (const [x, y] of [[0.065, 0.065], [0.935, 0.065], [0.065, 0.935], [0.935, 0.935], [0.5, 0.065], [0.5, 0.935], [0.065, 0.5], [0.935, 0.5]]) {
      ctx.beginPath();
      ctx.arc(x * size, y * size, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const h = new Float32Array(size * size);
    const img = ctx.getImageData(0, 0, size, size).data;
    for (let i = 0; i < size * size; i++) h[i] = img[i * 4] / 255;
    return { map: toTexture(c), normalMap: toTexture(normalFromHeight(h, size, 2.5), { srgb: false }) };
  });
}

export function tntTexture() {
  return memo('tnt', () => {
    const size = 512;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    ctx.drawImage(crateTextures().map.image, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#e0341e';
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#f4ead2';
    ctx.fillRect(size * 0.12, size * 0.36, size * 0.76, size * 0.28);
    ctx.fillStyle = '#1a1512';
    ctx.font = `900 ${size * 0.24}px Impact, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TNT', size / 2, size / 2 + size * 0.01);
    return toTexture(c);
  });
}

export function metalTextures() {
  return memo('metal', () => {
    const size = 256;
    const n = createNoise2D(21);
    const { canvas: c, height } = paintField(size, (u, v) => {
      const brushed = tileNoise(n, u * 0.1, v, 40, 2) * 0.5 + 0.5;
      const blotch = tileNoise(n, u, v, 3, 3) * 0.5 + 0.5;
      const g = 0.55 + 0.25 * brushed * 0.4 + 0.2 * blotch;
      return [g, g, g * 1.02, brushed * 0.3];
    });
    return { roughnessMap: toTexture(c, { srgb: false }), normalMap: toTexture(normalFromHeight(height, size, 0.6), { srgb: false }) };
  });
}

export function tireTextures() {
  return memo('tire', () => {
    const size = 256;
    const { canvas: c, height } = paintField(size, (u, v) => {
      // chevron tread blocks around the tyre (u around, v across)
      const across = Math.abs(v - 0.5) * 2;
      const chev = ((u * 24 + across * 1.2) % 1);
      const block = chev < 0.55 ? 1 : 0;
      const groove = across > 0.08 && across < 0.9 ? block : 1;
      const h = across > 0.9 ? 0.6 : groove;
      const g = 0.05 + 0.03 * h;
      return [g, g, g, h];
    });
    return { map: toTexture(c), normalMap: toTexture(normalFromHeight(height, size, 6), { srgb: false }) };
  });
}

export function groundTextures() {
  return memo('ground', () => {
    const size = 512;
    const n = createNoise2D(31);
    const n2 = createNoise2D(32);
    const rand = mulberry32(9);
    const { canvas: c, height } = paintField(size, (u, v) => {
      const big = tileNoise(n, u, v, 4, 4) * 0.5 + 0.5;
      const fine = tileNoise(n2, u, v, 32, 2) * 0.5 + 0.5;
      const pebble = rand() < 0.012 ? 1 : 0;
      const g = 0.78 + 0.22 * big * fine + pebble * 0.12;
      return [g, g, g, big * 0.6 + fine * 0.35 + pebble * 0.3];
    });
    return { map: toTexture(c), normalMap: toTexture(normalFromHeight(height, size, 3.5), { srgb: false }) };
  });
}

export function hayTexture() {
  return memo('hay', () => {
    const size = 256;
    const n = createNoise2D(41);
    const { canvas: c } = paintField(size, (u, v) => {
      const s = tileNoise(n, u * 0.2, v, 40, 2) * 0.5 + 0.5;
      const t = 0.7 + 0.3 * s;
      return [0.86 * t, 0.7 * t, 0.36 * t];
    });
    return toTexture(c);
  });
}

export function barkTexture() {
  return memo('bark', () => {
    const size = 256;
    const n = createNoise2D(51);
    const { canvas: c, height } = paintField(size, (u, v) => {
      const s = tileNoise(n, u * 4, v * 0.4, 6, 3) * 0.5 + 0.5;
      const t = 0.55 + 0.45 * s;
      return [0.33 * t, 0.24 * t, 0.17 * t, s];
    });
    return { map: toTexture(c), normalMap: toTexture(normalFromHeight(height, size, 4), { srgb: false }) };
  });
}

export function checkerTexture(cols = 8, rows = 2) {
  return memo(`checker${cols}x${rows}`, () => {
    const c = canvas(256);
    const ctx = c.getContext('2d');
    const w = 256 / cols;
    const h = 256 / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2';
        ctx.fillRect(x * w, y * h, w, h);
      }
    }
    const t = toTexture(c);
    t.magFilter = THREE.NearestFilter;
    return t;
  });
}

export function signTexture(text, bg = '#f3c33a', fg = '#1d1a14') {
  const c = canvas(256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 14;
  ctx.strokeRect(10, 10, 236, 236);
  ctx.fillStyle = fg;
  ctx.font = '900 120px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 136);
  return toTexture(c);
}

// Leaf cluster for broadleaf tree cards: hundreds of small leaves on transparent background.
export function leafCardTexture() {
  return memo('leafcard', () => {
    const size = 512;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rand = mulberry32(77);
    // a few twigs first
    ctx.strokeStyle = 'rgba(70,52,34,0.9)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      ctx.lineWidth = 3 + rand() * 3;
      ctx.beginPath();
      ctx.moveTo(size / 2, size / 2);
      ctx.quadraticCurveTo(size / 2 + Math.cos(a + 0.4) * 90, size / 2 + Math.sin(a + 0.4) * 90, size / 2 + Math.cos(a) * 200, size / 2 + Math.sin(a) * 200);
      ctx.stroke();
    }
    const leaves = 420;
    for (let i = 0; i < leaves; i++) {
      const t = i / leaves; // later leaves are brighter (on top, facing the light)
      const r = Math.pow(rand(), 0.6) * size * 0.46;
      const a = rand() * Math.PI * 2;
      const x = size / 2 + Math.cos(a) * r;
      const y = size / 2 + Math.sin(a) * r;
      const len = 20 + rand() * 20;
      const wid = len * (0.38 + rand() * 0.14);
      const rot = a + (rand() - 0.5) * 1.6;
      const hue = 78 + rand() * 32;
      const sat = 38 + rand() * 25;
      const light = 16 + t * 22 + rand() * 10;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
      ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue + 10}, ${sat}%, ${light + 12}%, 0.6)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(1, 0);
      ctx.lineTo(len * 0.92, 0);
      ctx.stroke();
      ctx.restore();
    }
    const t = toTexture(c);
    t.premultiplyAlpha = false;
    return t;
  });
}

// Pine branch card: needles either side of a twig running along the card.
export function needleCardTexture() {
  return memo('needlecard', () => {
    const w = 256;
    const h = 512;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const rand = mulberry32(88);
    ctx.lineCap = 'round';
    // side twigs
    const twigs = [];
    for (let y = 30; y < h - 10; y += 22 + rand() * 14) twigs.push(y);
    const drawNeedles = (x0, y0, dirX, dirY, len, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const px = x0 + dirX * len * t;
        const py = y0 + dirY * len * t;
        for (const s of [-1, 1]) {
          const nl = (10 + rand() * 9) * (1 - t * 0.5);
          const ang = Math.atan2(dirY, dirX) + s * (0.9 + rand() * 0.4);
          const light = 14 + rand() * 18;
          ctx.strokeStyle = `hsl(${120 + rand() * 25}, ${30 + rand() * 20}%, ${light}%)`;
          ctx.lineWidth = 1.6 + rand();
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(ang) * nl, py + Math.sin(ang) * nl);
          ctx.stroke();
        }
      }
    };
    ctx.strokeStyle = 'rgb(80,58,38)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(w / 2, h);
    ctx.lineTo(w / 2, 6);
    ctx.stroke();
    for (const y of twigs) {
      const spread = (1 - y / h) * 0.25 + 0.75;
      for (const s of [-1, 1]) {
        const len = (w * 0.42) * spread * (0.7 + rand() * 0.3) * (y / h * 0.6 + 0.4);
        const dx = s * 0.85;
        const dy = -0.5;
        ctx.strokeStyle = 'rgb(84,62,40)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(w / 2, y);
        ctx.lineTo(w / 2 + dx * len, y + dy * len);
        ctx.stroke();
        drawNeedles(w / 2, y, dx, dy, len, 9);
      }
    }
    drawNeedles(w / 2, h, 0, -1, h - 10, 34);
    return toTexture(c);
  });
}
