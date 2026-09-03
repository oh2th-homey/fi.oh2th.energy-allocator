'use strict';

/**
 * Generates flat-illustration placeholder PNGs for the app and drivers so
 * `homey app validate` passes and the images look presentable in the app store /
 * device tiles. Pure Node (no native deps): a tiny supersampled 2D rasteriser +
 * hand-rolled PNG (RGBA) encoder.
 *
 * Replace these with real artwork before publishing.
 *
 * Usage: node tools/make-assets.js   (or: npm run assets)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// PNG encoding (truecolour + alpha)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((1 + width * 4) * height);
  let p = 0;
  let s = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width * 4; x++) raw[p++] = rgba[s++];
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Minimal 2D rasteriser (drawn in a 0..100 x 0..100*(h/w) space, supersampled)
// ---------------------------------------------------------------------------

const SS = 3;

class Canvas {
  constructor(w, h) {
    this.w = w * SS;
    this.h = h * SS;
    this.outW = w;
    this.outH = h;
    this.buf = new Float32Array(this.w * this.h * 4); // premultiplied-ish, straight alpha
    this.scale = this.w / 100;
  }

  _px(x, y, [r, g, b], a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4;
    const inv = 1 - a;
    this.buf[i] = r * a + this.buf[i] * inv;
    this.buf[i + 1] = g * a + this.buf[i + 1] * inv;
    this.buf[i + 2] = b * a + this.buf[i + 2] * inv;
    this.buf[i + 3] = a + this.buf[i + 3] * inv;
  }

  clear(color, a = 1) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this._px(x, y, color, a);
  }

  /** vertical gradient between two colours across the whole canvas */
  gradient(top, bottom) {
    for (let y = 0; y < this.h; y++) {
      const t = y / (this.h - 1);
      const c = [
        top[0] + (bottom[0] - top[0]) * t,
        top[1] + (bottom[1] - top[1]) * t,
        top[2] + (bottom[2] - top[2]) * t,
      ];
      for (let x = 0; x < this.w; x++) this._px(x, y, c, 1);
    }
  }

  rect(x, y, w, h, color, a = 1) {
    const x0 = Math.round(x * this.scale);
    const y0 = Math.round(y * this.scale);
    const x1 = Math.round((x + w) * this.scale);
    const y1 = Math.round((y + h) * this.scale);
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) this._px(px, py, color, a);
  }

  roundRect(x, y, w, h, r, color, a = 1) {
    this.polygon(roundRectPoints(x, y, w, h, r), color, a);
  }

  circle(cx, cy, rad, color, a = 1) {
    const s = this.scale;
    const c = [cx * s, cy * s];
    const r = rad * s;
    const x0 = Math.floor(c[0] - r - 1);
    const x1 = Math.ceil(c[0] + r + 1);
    const y0 = Math.floor(c[1] - r - 1);
    const y1 = Math.ceil(c[1] + r + 1);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const d = Math.hypot(px + 0.5 - c[0], py + 0.5 - c[1]);
        if (d <= r) this._px(px, py, color, a);
        else if (d <= r + 1) this._px(px, py, color, a * (r + 1 - d));
      }
    }
  }

  polygon(points, color, a = 1) {
    const s = this.scale;
    const pts = points.map(([px, py]) => [px * s, py * s]);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, py] of pts) { minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(this.h - 1, Math.ceil(maxY));
    for (let y = minY; y <= maxY; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
          xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.round(xs[k]);
        const to = Math.round(xs[k + 1]);
        for (let x = from; x < to; x++) this._px(x, y, color, a);
      }
    }
  }

  line(x1, y1, x2, y2, width, color, a = 1) {
    const s = this.scale;
    const ax = x1 * s;
    const ay = y1 * s;
    const bx = x2 * s;
    const by = y2 * s;
    const half = (width * s) / 2;
    const x0 = Math.floor(Math.min(ax, bx) - half - 1);
    const xe = Math.ceil(Math.max(ax, bx) + half + 1);
    const y0 = Math.floor(Math.min(ay, by) - half - 1);
    const ye = Math.ceil(Math.max(ay, by) + half + 1);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    for (let py = y0; py < ye; py++) {
      for (let px = x0; px < xe; px++) {
        let t = ((px + 0.5 - ax) * dx + (py + 0.5 - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(px + 0.5 - (ax + t * dx), py + 0.5 - (ay + t * dy));
        if (d <= half) this._px(px, py, color, a);
        else if (d <= half + 1) this._px(px, py, color, a * (half + 1 - d));
      }
    }
  }

  strokePath(points, color, width, closed = true) {
    const n = points.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      this.line(a[0], a[1], b[0], b[1], width, color);
    }
    for (const p of points) this.circle(p[0], p[1], width / 2, color);
  }

  quadStroke(x0, y0, cx, cy, x1, y1, width, color, steps = 28) {
    let prev = [x0, y0];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
      const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
      this.line(prev[0], prev[1], x, y, width, color);
      prev = [x, y];
    }
  }

  radialCircle(cx, cy, rad, inner, outer, a = 1) {
    const s = this.scale;
    const c = [cx * s, cy * s];
    const r = rad * s;
    for (let py = Math.floor(c[1] - r - 1); py < Math.ceil(c[1] + r + 1); py++) {
      for (let px = Math.floor(c[0] - r - 1); px < Math.ceil(c[0] + r + 1); px++) {
        const d = Math.hypot(px + 0.5 - c[0], py + 0.5 - c[1]);
        if (d > r + 1) continue;
        const t = Math.min(1, d / r);
        const col = [
          inner[0] + (outer[0] - inner[0]) * t,
          inner[1] + (outer[1] - inner[1]) * t,
          inner[2] + (outer[2] - inner[2]) * t,
        ];
        this._px(px, py, col, d <= r ? a : a * (r + 1 - d));
      }
    }
  }

  /** downsample the supersampled buffer to a straight-alpha RGBA Uint8 buffer */
  toRGBA() {
    const out = new Uint8ClampedArray(this.outW * this.outH * 4);
    let o = 0;
    for (let y = 0; y < this.outH; y++) {
      for (let x = 0; x < this.outW; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const i = ((y * SS + sy) * this.w + (x * SS + sx)) * 4;
            r += this.buf[i];
            g += this.buf[i + 1];
            b += this.buf[i + 2];
            a += this.buf[i + 3];
          }
        }
        const n = SS * SS;
        out[o++] = r / n;
        out[o++] = g / n;
        out[o++] = b / n;
        out[o++] = (a / n) * 255;
      }
    }
    return out;
  }
}

