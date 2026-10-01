// DOM side of the game: screens, part palette, HUD, results and settings.

import { LEVELS } from '../game/levels.js';
import { PARTS, PART_ORDER, DIRS } from '../game/parts.js';
import { QUALITY, QUALITY_ORDER } from '../render/graphics.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['loading', 'title', 'levels', 'build', 'play', 'photo'];
const MODALS = ['result', 'settings', 'help'];
let game = null;
let toastTimer = 0;
let showFps = false;
let hintArmed = 0;

const QUALITY_NOTES = {
  low: 'For older laptops. No grass shadows or bloom, lower resolution.',
  medium: 'Balanced. Reflections, bloom and moderate grass.',
  high: 'Ambient occlusion, dense grass, sharper on high-DPI screens.',
  ultra: 'Everything maxed: 4K shadows, live reflections every frame, thick grass.',
};

const SKY = {
  meadow: 'linear-gradient(135deg, #4f95dc, #a9d7ff 60%, #d9f0c0)',
  golden: 'linear-gradient(135deg, #e98a3f, #f7c77a 60%, #ffe6b0)',
  morning: 'linear-gradient(135deg, #7fb7ee, #cfe6ff 60%, #fff2d6)',
  quarry: 'linear-gradient(135deg, #7cb0d8, #e9d6aa 60%, #d8a468)',
  alpine: 'linear-gradient(135deg, #3f7fd0, #bfe1ff 60%, #ffffff)',
  canyon: 'linear-gradient(135deg, #c8543a, #f29a5a 60%, #ffd08a)',
};

export function bind(g) {
  game = g;
  $('btn-play').onclick = () => { click(); game.showLevels(); };
  $('btn-sandbox').onclick = () => { click(); game.openLevel(LEVELS.find((l) => l.sandbox)); };
  $('btn-howto').onclick = () => openModal('help');
  $('btn-settings').onclick = () => openModal('settings');
  $('btn-build-settings').onclick = () => openModal('settings');
  $('levels-back').onclick = () => { click(); game.showTitle(); };
  $('build-back').onclick = () => { click(); game.showLevels(); };
  $('help-close').onclick = () => closeModals();
  $('settings-close').onclick = () => closeModals();
  $('btn-go').onclick = () => game.startRun();
  $('btn-clear').onclick = () => { game.world.builder.clear(); toast('Grid cleared. Ctrl+Z brings it back.'); };
  $('btn-undo').onclick = () => { if (!game.world.builder.undo()) toast('Nothing to undo'); };
  $('btn-hint').onclick = () => {
    const now = performance.now();
    if (now - hintArmed > 6000) {
      hintArmed = now;
      toast('Click Hint again to swap your build for one that works');
      return;
    }
    hintArmed = 0;
    game.world.builder.load(game.world.level.solution);
    toast('Hint loaded. Press GO and hold W.');
  };
  $('btn-rotate').onclick = () => toast('Thrust: ' + game.world.builder.rotate());
  $('btn-eraser').onclick = () => game.world.builder.setEraser(!game.world.builder.eraser);
  $('btn-inside').onclick = () => toggleInside(game);
  $('btn-mirror').onclick = () => toggleMirror(game);
  $('btn-turn-left').onclick = () => game.world.builder.turn(-1);
  $('btn-turn-right').onclick = () => game.world.builder.turn(1);
  $('btn-restart').onclick = () => game.restart();
  $('btn-tobuild').onclick = () => game.enterBuild();
  $('btn-cam').onclick = () => toast(game.rig.toggleMode() === 'side' ? 'Side view' : 'Chase view');
  $('btn-photo').onclick = () => game.enterPhoto();
  $('btn-photo-exit').onclick = () => game.exitPhoto();
  $('btn-photo-save').onclick = () => game.savePhoto();
  // Plain downloads are blocked inside embedded frames. There, offer saving only if the host
  // provides a download capability (claude.ai's artifact viewer does).
  if (window.self !== window.top) {
    $('btn-photo-save').hidden = true;
    window.claude?.use?.('downloads')
      .then((d) => {
        if (!d) return;
        game.downloads = d;
        $('btn-photo-save').hidden = false;
      })
      .catch(() => {});
  }
  $('res-build').onclick = () => game.enterBuild();
  $('res-retry').onclick = () => game.restart();
  $('res-next').onclick = () => game.nextLevel();

  // settings
  const seg = $('quality');
  for (const name of QUALITY_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `quality-${name}`;
    b.textContent = QUALITY[name].label;
    b.setAttribute('role', 'radio');
    b.onclick = () => {
      game.setQuality(name);
      syncSettings();
      toast(`Graphics: ${QUALITY[name].label}. Grass and trees update when a level loads.`);
    };
    seg.appendChild(b);
  }
  const vol = $('volume');
  vol.value = game.store.setting('volume', 0.8);
  game.sound.setVolume(Number(vol.value));
  vol.oninput = () => {
    game.sound.setVolume(Number(vol.value));
    game.store.set('volume', Number(vol.value));
  };
  showFps = !!game.store.setting('fps', false);
  $('show-fps').checked = showFps;
  $('show-fps').onchange = (e) => {
    showFps = e.target.checked;
    game.store.set('fps', showFps);
    $('fps').hidden = !showFps;
  };
  $('fps').hidden = !showFps;
  syncSettings();

  // touch driving pad
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  $('touch').hidden = !coarse;
  for (const btn of $('touch').querySelectorAll('button')) {
    const key = btn.dataset.key;
    const on = (e) => { e.preventDefault(); game.keys.add(key); btn.classList.add('held'); };
    const off = (e) => { e.preventDefault(); game.keys.delete(key); btn.classList.remove('held'); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
  }
}

export function toggleInside(g) {
  const b = g.world.builder;
  b.setInsideMode(!b.insideMode);
  toast(b.insideMode ? 'Inside boxes on: click a frame to put the part inside it' : 'Inside boxes off');
}

export function toggleMirror(g) {
  const b = g.world.builder;
  b.setMirror(!b.mirror);
  toast(b.mirror ? 'Mirror on: parts are copied to the other side' : 'Mirror off');
}

function click() {
  game.sound.unlock();
  game.sound.click();
}

function syncSettings() {
  for (const name of QUALITY_ORDER) {
    $(`quality-${name}`).setAttribute('aria-checked', String(game.gfx.qualityName === name));
  }
  $('quality-note').textContent = QUALITY_NOTES[game.gfx.qualityName];
}

export function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  if (name !== 'play') $('touch').hidden = true;
  else $('touch').hidden = !window.matchMedia?.('(pointer: coarse)').matches;
}

