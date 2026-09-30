// Saved progress and settings. Storage can be missing (private windows, sandboxed previews),
// so every access is wrapped and the game works without it.

const KEY = 'pigrig.v1';

export class Store {
  constructor() {
    this.data = { stars: {}, best: {}, builds: {}, settings: {} };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch {
      /* storage unavailable: keep defaults */
    }
  }

  merge(data) {
    if (!data) return;
    for (const k of ['stars', 'best', 'builds', 'settings']) Object.assign(this.data[k], data[k] ?? {});
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  stars(id) {
    return this.data.stars[id] ?? [false, false, false];
  }

  record(id, stars, time) {
    const old = this.stars(id);
    this.data.stars[id] = old.map((s, i) => s || stars[i]);
    if (stars[0]) this.data.best[id] = Math.min(this.data.best[id] ?? Infinity, time);
    this.save();
  }

  totalStars() {
    return Object.values(this.data.stars).reduce((n, s) => n + s.filter(Boolean).length, 0);
  }

  setting(key, fallback) {
    return this.data.settings[key] ?? fallback;
  }

  set(key, value) {
    this.data.settings[key] = value;
    this.save();
  }
}