function roundRectPoints(x, y, w, h, r) {
  const steps = 8;
  const pts = [];
  const corner = (cx, cy, start) => {
    for (let i = 0; i <= steps; i++) {
      const ang = start + (Math.PI / 2) * (i / steps);
      pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return pts;
}

// ---------------------------------------------------------------------------
// Colours + scenes
// ---------------------------------------------------------------------------

const C = {
  white: [255, 255, 255],
  outline: [40, 44, 66],
  skyTop: [176, 220, 255],
  skyBottom: [233, 245, 255],
  grass: [124, 196, 82],
  grassDark: [95, 168, 56],
  sunCore: [255, 214, 77],
  sunEdge: [255, 168, 46],
  ray: [255, 197, 51],
  wall: [246, 190, 108],
  wallShade: [232, 165, 84],
  roof: [92, 107, 128],
  roofDark: [70, 84, 104],
  door: [138, 90, 43],
  knob: [255, 220, 130],
  glass: [186, 227, 242],
  chimney: [192, 102, 60],
  panelFrame: [32, 44, 88],
  panelCell: [46, 96, 172],
  panelCellHi: [70, 130, 214],
  glare: [255, 255, 255],
  pylon: [126, 140, 163],
  pylonDark: [74, 84, 104],
  wire: [40, 44, 66],
  card: [255, 255, 255],
  barGrid: [138, 148, 166],
  barSolar: [255, 197, 51],
  barBattery: [86, 194, 113],
  baseline: [201, 210, 222],
};

function circlePoints(cx, cy, r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/**
 * Cartoon hero illustration: a house with rooftop solar panels, the sun lighting
 * the panels, a grid pylon wired to the house, and a 3-bar breakdown card in
 * front. Logical box is 100 wide by `100 * ratio` tall (ratio ≈ 0.7).
 */
function energyScene(cv, ratio) {
  const H = 100 * ratio;
  const g = H * 0.82; // ground line

  cv.gradient(C.skyTop, C.skyBottom);

  cv.polygon([[0, g], [100, g - 2], [100, H], [0, H]], C.grass);
  cv.polygon([[0, H - 3.5], [100, H - 5], [100, H], [0, H]], C.grassDark);
  cv.line(0, g, 100, g - 2, 0.7, C.grassDark);

  // --- sun (top-left) ---
  const sx = 15;
  const sy = H * 0.19;
  const sr = 8.5;
  for (let i = 0; i < 12; i++) {
    const ang = (Math.PI / 6) * i + 0.25;
    const long = i % 3 === 0;
    cv.line(
      sx + Math.cos(ang) * (sr + 1.5), sy + Math.sin(ang) * (sr + 1.5),
      sx + Math.cos(ang) * (sr + (long ? 8 : 4.5)), sy + Math.sin(ang) * (sr + (long ? 8 : 4.5)),
      long ? 2.4 : 1.6, C.ray,
    );
  }
  cv.radialCircle(sx, sy, sr, C.sunCore, C.sunEdge);
  cv.strokePath(circlePoints(sx, sy, sr, 44), C.outline, 1.1);

  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    cv.line(sx + 5 + t * 3, sy + 5 + t * 2, 34 + t * 12, H * 0.30 + t * 3, 3.4, C.ray, 0.22);
  }

  // --- pylon + wires (right) ---
  const px = 85;
  const pTop = H * 0.15;
  const pBot = g;
  cv.line(px - 8, pBot, px - 2.4, pTop, 2.0, C.pylon);
  cv.line(px + 8, pBot, px + 2.4, pTop, 2.0, C.pylon);
  cv.line(px - 8, pBot, px + 8, pBot, 2.0, C.pylon);
  for (let k = 0; k < 5; k++) {
    const y1 = pBot - (pBot - pTop) * (k / 5);
    const y2 = pBot - (pBot - pTop) * ((k + 1) / 5);
    const s1 = 8 - 5.6 * (k / 5);
    const s2 = 8 - 5.6 * ((k + 1) / 5);
    cv.line(px - s1, y1, px + s2, y2, 1.0, C.pylonDark);
    cv.line(px + s1, y1, px - s2, y2, 1.0, C.pylonDark);
  }
  cv.line(px - 12, pTop + 4, px + 12, pTop + 4, 1.8, C.pylon);
  cv.line(px - 9, pTop + 9, px + 9, pTop + 9, 1.8, C.pylon);

  // house geometry
  const hx = 29;
  const hw = 34;
  const hTop = H * 0.42;
  const hBot = g;

  cv.quadStroke(px - 12, pTop + 4, 58, H * 0.26, hx + hw - 1, H * 0.36, 0.8, C.wire);
  cv.quadStroke(px - 9, pTop + 9, 58, H * 0.33, hx + hw - 1, H * 0.42, 0.8, C.wire);

  // --- house ---
  cv.rect(hx + 7, H * 0.22, 5.5, 11, C.chimney);
  cv.strokePath([[hx + 7, H * 0.22], [hx + 12.5, H * 0.22], [hx + 12.5, hTop], [hx + 7, hTop]], C.outline, 1.0, false);

  const roofPts = [[hx - 5, hTop], [hx + hw + 5, hTop], [hx + hw / 2, hTop - 15]];
  cv.polygon(roofPts, C.roof);
  cv.polygon([[hx - 5, hTop], [hx + hw + 5, hTop], [hx + hw + 5, hTop + 2.6], [hx - 5, hTop + 2.6]], C.roofDark);
  cv.strokePath(roofPts, C.outline, 1.2);

  cv.rect(hx, hTop, hw, hBot - hTop, C.wall);
  cv.rect(hx + hw - 6, hTop, 6, hBot - hTop, C.wallShade);
  cv.strokePath([[hx, hTop], [hx + hw, hTop], [hx + hw, hBot], [hx, hBot]], C.outline, 1.2);

  const dw = 8;
  const dh = (hBot - hTop) * 0.5;
  const dx = hx + hw * 0.5 - dw / 2;
  cv.rect(dx, hBot - dh, dw, dh, C.door);
  cv.strokePath([[dx, hBot - dh], [dx + dw, hBot - dh], [dx + dw, hBot], [dx, hBot]], C.outline, 1.0, false);
  cv.circle(dx + dw * 0.75, hBot - dh * 0.5, 0.9, C.knob);

  const wx = hx + 4.5;
  const wy = hTop + 5.5;
  const ws = 8;
  cv.rect(wx, wy, ws, ws, C.glass);
  cv.strokePath([[wx, wy], [wx + ws, wy], [wx + ws, wy + ws], [wx, wy + ws]], C.outline, 1.0);
  cv.line(wx + ws / 2, wy, wx + ws / 2, wy + ws, 0.8, C.outline);
  cv.line(wx, wy + ws / 2, wx + ws, wy + ws / 2, 0.8, C.outline);

  cv.rect(hx + hw - 2.5, H * 0.40, 3.5, 4.5, C.pylonDark);

  // --- rooftop solar panels on the left slope A -> R ---
  const A = [hx - 5, hTop];
  const R = [hx + hw / 2, hTop - 15];
  const ul = Math.hypot(R[0] - A[0], R[1] - A[1]);
  const un = [(R[0] - A[0]) / ul, (R[1] - A[1]) / ul];
  const nn = [un[1], -un[0]];
  const P = (along, over) => [
    A[0] + un[0] * along + nn[0] * over,
    A[1] + un[1] * along + nn[1] * over,
  ];
  const frame = [P(4, 2.2), P(ul - 3.5, 2.2), P(ul - 3.5, 8.4), P(4, 8.4)];
  cv.polygon(frame, C.panelFrame);
  for (let r = 0; r < 2; r++) {
    for (let col = 0; col < 4; col++) {
      const a0 = 4.6 + (ul - 8.6) * (col / 4);
      const a1 = 4.6 + (ul - 8.6) * ((col + 1) / 4) - 0.7;
      const o0 = 2.8 + 5.6 * (r / 2);
      const o1 = 2.8 + 5.6 * ((r + 1) / 2) - 0.7;
      cv.polygon([P(a0, o0), P(a1, o0), P(a1, o1), P(a0, o1)], (r + col) % 2 ? C.panelCell : C.panelCellHi);
    }
  }
  cv.strokePath(frame, C.outline, 1.0);
  cv.line(P(6, 3.2)[0], P(6, 3.2)[1], P(ul * 0.5, 6.6)[0], P(ul * 0.5, 6.6)[1], 1.0, C.glare, 0.45);

  // --- 3-bar breakdown card in front of the house ---
  const cardX = 34;
  const cardW = 37;
  const cardY = H * 0.5;
  const cardH = H * 0.42;
  cv.roundRect(cardX, cardY, cardW, cardH, 3.5, C.card, 0.92);
  cv.strokePath(roundRectPoints(cardX, cardY, cardW, cardH, 3.5), C.outline, 1.0);

  const baseY = cardY + cardH - 5;
  cv.line(cardX + 4, baseY, cardX + cardW - 4, baseY, 1.2, C.baseline);

  const bw = 8;
  const usable = cardH - 9;
  const bars = [
    { x: cardX + 5.5, h: usable * 0.45, color: C.barGrid },
    { x: cardX + 5.5 + 10.5, h: usable * 0.78, color: C.barSolar },
    { x: cardX + 5.5 + 21, h: usable * 0.56, color: C.barBattery },
  ];
  for (const b of bars) {
    cv.roundRect(b.x, baseY - b.h, bw, b.h, 1.8, b.color);
    cv.strokePath(roundRectPoints(b.x, baseY - b.h, bw, b.h, 1.8), C.outline, 0.9);
  }
}

const CARD_OUTLINE = [59, 122, 87];

/** Shared framed card: white ground, light rounded panel, green outline, baseline. */
function card(cv) {
  cv.clear(C.white);
  cv.roundRect(18, 20, 64, 60, 8, [237, 245, 240]);
  const o = roundRectPoints(18, 20, 64, 60, 8);
  for (let i = 0; i < o.length; i++) {
    cv.line(o[i][0], o[i][1], o[(i + 1) % o.length][0], o[(i + 1) % o.length][1], 1.6, CARD_OUTLINE);
  }
  cv.line(26, 68, 74, 68, 2, [200, 210, 205]); // baseline
}

const BREAKDOWN = [
  { color: [122, 134, 145] }, // grid
  { color: [253, 184, 19] }, // solar
  { color: [67, 160, 71] }, // battery
];

/** device-allocation: framed card + a 3-bar breakdown + bolt. */
function deviceScene(cv) {
  card(cv);

  const heights = [16, 30, 23];
  BREAKDOWN.forEach((bar, i) => cv.rect(30 + i * 14, 68 - heights[i], 10, heights[i], bar.color));

  cv.polygon([[50, 26], [44, 40], [49, 40], [46, 50], [56, 36], [50, 36]], CARD_OUTLINE);
}

/** house-allocation: same framed card, whole-house motif (house + breakdown bars). */
function houseScene(cv) {
  card(cv);

  const HOUSE = { roof: [199, 91, 57], wall: [242, 193, 133], door: [123, 75, 42], glass: [191, 227, 242] };

  // house sitting on the baseline, left of centre
  const hx = 26;
  const hw = 24;
  const hTop = 40;
  const hBottom = 68;
  cv.polygon([[hx - 3, hTop], [hx + hw + 3, hTop], [hx + hw / 2, hTop - 12]], HOUSE.roof);
  cv.rect(hx, hTop, hw, hBottom - hTop, HOUSE.wall);
  cv.rect(hx + hw * 0.55, hTop + (hBottom - hTop) * 0.42, hw * 0.3, (hBottom - hTop) * 0.58, HOUSE.door);
  cv.rect(hx + hw * 0.14, hTop + (hBottom - hTop) * 0.2, hw * 0.3, (hBottom - hTop) * 0.28, HOUSE.glass);

  // breakdown bars, right of the house
  const heights = [12, 22, 17];
  BREAKDOWN.forEach((bar, i) => cv.rect(56 + i * 7, 68 - heights[i], 5, heights[i], bar.color));
}

// ---------------------------------------------------------------------------
// Render targets
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');

function write(rel, w, h, draw) {
  const cv = new Canvas(w, h);
  draw(cv);
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(w, h, cv.toRGBA()));
  console.log(`wrote ${rel} (${w}x${h})`);
}

// App store images — full colour illustration.
for (const [rel, w, h] of [
  ['assets/images/small.png', 250, 175],
  ['assets/images/large.png', 500, 350],
  ['assets/images/xlarge.png', 1000, 700],
]) {
  write(rel, w, h, (cv) => energyScene(cv, h / w));
}

// house-allocation driver — framed card, whole-house motif.
for (const [rel, w, h] of [
  ['drivers/house-allocation/assets/images/small.png', 75, 75],
  ['drivers/house-allocation/assets/images/large.png', 500, 500],
  ['drivers/house-allocation/assets/images/xlarge.png', 1000, 1000],
]) {
  write(rel, w, h, (cv) => houseScene(cv));
}

// device-allocation driver — smart meter + breakdown bars.
for (const [rel, w, h] of [
  ['drivers/device-allocation/assets/images/small.png', 75, 75],
  ['drivers/device-allocation/assets/images/large.png', 500, 500],
  ['drivers/device-allocation/assets/images/xlarge.png', 1000, 1000],
]) {
  write(rel, w, h, (cv) => deviceScene(cv));
}