export function loading(p, text) {
  $('loading-bar').style.width = `${Math.round(p * 100)}%`;
  if (text) $('loading-text').textContent = text;
}

export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

export function fps(v) {
  if (showFps) $('fps').textContent = `${Math.round(v)} fps · ${game.gfx.quality.label}`;
}

export function openModal(name) {
  for (const m of MODALS) if (m !== 'result') $(m).hidden = m !== name;
  if (name === 'settings') syncSettings();
  const first = $(name).querySelector('button');
  first?.focus();
}

export function closeModals() {
  for (const m of ['settings', 'help']) $(m).hidden = true;
}

export function modalOpen() {
  return !$('settings').hidden || !$('help').hidden;
}

// ------------------------------------------------------------------ level select

function starsHtml(arr, cls = '') {
  return `<span class="stars ${cls}">${arr.map((on) => `<i class="star${on ? ' on' : ''}"></i>`).join('')}</span>`;
}

export function renderLevels(g) {
  const grid = $('level-grid');
  grid.innerHTML = '';
  const total = LEVELS.filter((l) => !l.sandbox).length * 3;
  $('levels-total').textContent = `${g.store.totalStars()} / ${total} stars`;
  LEVELS.forEach((level, i) => {
    const card = document.createElement('button');
    card.className = 'level-card';
    card.id = `level-${level.id}`;
    card.style.setProperty('--sky-grad', SKY[level.theme]);
    const best = g.store.data.best[level.id];
    const stars = g.store.stars(level.id);
    card.innerHTML = `
      <span class="num">${level.sandbox ? '∞' : i + 1}</span>
      <h3>${level.name}</h3>
      <p>${level.blurb}</p>
      <div class="meta">${level.sandbox ? '<span>Unlimited parts</span>' : starsHtml(stars)}<span>${best ? best.toFixed(1) + ' s' : ''}</span></div>`;
    card.onclick = () => { click(); g.openLevel(level); };
    grid.appendChild(card);
  });
}

// ------------------------------------------------------------------ build

