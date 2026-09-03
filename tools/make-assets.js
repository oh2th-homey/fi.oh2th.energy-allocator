'use strict';

/**
 * Generates flat-illustration placeholder PNGs for the app and drivers so
 * `homey app validate` passes and the images look presentable in the app store /
 * device tiles. Pure Node (no native deps): a tiny supersampled 2D rasteriser +
 * hand-rolled PNG (RGBA) encoder.
 *
 * Replace these with real artwork before publishing.
 *
 * Usage: node tools/make-assets.js (device allocation), or
 *        node tools/make-assets.js --house-allocation
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const houseOnly = process.argv.includes('--house-allocation');

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
      const c = [top[0] + (bottom[0] - top[0]) * t, top[1] + (bottom[1] - top[1]) * t, top[2] + (bottom[2] - top[2]) * t];
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
    for (const [, py] of pts) {
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
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
        const col = [inner[0] + (outer[0] - inner[0]) * t, inner[1] + (outer[1] - inner[1]) * t, inner[2] + (outer[2] - inner[2]) * t];
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
  baseline: [201, 210, 222]
};

const CARD_OUTLINE = [59, 122, 87];

/** Shared framed card: white ground, light rounded panel, green outline, baseline. */
function card(cv, scale = 1) {
  const at = (value) => 50 + (value - 50) * scale;
  cv.clear(C.white);
  cv.roundRect(at(18), at(20), 64 * scale, 60 * scale, 8 * scale, [237, 245, 240]);
  const o = roundRectPoints(at(18), at(20), 64 * scale, 60 * scale, 8 * scale);
  for (let i = 0; i < o.length; i++) {
    cv.line(o[i][0], o[i][1], o[(i + 1) % o.length][0], o[(i + 1) % o.length][1], 1.6 * scale, CARD_OUTLINE);
  }
  cv.line(at(26), at(68), at(74), at(68), 2 * scale, [200, 210, 205]); // baseline
}

const BREAKDOWN = [
  { color: [122, 134, 145] }, // grid
  { color: [253, 184, 19] }, // solar
  { color: [67, 160, 71] } // battery
];

/** device-allocation: framed card + a 3-bar breakdown + bolt. */
function deviceScene(cv) {
  const scale = 1.26;
  const at = (value) => 50 + (value - 50) * scale;
  card(cv, scale);

  const heights = [24, 30, 13];
  BREAKDOWN.forEach((bar, i) => cv.rect(at(30 + i * 14), at(68 - heights[i]), 10 * scale, heights[i] * scale, bar.color));

  cv.polygon(
    [
      [63, 26],
      [57, 40],
      [62, 40],
      [59, 50],
      [69, 36],
      [63, 36]
    ].map(([x, y]) => [at(x), at(y)]),
    CARD_OUTLINE
  );
}

/** house-allocation: device-style breakdown graph with a whole-house marker. */
function houseScene(cv) {
  const scale = 1.26;
  const at = (value) => 50 + (value - 50) * scale;
  card(cv, scale);

  const HOUSE = { roof: [199, 91, 57], wall: [242, 193, 133], door: [123, 75, 42], glass: [191, 227, 242] };

  const hx = 60;
  const hw = 12;
  const hTop = 35;
  const hBottom = 47;
  cv.polygon(
    [
      [hx - 2.5, hTop],
      [hx + hw + 2.5, hTop],
      [hx + hw / 2, hTop - 9]
    ].map(([x, y]) => [at(x), at(y)]),
    HOUSE.roof
  );
  cv.rect(at(hx), at(hTop), hw * scale, (hBottom - hTop) * scale, HOUSE.wall);
  cv.rect(at(hx + hw * 0.4), at(hTop + 5), hw * 0.2 * scale, (hBottom - hTop - 5) * scale, HOUSE.door);
  cv.rect(at(hx + 1.5), at(hTop + 3), hw * 0.22 * scale, 3 * scale, HOUSE.glass);

  // Match device-allocation bar positions, widths, and heights exactly.
  const heights = [24, 30, 13];
  BREAKDOWN.forEach((bar, i) => cv.rect(at(30 + i * 14), at(68 - heights[i]), 10 * scale, heights[i] * scale, bar.color));
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

if (houseOnly) {
  for (const [rel, w, h] of [
    ['drivers/house-allocation/assets/images/small.png', 75, 75],
    ['drivers/house-allocation/assets/images/large.png', 500, 500],
    ['drivers/house-allocation/assets/images/xlarge.png', 1000, 1000]
  ]) {
    write(rel, w, h, (cv) => houseScene(cv));
  }
} else {
  // device-allocation driver — smart meter + breakdown bars.
  for (const [rel, w, h] of [
    ['drivers/device-allocation/assets/images/small.png', 75, 75],
    ['drivers/device-allocation/assets/images/large.png', 500, 500],
    ['drivers/device-allocation/assets/images/xlarge.png', 1000, 1000]
  ]) {
    write(rel, w, h, (cv) => deviceScene(cv));
  }
}
