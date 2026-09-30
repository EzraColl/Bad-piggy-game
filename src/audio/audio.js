// All sound is synthesised with the Web Audio API: engine, propellers, rockets, wind, explosions,
// pops, crashes, jingles and the pig's oink.

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.loops = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.noise = this._noiseBuffer();
      this._startLoops();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  _noiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      brown = (brown + 0.02 * w) / 1.02;
      d[i] = w * 0.6 + brown * 2.5;
    }
    return b;
  }

  _noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  _startLoops() {
    const ctx = this.ctx;
    const L = {};
    // engine: two detuned saws through a lowpass and soft clipper
    L.engineGain = ctx.createGain();
    L.engineGain.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.5);
    }
    shaper.curve = curve;
    L.engineFilter = ctx.createBiquadFilter();
    L.engineFilter.type = 'lowpass';
    L.engineFilter.frequency.value = 600;
    L.engineFilter.Q.value = 3;
    L.osc1 = ctx.createOscillator();
    L.osc1.type = 'sawtooth';
    L.osc2 = ctx.createOscillator();
    L.osc2.type = 'square';
    L.osc1.frequency.value = 42;
    L.osc2.frequency.value = 21;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    L.osc1.connect(shaper);
    L.osc2.connect(g2).connect(shaper);
    // amplitude chop gives the V8 burble
    L.chop = ctx.createOscillator();
    L.chop.type = 'square';
    L.chop.frequency.value = 12;
    const chopGain = ctx.createGain();
    chopGain.gain.value = 0.25;
    const chopped = ctx.createGain();
    chopped.gain.value = 0.75;
    L.chop.connect(chopGain).connect(chopped.gain);
    shaper.connect(L.engineFilter).connect(chopped).connect(L.engineGain).connect(this.master);
    L.osc1.start();
    L.osc2.start();
    L.chop.start();

    // propeller: band-passed noise with blade-rate tremolo
    L.fanGain = ctx.createGain();
    L.fanGain.gain.value = 0;
    const fanNoise = this._noiseSource();
    const fanBP = ctx.createBiquadFilter();
    fanBP.type = 'bandpass';
    fanBP.frequency.value = 380;
    fanBP.Q.value = 1.2;
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    L.fanLfo = ctx.createOscillator();
    L.fanLfo.frequency.value = 28;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.4;
    L.fanLfo.connect(lfoAmt).connect(trem.gain);
    fanNoise.connect(fanBP).connect(trem).connect(L.fanGain).connect(this.master);
    fanNoise.start();
    L.fanLfo.start();

    // rocket: roaring noise
    L.rocketGain = ctx.createGain();
    L.rocketGain.gain.value = 0;
    const rn = this._noiseSource();
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 1400;
    const rhp = ctx.createBiquadFilter();
    rhp.type = 'highpass';
    rhp.frequency.value = 90;
    rn.connect(rhp).connect(rlp).connect(L.rocketGain).connect(this.master);
    rn.start();

    // wind rush that grows with speed
    L.windGain = ctx.createGain();
    L.windGain.gain.value = 0;
    const wn = this._noiseSource();
    L.windFilter = ctx.createBiquadFilter();
    L.windFilter.type = 'bandpass';
    L.windFilter.frequency.value = 500;
    L.windFilter.Q.value = 0.6;
    wn.connect(L.windFilter).connect(L.windGain).connect(this.master);
    wn.start();

    // ambient birds / breeze bed
    L.ambGain = ctx.createGain();
    L.ambGain.gain.value = 0;
    const an = this._noiseSource();
    const alp = ctx.createBiquadFilter();
    alp.type = 'lowpass';
    alp.frequency.value = 350;
    an.connect(alp).connect(L.ambGain).connect(this.master);
    an.start();
    this.loops = L;
  }

  // Called every frame while driving.
  drive({ engines = 0, throttle = 0, rpm = 0, fans = false, rockets = 0, speed = 0, ambient = 0.05 }) {
    if (!this.ctx || !this.loops) return;
    const L = this.loops;
    const t = this.ctx.currentTime;
    const on = engines > 0;
    const load = Math.abs(throttle);
    const base = 38 + rpm * 2.6 + load * 12;
    L.osc1.frequency.setTargetAtTime(base, t, 0.08);
    L.osc2.frequency.setTargetAtTime(base * 0.5 + 1.5, t, 0.08);
    L.chop.frequency.setTargetAtTime(base / 3.2, t, 0.08);
    L.engineFilter.frequency.setTargetAtTime(380 + load * 900 + rpm * 18, t, 0.08);
    L.engineGain.gain.setTargetAtTime(on ? 0.1 + load * 0.16 : 0, t, 0.1);
    L.fanGain.gain.setTargetAtTime(fans ? 0.22 : 0, t, 0.15);
    L.rocketGain.gain.setTargetAtTime(rockets > 0 ? 0.3 + 0.12 * Math.min(rockets, 4) : 0, t, 0.05);
    L.windGain.gain.setTargetAtTime(Math.min(0.25, speed * speed * 0.0006), t, 0.2);
    L.windFilter.frequency.setTargetAtTime(300 + speed * 40, t, 0.2);
    L.ambGain.gain.setTargetAtTime(ambient, t, 0.5);
  }

  silence() {
    if (!this.loops) return;
    this.drive({ ambient: 0.04 });
  }

  _env(gainNode, t0, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  _burst({ freq = 800, type = 'lowpass', q = 0.7, peak = 0.5, attack = 0.005, decay = 0.3, sweepTo = null, delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + attack + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t0, attack, peak, decay);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + attack + decay + 0.05);
  }

  _tone({ freq = 440, to = null, type = 'sine', peak = 0.3, attack = 0.005, decay = 0.2, delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + attack + decay);
    const g = ctx.createGain();
    this._env(g, t0, attack, peak, decay);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + attack + decay + 0.05);
  }

  explosion(power = 1) {
    this._burst({ freq: 2600, sweepTo: 120, peak: 0.9 * power, attack: 0.004, decay: 1.6, q: 0.5 });
    this._tone({ freq: 90, to: 28, type: 'sine', peak: 0.9 * power, decay: 0.9 });
    this._burst({ freq: 300, sweepTo: 60, peak: 0.4 * power, attack: 0.05, decay: 2.2, delay: 0.08 });
  }

  pop() {
    this._burst({ freq: 2200, type: 'highpass', peak: 0.55, attack: 0.001, decay: 0.07 });
    this._tone({ freq: 1400, to: 500, type: 'triangle', peak: 0.15, decay: 0.06 });
  }

  impact(force) {
    const k = Math.min(1, force / 30000);
    this._burst({ freq: 350 + k * 700, sweepTo: 120, peak: 0.12 + k * 0.5, attack: 0.002, decay: 0.12 + k * 0.25, q: 1.1 });
    if (k > 0.4) this._tone({ freq: 70, to: 40, peak: k * 0.4, decay: 0.2 });
  }

  crunch() {
    this._burst({ freq: 1800, sweepTo: 300, peak: 0.35, attack: 0.002, decay: 0.2, q: 2 });
    this._burst({ freq: 600, type: 'bandpass', peak: 0.25, attack: 0.002, decay: 0.12, q: 4, delay: 0.04 });
  }

  place() {
    this._tone({ freq: 240, to: 180, type: 'triangle', peak: 0.28, decay: 0.09 });
    this._burst({ freq: 3000, type: 'bandpass', peak: 0.12, decay: 0.03, q: 3 });
  }

  remove() {
    this._tone({ freq: 160, to: 90, type: 'triangle', peak: 0.25, decay: 0.12 });
  }

  click() {
    this._tone({ freq: 880, to: 1100, type: 'sine', peak: 0.12, decay: 0.04 });
  }

  star() {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this._tone({ freq: f, type: 'triangle', peak: 0.22, decay: 0.35, delay: i * 0.07 }));
  }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this._tone({ freq: f, type: 'square', peak: 0.1, decay: i === notes.length - 1 ? 0.9 : 0.18, delay: i * 0.13 });
      this._tone({ freq: f / 2, type: 'triangle', peak: 0.18, decay: i === notes.length - 1 ? 0.9 : 0.18, delay: i * 0.13 });
    });
  }

  fail() {
    [392, 349.2, 311.1, 261.6].forEach((f, i) => this._tone({ freq: f, to: f * 0.97, type: 'triangle', peak: 0.2, decay: 0.3, delay: i * 0.22 }));
  }

  oink() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    for (let k = 0; k < 2; k++) {
      const t = t0 + k * 0.22;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(115, t + 0.18);
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 750;
      f1.Q.value = 4;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.value = 1300;
      f2.Q.value = 5;
      const g = ctx.createGain();
      this._env(g, t, 0.02, 0.5, 0.18);
      o.connect(f1).connect(g);
      o.connect(f2).connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.25);
      this._burst({ freq: 900, type: 'bandpass', peak: 0.1, attack: 0.01, decay: 0.15, q: 2, delay: k * 0.22 });
    }
  }
}