export function paletteTypes(g) {
  const lvl = g.world.level;
  return PART_ORDER.filter((t) => (lvl.parts[t] ?? 0) > 0);
}

function goalsHtml(level, status = [false, false, false]) {
  if (level.sandbox) return '<li>No goal. Build something silly.</li>';
  const items = [
    ['Get the pig to the finish', status[0]],
    ['Grab the golden star', status[1]],
    [`Finish in under ${level.timeLimit} s`, status[2]],
  ];
  return items.map(([t, on]) => `<li><i class="star${on ? ' on' : ''}"></i>${t}</li>`).join('');
}

export function setupBuild(g) {
  const lvl = g.world.level;
  $('build-title').textContent = lvl.name;
  $('build-goals').innerHTML = goalsHtml(lvl, g.store.stars(lvl.id));
  const pal = $('palette');
  pal.innerHTML = '';
  paletteTypes(g).forEach((type, i) => {
    const b = document.createElement('button');
    b.className = 'part-btn';
    b.id = `part-${type}`;
    b.title = `${PARTS[type].name}: ${PARTS[type].blurb}`;
    b.innerHTML = `<span class="key">${i + 1}</span><span class="count"></span><img alt="" src="${g.thumbs[type] ?? ''}"><span class="name">${PARTS[type].name}</span>`;
    b.onclick = () => { click(); g.world.builder.select(type); toast(PARTS[type].blurb); };
    pal.appendChild(b);
  });
  if (!paletteTypes(g).includes(g.world.builder.selected)) g.world.builder.select(paletteTypes(g)[0]);
  $('build-tip').classList.remove('fade');
  clearTimeout(setupBuild.t);
  setupBuild.t = setTimeout(() => $('build-tip').classList.add('fade'), 9000);
  refreshBuild(g);
}

export function refreshBuild(g) {
  const b = g.world?.builder;
  if (!b) return;
  for (const type of paletteTypes(g)) {
    const el = $(`part-${type}`);
    if (!el) continue;
    const left = b.remaining(type);
    el.querySelector('.count').textContent = left === Infinity ? '∞' : `${left}`;
    el.classList.toggle('sel', !b.eraser && b.selected === type);
    el.classList.toggle('empty', left <= 0);
  }
  $('btn-eraser').classList.toggle('on', b.eraser);
  $('btn-eraser').setAttribute('aria-pressed', String(b.eraser));
  $('btn-inside').classList.toggle('on', b.insideMode);
  $('btn-inside').setAttribute('aria-pressed', String(b.insideMode));
  $('btn-mirror').classList.toggle('on', b.mirror);
  $('btn-mirror').setAttribute('aria-pressed', String(b.mirror));
  $('rotate-label').textContent = DIRS[b.placeDir].label;
  $('btn-rotate').hidden = !PARTS[b.selected]?.directional;
  $('btn-go').disabled = !b.hasPig();
  $('btn-go').title = b.hasPig() ? 'Start (Enter)' : 'Add the pig first';
}

// ------------------------------------------------------------------ play

const ACTIONS = [
  { type: 'rocket', key: 'Space', label: 'Rockets', code: 'Space' },
  { type: 'fan', key: 'F', label: 'Propellers', code: 'KeyF' },
  { type: 'balloon', key: 'B', label: 'Pop balloon', code: 'KeyB' },
  { type: 'tnt', key: 'T', label: 'Detonate TNT', code: 'KeyT' },
];

