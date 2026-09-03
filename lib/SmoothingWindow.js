'use strict';

/**
 * Rolling time-window accumulator of per-interval energy contributions, used to
 * derive a "near instantaneous" but not jumpy grid share.
 */
module.exports = class SmoothingWindow {

  /** @param {number} windowMs */
  constructor(windowMs) {
    this.windowMs = windowMs;
    /** @type {{t:number, grid:number, pv:number, bat:number, total:number}[]} */
    this.samples = [];
  }

  /** @param {number} windowMs */
  setWindow(windowMs) {
    this.windowMs = windowMs;
  }

  /**
   * @param {{grid:number, pv:number, bat:number, total:number}} sample
   * @param {number} [now]
   */
  add(sample, now = Date.now()) {
    this.samples.push({ t: now, ...sample });
    this.prune(now);
  }

  /** @param {number} [now] */
  prune(now = Date.now()) {
    const cutoff = now - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].t < cutoff) {
      this.samples.shift();
    }
  }

  clear() {
    this.samples = [];
  }

  /**
   * @param {number} [now]
   * @returns {{gridShare:number, selfSufficiency:number}|null} null until there is energy in the window
   */
  shares(now = Date.now()) {
    this.prune(now);

    let grid = 0;
    let total = 0;
    for (const s of this.samples) {
      grid += s.grid;
      total += s.total;
    }
    if (total <= 0) return null;

    const gridShare = clamp((grid / total) * 100, 0, 100);
    return { gridShare, selfSufficiency: 100 - gridShare };
  }
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
