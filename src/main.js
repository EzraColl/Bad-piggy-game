// Entry point: boots the physics engine and renderer, then hands over to the game.

import RAPIER from '@dimforge/rapier3d-compat';
import './ui/style.css';
import { Graphics } from './render/graphics.js';
import { renderThumbnails } from './render/partMeshes.js';
import { Sound } from './audio/audio.js';
import { Store } from './game/store.js';
import { Game } from './game/game.js';
import { LEVELS } from './game/levels.js';
import { PART_ORDER } from './game/parts.js';
import * as ui from './ui/ui.js';

// Pick a starting quality from the GPU name; the game also steps down once if the first drive stutters.
function guessQuality() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software/.test(name)) return 'low';
    if (/nvidia|geforce|rtx|radeon rx|apple m[2-9]|apple m1 (pro|max|ultra)/.test(name)) return 'high';
    return 'medium';
  } catch {
    return 'medium';
  }
}

async function boot(hotData = {}) {
  const store = new Store();
  store.merge(hotData.progress);
  try {
    // keeps stars and builds when an embedding host hot-reloads the page
    window.claude?.hot?.snapshot?.(() => ({ progress: store.data }));
  } catch {
    /* not hosted there */
  }

  const canvas = document.getElementById('gl');
  if (!document.createElement('canvas').getContext('webgl2')) {
    ui.loading(0, 'This game needs WebGL 2. Try the latest Chrome, Edge, Firefox or Safari.');
    return;
  }
  ui.loading(0.05, 'Starting the physics engine…');
  await RAPIER.init();

  ui.loading(0.2, 'Painting textures…');
  await new Promise((r) => requestAnimationFrame(r));
  const graphics = new Graphics(canvas, store.setting('quality', guessQuality()));
  const thumbnails = renderThumbnails(PART_ORDER);
  const sound = new Sound();
  const game = new Game({ RAPIER, graphics, sound, store, thumbnails });
  window.pigRig = game; // handy for poking around in the console
  game.renderThumbnails = (size) => renderThumbnails(PART_ORDER, size);

  await game.loadWorld(LEVELS[0], (p, text) => ui.loading(0.3 + p * 0.65, text));
  await game.showTitle();

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      game.update(dt);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const hot = window.claude?.hot;
if (hot?.ready) hot.ready(boot);
else boot(hot?.data ?? {});