export function setupPlay(g) {
  const lvl = g.world.level;
  $('play-title').textContent = lvl.name;
  const box = $('actions');
  box.innerHTML = '';
  for (const a of ACTIONS) {
    if (!g.sim.car.parts.some((p) => p.type === a.type)) continue;
    const b = document.createElement('button');
    b.className = 'action';
    b.id = `act-${a.type}`;
    b.innerHTML = `<kbd>${a.key}</kbd><span>${a.label}</span><small></small>${a.type === 'rocket' ? '<span class="fuel"><i></i></span>' : ''}`;
    if (a.type === 'rocket') {
      b.onpointerdown = (e) => { e.preventDefault(); g.keys.add('rocket'); };
      b.onpointerup = b.onpointerleave = () => g.keys.delete('rocket');
    } else {
      b.onclick = () => {
        if (a.type === 'fan') g.sim.toggleFans();
        if (a.type === 'balloon' && g.sim.popBalloon()) g.sound.pop();
        if (a.type === 'tnt') g.sim.detonate();
      };
    }
    box.appendChild(b);
  }
  $('play-goals').innerHTML = lvl.sandbox ? '' : starsHtml([false, false, false]);
  $('drive-tip').classList.remove('fade');
  const has = (t) => g.sim.car.parts.some((p) => p.type === t);
  $('drive-tip').innerHTML = has('fan')
    ? '<kbd>F</kbd> propellers on · <kbd>W</kbd><kbd>S</kbd> more or less power (climb or sink) · <kbd>A</kbd><kbd>D</kbd> steer in the air'
    : has('engine')
      ? '<kbd>W</kbd><kbd>S</kbd> drive · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>Shift</kbd> brake · drag to look around'
      : 'No engine on this one: use your thrusters, or just roll · drag to look around';
  clearTimeout(setupPlay.t);
  setupPlay.t = setTimeout(() => $('drive-tip').classList.add('fade'), 9000);
}

export function updatePlay(g) {
  const sim = g.sim;
  const lvl = g.world.level;
  const t = $('timer');
  const shown = sim.finishTime ?? sim.time; // the clock stops at the finish line
  t.textContent = shown.toFixed(1);
  t.classList.toggle('late', !lvl.sandbox && lvl.timeLimit > 0 && shown > lvl.timeLimit);
  $('speed').textContent = Math.round(sim.car.speed() * 3.6);
  if (!lvl.sandbox) {
    const st = sim.stars();
    const timeOk = sim.state === 'won' ? st.time : sim.time <= lvl.timeLimit;
    const stars = $('play-goals').querySelectorAll('.star');
    if (stars.length === 3) {
      stars[0].classList.toggle('on', st.finish);
      stars[1].classList.toggle('on', st.star);
      stars[2].classList.toggle('on', timeOk);
    }
  }
  const car = sim.car;
  for (const a of ACTIONS) {
    const el = $(`act-${a.type}`);
    if (!el) continue;
    const list = car.parts.filter((p) => p.type === a.type && p.alive);
    const small = el.querySelector('small');
    if (a.type === 'rocket') {
      const fuel = list.reduce((s, p) => s + p.fuel, 0);
      const max = Math.max(1, car.parts.filter((p) => p.type === 'rocket').length) * PARTS.rocket.fuel;
      el.querySelector('.fuel i').style.width = `${Math.round((fuel / max) * 100)}%`;
      small.textContent = fuel > 0 ? 'hold to fire' : 'empty';
      el.classList.toggle('on', list.some((p) => p.firing));
    } else if (a.type === 'fan') {
      small.textContent = car.fansOn ? 'on' : 'off';
      el.classList.toggle('on', car.fansOn);
    } else if (a.type === 'balloon') {
      small.textContent = `${list.filter((p) => !p.popped).length} left`;
    } else if (a.type === 'tnt') {
      small.textContent = `${list.length} left`;
    }
  }
}

export function showResult(g, r) {
  const card = $('result');
  const lvl = g.world.level;
  $('result-title').textContent = r.won ? 'Level complete!' : 'Oops! The pig fell';
  const starBox = $('result-stars');
  starBox.innerHTML = '';
  if (r.won) {
    r.stars.forEach((on, i) => {
      const s = document.createElement('i');
      s.className = `star${on ? ' on' : ''}`;
      starBox.appendChild(s);
      setTimeout(() => {
        s.classList.add('show');
        if (on) g.sound.click();
      }, 250 + i * 300);
    });
    const parts = [`${r.time.toFixed(1)} s`];
    if (r.newBest) parts.push('new best time');
    else if (r.best) parts.push(`best ${r.best.toFixed(1)} s`);
    if (!r.stars[1]) parts.push('missed the golden star');
    if (!r.stars[2]) parts.push(`beat ${lvl.timeLimit} s for the last star`);
    $('result-detail').textContent = parts.join(' · ');
  } else {
    $('result-detail').textContent = 'Change the build or try the run again.';
  }
  $('res-next').hidden = !r.won;
  $('res-retry').classList.toggle('go', !r.won);
  card.hidden = false;
  (r.won ? $('res-next') : $('res-retry')).focus();
}

export function hideResult() {
  $('result').hidden = true;
}

export function photoStatus(s) {
  $('photo-status').textContent = s;
}

