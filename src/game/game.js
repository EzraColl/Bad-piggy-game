// Game flow: title demo, level select, building, driving, results and the ray-traced photo mode.

import * as THREE from 'three';
import { LEVELS, THEMES } from './levels.js';
import { PARTS } from './parts.js';
import { createTerrain } from './terrain.js';
import { LevelPhysics } from './physics.js';
import { Simulation, ScriptPilot, computeSpawn } from './simulation.js';
import { Builder } from './builder.js';
import { CameraRig } from './cameraRig.js';
import { WorldEnvironment } from '../render/environment.js';
import { LevelView } from '../render/levelView.js';
import { VehicleView } from '../render/vehicleView.js';
import { Effects } from '../render/effects.js';
import { PhotoMode } from '../render/photoMode.js';
import { QUALITY, QUALITY_ORDER } from '../render/graphics.js';
import { updateWind } from '../render/vegetation.js';
import * as ui from '../ui/ui.js';

const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'brake', ShiftRight: 'brake', Space: 'rocket',
};

const _v = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Game {
  constructor({ RAPIER, graphics, sound, store, thumbnails }) {
    this.R = RAPIER;
    this.gfx = graphics;
    this.sound = sound;
    this.store = store;
    this.thumbs = thumbnails;
    this.scene = graphics.scene;
    this.camera = graphics.camera;
    this.state = 'loading';
    this.keys = new Set();
    this.time = 0;
    this.world = null;
    this.sim = null;
    this.vehicleView = null;
    this.rig = new CameraRig(this.camera, graphics.canvas);
    this.photo = new PhotoMode(graphics);
    this.fps = { frames: 0, t: 0, value: 60 };
    this.autoQuality = { t: 0, frames: 0, done: !!store.setting('qualityChosen', false) };
    graphics.onResize = (h, fov) => this.world?.effects.setPixelScale(h, fov);
    this._bindInput();
    ui.bind(this);
  }

  // ------------------------------------------------------------------ worlds

  async loadWorld(level, onProgress) {
    if (this.world?.level === level) return this.world;
    this._endRun();
    this._disposeWorld();
    const theme = THEMES[level.theme];
    const q = this.gfx.quality;
    onProgress?.(0.1, 'Shaping the valley…');
    await tick();
    const terrain = createTerrain(level);
    const env = new WorldEnvironment(this.gfx.renderer, this.scene, theme, q);
    this.gfx.renderer.toneMappingExposure = theme.exposure * 1.12;
    onProgress?.(0.35, 'Growing grass and trees…');
    await tick();
    const displayPhys = new LevelPhysics(this.R, level, terrain);
    const levelView = new LevelView(level, terrain, displayPhys, theme, q);
    this.scene.add(levelView.group);
    onProgress?.(0.8, 'Setting up the workshop…');
    await tick();
    const effects = new Effects(this.scene, terrain);
    const spawn = computeSpawn(terrain, level, level.grid);
    env.follow(spawn);
    const builder = new Builder({
      scene: this.scene,
      camera: this.camera,
      dom: this.gfx.canvas,
      level,
      origin: spawn,
      sound: this.sound,
      onChange: () => ui.refreshBuild(this),
    });
    builder.onReject = (why) => ui.toast(why === 'none-left' ? `No ${PARTS[builder.selected].name.toLowerCase()}s left in this level` : 'That spot is taken');
    builder.enable(false);
    this.world = { level, theme, terrain, env, displayPhys, levelView, effects, builder, spawn };
    effects.setPixelScale(this.gfx.renderer.domElement.height, this.camera.fov);
    // compile shaders now rather than stuttering on the first frame
    this.gfx.renderer.compile(this.scene, this.camera);
    this.gfx.resetAdapt();
    onProgress?.(1, '');
    return this.world;
  }

  _disposeWorld() {
    const w = this.world;
    if (!w) return;
    w.builder.dispose();
    w.effects.dispose();
    this.scene.remove(w.levelView.group);
    w.levelView.dispose();
    w.env.dispose();
    w.displayPhys.dispose();
    this.world = null;
  }

  // ------------------------------------------------------------------ screens

  async showTitle() {
    ui.show('title');
    this.state = 'title';
    await this.loadWorld(LEVELS[0]);
    this._startDemo();
  }

  showLevels() {
    if (this.world) {
      this.world.builder.enable(false);
      if (!this.demo) this._startDemo();
    }
    this.sound.silence();
    ui.renderLevels(this);
    ui.show('levels');
    this.state = 'levels';
  }

  async openLevel(level) {
    ui.show('loading');
    ui.loading(0.05, 'Loading ' + level.name + '…');
    this.demo = false;
    this._endRun();
    await this.loadWorld(level, (p, text) => ui.loading(p, text));
    this.enterBuild();
    const saved = this.store.data.builds[level.id];
    const [nx, , nz] = level.grid;
    // first visit: the pig is already sitting in the middle of the grid
    this.world.builder.load(saved?.length ? saved : [['pig', Math.floor(nx / 2), 0, Math.floor(nz / 2)]], false);
    this.world.builder.history.length = 0;
    ui.refreshBuild(this);
  }

  enterBuild() {
    this._endRun();
    const w = this.world;
    w.levelView.setPhysics(w.displayPhys);
    w.effects.clear();
    w.builder.enable(true);
    this.rig.enabled = false;
    this.state = 'build';
    document.activeElement?.blur?.();
    ui.setupBuild(this);
    ui.show('build');
    this.sound.silence();
  }

  // ------------------------------------------------------------------ runs

  _startDemo() {
    const level = this.world.level;
    this.demo = true;
    this._beginSim(level.solution);
    this.pilot = new ScriptPilot(this.sim, level.script);
    this.rig.distance = 10;
    this.rig.pitch = 0.22;
    this.rig.enabled = false;
  }

  _beginSim(cells) {
    const w = this.world;
    this._endRun();
    const bp = { dims: w.level.grid, cells };
    const sim = new Simulation(this.R, w.level, bp, w.terrain);
    this.sim = sim;
    const pose = (rb, p, q) => sim.pose(rb, p, q); // smooth, interpolated transforms for drawing
    w.levelView.setPhysics(sim.phys, pose);
    w.effects.clear();
    this.vehicleView = new VehicleView(this.scene, sim.car, w.effects, w.terrain, w.theme, pose);
    this.pose = pose;
    const pig = this.sim.car.pigPosition();
    this.rig.reset(pig, 0, Math.max(...w.level.grid));
    this.resultShown = false;
  }

  startRun() {
    const w = this.world;
    if (!w.builder.hasPig()) {
      ui.toast('Add the pig first. Nobody to drive!');
      return;
    }
    const loose = w.builder.looseParts();
    if (loose > 0) ui.toast(`${loose} part${loose > 1 ? 's are' : ' is'} not attached to the pig's ride and will fall off`);
    const cells = w.builder.cellsArray();
    this.store.data.builds[w.level.id] = cells;
    this.store.save();
    w.builder.enable(false);
    this.demo = false;
    this._beginSim(cells);
    this.rig.enabled = true;
    this.state = 'play';
    document.activeElement?.blur?.(); // so Space fires rockets instead of re-clicking a button
    ui.setupPlay(this);
    ui.show('play');
    this.sound.unlock();
    this.sound.oink();
  }

  restart() {
    if (!this.sim || this.demo) return;
    ui.hideResult();
    this.startRun();
  }

  _endRun() {
    if (this.vehicleView) {
      this.vehicleView.dispose();
      this.vehicleView = null;
    }
    if (this.sim) {
      this.sim.dispose();
      this.sim = null;
    }
    ui.hideResult();
  }

  nextLevel() {
    const i = LEVELS.indexOf(this.world.level);
    const next = LEVELS[i + 1];
    if (next) this.openLevel(next);
    else this.showLevels();
  }

  // ------------------------------------------------------------------ photo mode

  async enterPhoto() {
    if (this.state !== 'play' && this.state !== 'build') return;
    const w = this.world;
    this.photoReturn = this.state;
    this.state = 'photo';
    ui.show('photo');
    ui.photoStatus('Preparing…');
    this.sound.silence();
    const objects = this.photoReturn === 'play' ? this.vehicleView.objects() : w.builder.partsGroup;
    const focus = this.photoReturn === 'play' ? this.sim.car.pigPosition() : w.builder.centre.clone();
    try {
      await this.photo.start({
        camera: this.camera,
        env: w.env,
        levelView: w.levelView,
        vehicleView: { objects: () => objects },
        focus,
        onStatus: (s) => ui.photoStatus(s),
      });
      this.photoStart = performance.now();
    } catch (err) {
      console.error(err);
      ui.toast('Ray tracing is not supported by this browser or graphics chip');
      this.exitPhoto();
    }
  }

  exitPhoto() {
    if (this.state !== 'photo') return;
    this.photo.stop();
    this.state = this.photoReturn;
    this.gfx.resize();
    ui.show(this.state === 'play' ? 'play' : 'build');
  }

  async savePhoto() {
    const url = this.photo.snapshot();
    const filename = `pig-rig-${this.world.level.id}-${Date.now()}.png`;
    if (this.downloads) {
      const bin = atob(url.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      try {
        const res = await this.downloads.save({ filename, data: new Blob([bytes], { type: 'image/png' }) });
        if (res?.status === 'saved') ui.toast('Photo saved');
      } catch (err) {
        if (err?.code !== 'declined') ui.toast('Saving is not available here');
      }
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }

  // ------------------------------------------------------------------ input

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.sound.unlock();
      const k = KEYMAP[e.code];
      if (k) {
        this.keys.add(k);
        if (this.state === 'play' || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      }
      if (e.repeat) return;
      this._keyAction(e);
    });
    window.addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k) this.keys.delete(k);
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', () => this.sound.unlock(), { once: false });
  }

  _keyAction(e) {
    const s = this.state;
    if (ui.modalOpen()) {
      if (e.code === 'Escape') ui.closeModals();
      return;
    }
    if (s === 'play') {
      const sim = this.sim;
      switch (e.code) {
        case 'KeyF': sim.toggleFans(); break;
        case 'KeyB': if (sim.popBalloon()) this.sound.pop(); break;
        case 'KeyT': sim.detonate(); break;
        case 'KeyC': ui.toast(this.rig.toggleMode() === 'side' ? 'Side view' : 'Chase view'); break;
        case 'KeyR': this.restart(); break;
        case 'KeyP': this.enterPhoto(); break;
        case 'Escape': case 'Backspace': this.enterBuild(); break;
        case 'KeyH': ui.openModal('help'); break;
      }
    } else if (s === 'build') {
      const b = this.world.builder;
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5)) - 1;
        const list = ui.paletteTypes(this);
        if (list[n]) b.select(list[n]);
      } else if (e.code === 'KeyR') {
        ui.toast('Thrust: ' + b.rotate());
      } else if (e.code === 'KeyX' || e.code === 'Delete') {
        b.setEraser(!b.eraser);
      } else if (e.code === 'KeyI') {
        ui.toggleInside(this);
      } else if (e.code === 'KeyM') {
        ui.toggleMirror(this);
      } else if (e.code === 'KeyQ' || e.code === 'KeyE') {
        b.turn(e.code === 'KeyQ' ? -1 : 1);
      } else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
        b.undo();
      } else if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.startRun();
      } else if (e.code === 'KeyP') {
        this.enterPhoto();
      } else if (e.code === 'Escape') {
        this.showLevels();
      } else if (e.code === 'KeyH') {
        ui.openModal('help');
      }
    } else if (s === 'photo') {
      if (e.code === 'Escape' || e.code === 'KeyP') this.exitPhoto();
    } else if (s === 'result') {
      if (e.code === 'KeyR') this.restart();
      if (e.code === 'Escape') this.enterBuild();
    }
  }

  // Keys are on/off, so ease the steering and throttle in and out like a real wheel and pedal.
  _input(dt) {
    const k = this.keys;
    const input = this.sim.input;
    const throttle = (k.has('forward') ? 1 : 0) - (k.has('back') ? 1 : 0);
    const steer = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
    input.throttle = approach(input.throttle, throttle, dt * (throttle === 0 || Math.sign(throttle) !== Math.sign(input.throttle) ? 9 : 4.5));
    input.steer = approach(input.steer, steer, dt * (steer === 0 ? 7 : 4));
    input.brake = k.has('brake');
    input.rocket = k.has('rocket');
  }

  // ------------------------------------------------------------------ frame

  update(dt) {
    this.time += dt;
    const w = this.world;
    this._measure(dt);
    if (!w) return;

    if (this.state === 'photo') {
      if (!this.photo.tracer) return; // still building the scene
      this.photo.render();
      ui.photoStatus(`${this.photo.samples} samples · ${((performance.now() - this.photoStart) / 1000).toFixed(0)} s · keeps getting cleaner the longer you wait`);
      return;
    }

    updateWind(this.time);
    w.env.update(this.time);

    if (this.sim) {
      if (this.demo) {
        this.pilot.update();
        if (this.sim.state !== 'running' || this.sim.time > 40) this._startDemo();
      } else if (this.state === 'play') {
        this._input(dt);
      } else {
        this.sim.input.throttle = 0;
        this.sim.input.steer = 0;
        this.sim.input.rocket = false;
      }
      if (this.sim) {
        this.sim.update(dt);
        this._events();
        this.vehicleView?.sync(dt);
        this._followCamera(dt);
        if (!this.demo) {
          ui.updatePlay(this);
          this._drivingSound();
        }
      }
    }

    if (this.state === 'build') {
      w.builder.update(dt);
      w.env.follow(w.builder.centre);
      this.gfx.setProbeFocus(w.builder.centre, [w.builder.group]);
    }

    w.levelView.update(dt, this.camera);
    w.effects.update(dt);
    this.gfx.adapt(dt);
    this.gfx.render();
  }

  _followCamera(dt) {
    const car = this.sim.car;
    const rec = car.pig.body;
    // follow the pig's smoothed position so the camera glides instead of ticking with physics steps
    const focus = _v;
    car.partRenderTransform(car.pig, this.pose, focus, _q);
    this.pose(rec.rb, _p2, _q);
    const lv = rec.rb.linvel();
    const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
    if (this.demo) {
      this.rig.yawOffset = Math.sin(this.time * 0.12) * 0.9 + 0.5;
    }
    this.rig.update(dt, focus, fwd, vel, this.world.terrain, this.world.effects.shake);
    this.world.env.follow(focus);
    this.gfx.setProbeFocus(focus.clone().add(new THREE.Vector3(0, 1.2, 0)), [this.vehicleView.group]);
  }

  _events() {
    const sim = this.sim;
    const w = this.world;
    for (const e of sim.events) {
      this.vehicleView?.handle(e);
      if (this.demo && !['explosion', 'star'].includes(e.type)) continue;
      switch (e.type) {
        case 'explosion':
          w.effects.explosion(e.pos, e.power);
          if (!this.demo) this.sound.explosion(e.power);
          break;
        case 'pop':
          this.sound.pop();
          break;
        case 'impact':
          if (e.force > 5000) this.sound.impact(e.force);
          if (e.force > 9000) for (let i = 0; i < 4; i++) w.effects.dust(e.pos, 1.4);
          break;
        case 'break':
        case 'destroy':
          this.sound.crunch();
          break;
        case 'splinter':
          w.effects.splinters(e.pos, 9);
          this.sound.crunch();
          break;
        case 'star':
          w.levelView.collectStar();
          w.effects.sparkle(e.pos);
          if (!this.demo) {
            this.sound.star();
            ui.toast('Golden star!');
          }
          break;
        case 'fansOn':
        case 'fansOff':
          this.sound.click();
          break;
        case 'win':
          this._win(e.time);
          break;
        case 'fail':
          this._fail();
          break;
      }
    }
    sim.events.length = 0;
  }

  _win(time) {
    const w = this.world;
    const stars = this.sim.stars();
    const arr = [stars.finish, stars.star, stars.time];
    const prevBest = this.store.data.best[w.level.id];
    this.store.record(w.level.id, arr, time);
    this.sound.win();
    setTimeout(() => this.sound.oink(), 500);
    w.effects.confetti(this.sim.car.pigPosition().add(new THREE.Vector3(2, 1, 0)));
    setTimeout(() => {
      if (this.state !== 'play' || !this.sim || this.sim.state !== 'won') return;
      this.state = 'result';
      ui.showResult(this, { won: true, stars: arr, time, best: Math.min(prevBest ?? Infinity, time), newBest: !prevBest || time < prevBest });
    }, 1600);
  }

  _fail() {
    this.sound.fail();
    setTimeout(() => {
      if (this.state !== 'play' || !this.sim || this.sim.state !== 'failed') return;
      this.state = 'result';
      ui.showResult(this, { won: false });
    }, 1000);
  }

  _drivingSound() {
    const car = this.sim.car;
    const engines = car.alive('engine').length;
    let rpm = 0;
    let n = 0;
    for (const wh of car.wheels) {
      if (!wh.alive || !wh.susJoint) continue;
      const a = wh.wheelBody.angvel();
      rpm += Math.hypot(a.x, a.y, a.z);
      n++;
    }
    rpm = n ? rpm / n : 0;
    this.sound.drive({
      engines: this.state === 'play' ? engines : 0,
      throttle: this.sim.input.throttle,
      rpm,
      fans: car.fansOn && car.alive('fan').length > 0,
      rockets: car.parts.filter((p) => p.alive && p.firing).length,
      speed: car.speed(),
      ambient: 0.03,
    });
  }

  _measure(dt) {
    const f = this.fps;
    f.frames++;
    f.t += dt;
    if (f.t >= 0.5) {
      f.value = f.frames / f.t;
      f.frames = 0;
      f.t = 0;
      ui.fps(f.value);
    }
    // One-time automatic downgrade if the first drive is choppy.
    const a = this.autoQuality;
    if (!a.done && this.state === 'play') {
      a.t += dt;
      a.frames++;
      if (a.t > 5) {
        a.done = true;
        const fps = a.frames / a.t;
        const i = QUALITY_ORDER.indexOf(this.gfx.qualityName);
        if (fps < 34 && i > 0) {
          const next = QUALITY_ORDER[i - 1];
          this.setQuality(next, false);
          ui.toast(`Graphics set to ${QUALITY[next].label} for smoother driving. Change it in Settings.`);
        }
      }
    }
  }

  setQuality(name, manual = true) {
    this.gfx.setQuality(name);
    this.world?.env.setQuality(this.gfx.quality);
    this.world?.effects.setPixelScale(this.gfx.renderer.domElement.height, this.camera.fov);
    this.store.set('quality', name);
    if (manual) {
      this.store.set('qualityChosen', true);
      this.autoQuality.done = true;
    }
  }
}

function approach(value, target, maxStep) {
  if (value < target) return Math.min(target, value + maxStep);
  return Math.max(target, value - maxStep);
}

function tick() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

