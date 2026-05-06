/**
 * Pixel Art Engine — Reusable core for generating pixel art PNGs.
 * ==============================================================
 *
 * Usage:
 *   const engine = new PixelEngine(config);
 *   engine.render().savePNG("output.png");
 *
 * Config structure (see bottom of file for examples):
 *   {
 *     size: 128,          // 32 | 64 | 128
 *     scale: 8,           // output pixel size multiplier
 *     palette: { ... },   // { name: "#hex", ... }
 *     symmetry: "diagonal", // "diagonal" | "vertical" | "horizontal"
 *     body: [ ... ],      // symmetric segments
 *     decorations: [ ... ], // asymmetric elements
 *     center: 64,         // symmetry center (auto-calculated if omitted)
 *   }
 */

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const { spawnSync } = require("child_process");

// ═══════════════════════════════════════════════════════════════
// Color Helpers
// ═══════════════════════════════════════════════════════════════

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ═══════════════════════════════════════════════════════════════
// PNG Encoder (internal)
// ═══════════════════════════════════════════════════════════════

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const tb = Buffer.from(type, "ascii");
  const cb = Buffer.alloc(4);
  cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([len, tb, data, cb]);
}

function encodePNG(width, height, rgbaBuffer) {
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: None
    rgbaBuffer.slice(y * width * 4, (y + 1) * width * 4).copy(raw, y * stride + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ═══════════════════════════════════════════════════════════════
// PNG Decoder — reads RGBA pixel data from PNG files
// ═══════════════════════════════════════════════════════════════

/**
 * Decode a PNG file from disk into raw RGBA pixel data.
 * Handles filter types 0 (None), 1 (Sub), 2 (Up), 3 (Average), 4 (Paeth).
 * Returns { width, height, pixels: [{x, y, r, g, b, a}, ...] }
 */
function decodePNG(filepath) {
  const buf = fs.readFileSync(filepath);
  const sig = buf.slice(0, 8);
  if (sig[1] !== 0x50 || sig[2] !== 0x4e || sig[3] !== 0x47)
    throw new Error("Not a valid PNG: " + filepath);

  // Parse chunks
  let offset = 8;
  let ihdr = null, idatChunks = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString();
    const data = buf.slice(offset + 8, offset + 8 + len);
    if (type === "IHDR") ihdr = data;
    else if (type === "IDAT") idatChunks.push(data);
    else if (type === "IEND") break;
    offset += 12 + len;
  }
  if (!ihdr) throw new Error("No IHDR chunk");

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (colorType !== 6) throw new Error("Only RGBA (color type 6) PNG supported");
  if (bitDepth !== 8) throw new Error("Only 8-bit PNG supported");

  // Decompress IDAT
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = 4; // bytes per pixel (RGBA)
  const stride = 1 + width * bpp; // filter byte + pixel data

  // Reconstruct rows applying filter
  const reconstructed = Buffer.alloc(height * width * 4);
  let prevRow = null;

  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const rowStart = y * stride + 1;
    const outStart = y * width * 4;

    for (let x = 0; x < width; x++) {
      const inOff = rowStart + x * bpp;
      const outOff = outStart + x * bpp;

      let rawR = raw[inOff], rawG = raw[inOff + 1], rawB = raw[inOff + 2], rawA = raw[inOff + 3];

      // Left pixel (for Sub, Average, Paeth)
      let leftR = 0, leftG = 0, leftB = 0, leftA = 0;
      if (x > 0) {
        const leftOff = outOff - bpp;
        leftR = reconstructed[leftOff];
        leftG = reconstructed[leftOff + 1];
        leftB = reconstructed[leftOff + 2];
        leftA = reconstructed[leftOff + 3];
      }

      // Above pixel (for Up, Average, Paeth)
      let upR = 0, upG = 0, upB = 0, upA = 0;
      if (prevRow) {
        upR = prevRow[x * bpp];
        upG = prevRow[x * bpp + 1];
        upB = prevRow[x * bpp + 2];
        upA = prevRow[x * bpp + 3];
      }

      // Upper-left pixel (for Paeth)
      let ulR = 0, ulG = 0, ulB = 0, ulA = 0;
      if (x > 0 && prevRow) {
        ulR = prevRow[(x - 1) * bpp];
        ulG = prevRow[(x - 1) * bpp + 1];
        ulB = prevRow[(x - 1) * bpp + 2];
        ulA = prevRow[(x - 1) * bpp + 3];
      }

      let r, g, b, a;

      switch (filter) {
        case 0: // None
          r = rawR; g = rawG; b = rawB; a = rawA;
          break;
        case 1: // Sub
          r = (rawR + leftR) & 0xff;
          g = (rawG + leftG) & 0xff;
          b = (rawB + leftB) & 0xff;
          a = (rawA + leftA) & 0xff;
          break;
        case 2: // Up
          r = (rawR + upR) & 0xff;
          g = (rawG + upG) & 0xff;
          b = (rawB + upB) & 0xff;
          a = (rawA + upA) & 0xff;
          break;
        case 3: // Average
          r = (rawR + ((leftR + upR) >>> 1)) & 0xff;
          g = (rawG + ((leftG + upG) >>> 1)) & 0xff;
          b = (rawB + ((leftB + upB) >>> 1)) & 0xff;
          a = (rawA + ((leftA + upA) >>> 1)) & 0xff;
          break;
        case 4: { // Paeth
          const paeth = (a, b, c) => {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            return (pa <= pb && pa <= pc) ? a : (pb <= pc) ? b : c;
          };
          r = (rawR + paeth(leftR, upR, ulR)) & 0xff;
          g = (rawG + paeth(leftG, upG, ulG)) & 0xff;
          b = (rawB + paeth(leftB, upB, ulB)) & 0xff;
          a = (rawA + paeth(leftA, upA, ulA)) & 0xff;
          break;
        }
        default:
          throw new Error("Unknown PNG filter type: " + filter);
      }

      reconstructed[outOff] = r;
      reconstructed[outOff + 1] = g;
      reconstructed[outOff + 2] = b;
      reconstructed[outOff + 3] = a;
    }

    prevRow = reconstructed.slice(outStart, outStart + width * 4);
  }

  // Convert to pixel array
  const pixels = [];
  for (let y = 0; y < height; y++) {
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x++) {
      const off = rowOff + x * 4;
      pixels.push({
        x, y,
        r: reconstructed[off],
        g: reconstructed[off + 1],
        b: reconstructed[off + 2],
        a: reconstructed[off + 3],
      });
    }
  }

  return { width, height, pixels };
}

/**
 * Detect the logical pixel-art size from decoded PNG pixel data.
 * Uses content analysis: finds the minimum block size by examining
 * alpha transitions in the PNG, ensuring scale > 1.
 *
 * @param {Object} decoded - Result from decodePNG() { width, height, pixels }
 * @returns {{ logicalSize: number, scale: number }}
 */
function detectLogicalSize(decoded) {
  const { width, height, pixels } = decoded;

  // Strategy 1: Find scale by examining alpha transitions in a content row.
  // In pixel art, each logical pixel is a solid scale×scale block,
  // so alpha transitions only occur at multiples of scale.
  let detectedScale = 0;
  const candidates = [];

  // Find a row with some non-transparent pixels (not all and not none)
  for (let row = 0; row < height; row++) {
    const rowPixels = pixels.filter(p => p.y === row);
    const hasAlpha = rowPixels.filter(p => p.a > 0);
    if (hasAlpha.length === 0 || hasAlpha.length === width) continue;

    // Find transition points (alpha changes from 0 to >0 or vice versa)
    const transitions = [];
    let prevAlpha = rowPixels[0].a > 0 ? 1 : 0;
    for (let x = 1; x < width; x++) {
      const currAlpha = rowPixels[x].a > 0 ? 1 : 0;
      if (currAlpha !== prevAlpha) transitions.push(x);
      prevAlpha = currAlpha;
    }

    if (transitions.length < 2) continue;

    // Compute gaps between transitions
    const gaps = [];
    for (let i = 1; i < transitions.length; i++) {
      gaps.push(transitions[i] - transitions[i - 1]);
    }

    if (gaps.length === 0) continue;

    // The minimum gap is a strong indicator of the scale
    const minGap = Math.min(...gaps);
    if (minGap > 1) {
      candidates.push(minGap);
    }
  }

  if (candidates.length > 0) {
    // Use the most frequently occurring gap
    const freq = {};
    for (const c of candidates) {
      for (const std of [16, 8, 4]) {
        if (c >= std && c < std * 1.5) {
          freq[std] = (freq[std] || 0) + 1;
        }
      }
    }
    let bestScale = 8;
    let bestFreq = 0;
    for (const [s, f] of Object.entries(freq)) {
      if (f > bestFreq) { bestScale = parseInt(s); bestFreq = f; }
    }

    // Verify scale evenly divides width/height
    if (width % bestScale === 0 && height % bestScale === 0) {
      return { logicalSize: width / bestScale, scale: bestScale };
    }
  }

  // Fallback: try standard sizes in order, prefer smaller scales (8 over 4)
  const standards = [64, 128, 32];
  for (const s of standards) {
    if (width % s === 0 && height % s === 0) {
      const scale = width / s;
      if (scale >= 2 && scale <= 32) return { logicalSize: s, scale };
    }
  }

  // Last resort: if image is too small to be a standard upscaled pixel art,
  // treat it as direct pixel art (scale = 1, logical size = image dimensions)
  const scale = Math.max(1, Math.round(width / 64));
  return { logicalSize: Math.round(width / scale), scale };
}

// ═══════════════════════════════════════════════════════════════
// WebP Decoder — reads RGBA pixel data via Python PIL subprocess
// ═══════════════════════════════════════════════════════════════

/**
 * Decode a WebP (or any PIL-supported format) file into raw RGBA pixel data.
 * Uses Python PIL/Pillow via subprocess.
 *
 * Returns { width, height, pixels: [{x, y, r, g, b, a}, ...] }
 */
function decodeImage(filepath) {
  // Check file extension first — use native PNG decoder for .png
  const ext = path.extname(filepath).toLowerCase();
  if (ext === ".png") {
    return decodePNG(filepath);
  }

  // For non-PNG (WebP, JPEG, etc.), use Python PIL subprocess
  const pythonScript = `
from PIL import Image
import sys, struct, io, os

with open(sys.argv[1], "rb") as f:
    data = f.read()
im = Image.open(io.BytesIO(data))

# Ensure RGBA
if im.mode != "RGBA":
    im = im.convert("RGBA")

w, h = im.size
# Output: width(uint32 LE), height(uint32 LE), raw RGBA data (r,g,b,a bytes)
sys.stdout.buffer.write(struct.pack("<II", w, h))
sys.stdout.buffer.write(im.tobytes())
`;

  // Find python executable
  const pythonCmd = _findPython();

  const result = spawnSync(pythonCmd, ["-c", pythonScript, filepath], {
    timeout: 10000,
    maxBuffer: 50 * 1024 * 1024, // 50MB for large images
  });

  if (result.error) {
    throw new Error(
      `Failed to decode image "${filepath}": ${result.error.message}. ` +
      `Ensure Python Pillow is installed (pip install pillow).`
    );
  }
  if (result.status !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(
      `Python image decoding failed for "${filepath}": ${stderr || "unknown error"}`
    );
  }

  const stdout = result.stdout;
  // First 8 bytes: width (uint32) + height (uint32)
  const width = stdout.readUInt32LE(0);
  const height = stdout.readUInt32LE(4);
  const rawData = stdout.slice(8);

  const expectedLen = width * height * 4;
  if (rawData.length !== expectedLen) {
    throw new Error(
      `Decoded image data size mismatch: expected ${expectedLen}, got ${rawData.length}`
    );
  }

  // Convert to pixel array (same format as decodePNG)
  const pixels = [];
  for (let y = 0; y < height; y++) {
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x++) {
      const off = rowOff + x * 4;
      pixels.push({
        x, y,
        r: rawData[off],
        g: rawData[off + 1],
        b: rawData[off + 2],
        a: rawData[off + 3],
      });
    }
  }

  return { width, height, pixels };
}

/**
 * Find a Python executable that can import PIL/Pillow.
 * Checks known virtual environment paths first, then system Python.
 */
function _findPython() {
  // Known virtual environment paths (Tokeny shared venv)
  const isWin = process.platform === "win32";
  const ext = isWin ? ".exe" : "";
  const knownPaths = [
    // Tokeny shared venv (Windows)
    `D:/tokenySpace/.shared-venv/Scripts/python${ext}`,
    path.join(path.dirname(process.execPath), "..", ".shared-venv", "Scripts", `python${ext}`),
    path.join(process.env.USERPROFILE || "C:\\Users\\default", "tokeny", "space", ".shared-venv", "Scripts", `python${ext}`),
    // Unix fallbacks
    "/opt/tokeny/.shared-venv/bin/python3",
    "/usr/local/tokeny/.shared-venv/bin/python3",
  ];

  // Test a candidate: returns true if it can import PIL
  const _testPIL = (cmd) => {
    try {
      const r = spawnSync(cmd, ["-c", "from PIL import Image; print(Image.__version__)"], { timeout: 3000 });
      return r.status === 0;
    } catch { return false; }
  };

  // Check known paths first
  for (const p of knownPaths) {
    try {
      if (fs.existsSync(p) && _testPIL(p)) return p;
    } catch { /* try next */ }
  }

  // Check common PATH commands
  for (const cmd of ["python", "python3", "py"]) {
    if (_testPIL(cmd)) return cmd;
  }

  // Last resort: check if any python exists (even without PIL) for better error message
  for (const cmd of ["python", "python3", "py"]) {
    try {
      const r = spawnSync(cmd, ["--version"], { timeout: 2000 });
      if (r.status === 0) {
        throw new Error(
          `Python found (${cmd}) but Pillow not installed. Run: ${cmd} -m pip install pillow`
        );
      }
    } catch (e) {
      if (e.message.includes("Pillow")) throw e;
    }
  }

  throw new Error(
    "Python not found. Install Python and Pillow to use WebP templates:\n" +
    "  pip install pillow"
  );
}

// ═══════════════════════════════════════════════════════════════
// Symmetry Strategies
// ═══════════════════════════════════════════════════════════════

const SYMMETRY = {
  /**
   * Diagonal (y=x) symmetry.
   * Seed: x >= y  → mirror: (x,y) ↔ (y,x)
   * Axis runs bottom-left to top-right.
   */
  diagonal(cx, cy) {
    const center = (cx + cy) / 2; // not really used for y=x
    return {
      name: "diagonal",
      // Convert axis parameter t to seed pixel coords
      seed: (t, dx) => ({ x: t + dx, y: t }),
      // Mirror a point
      mirror: (x, y) => ({ x: y, y: x }),
      // Check if (x,y) is in seed region
      isSeed: (x, y) => x >= y,
      // Bounds check helper
      boundCheck: (px, size) => px.x >= 0 && px.x < size && px.y >= 0 && px.y < size,
      // Ensure seed pixel is valid
      validSeed: (p, size) => p.x >= p.y && p.x >= 0 && p.x < size && p.y >= 0 && p.y < size,
      // Get the "t" (axis param) from a seed pixel
      axisParam: (x, y) => y,
    };
  },

  /**
   * Vertical (left-right) symmetry about x = cx.
   * Seed: x >= cx  → mirror: (x,y) ↔ (2*cx-x, y)
   * Axis is the vertical centerline.
   */
  vertical(cx) {
    return {
      name: "vertical",
      seed: (t, dx) => ({ x: Math.ceil(cx) + dx, y: t }),
      mirror: (x, y) => ({ x: 2 * cx - x, y }),
      isSeed: (x, y) => x >= cx,
      boundCheck: (p, size) => p.x >= 0 && p.x < size && p.y >= 0 && p.y < size,
      validSeed: (p, size) => p.x >= cx && p.x >= 0 && p.x < size && p.y >= 0 && p.y < size,
      axisParam: (x, y) => y,
    };
  },

  /**
   * Horizontal (top-bottom) symmetry about y = cy.
   * Seed: y >= cy  → mirror: (x,y) ↔ (x, 2*cy-y)
   */
  horizontal(cy) {
    return {
      name: "horizontal",
      seed: (t, dy) => ({ x: t, y: Math.ceil(cy) + dy }),
      mirror: (x, y) => ({ x, y: 2 * cy - y }),
      isSeed: (x, y) => y >= cy,
      boundCheck: (p, size) => p.x >= 0 && p.x < size && p.y >= 0 && p.y < size,
      validSeed: (p, size) => p.y >= cy && p.x >= 0 && p.x < size && p.y >= 0 && p.y < size,
      axisParam: (x, y) => x,
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// Fill Strategies
// ═══════════════════════════════════════════════════════════════

const FILLS = {
  /** Single solid color */
  solid(color) {
    return { type: "solid", getColor: (t, dx, hw) => color };
  },

  /** Center-to-edge gradient */
  gradient(colors) {
    return {
      type: "gradient",
      getColor: (t, dx, hw) => {
        if (hw <= 0) return colors[0];
        const idx = clamp(Math.round((dx / hw) * (colors.length - 1)), 0, colors.length - 1);
        return colors[idx];
      },
    };
  },

  /** Linear gradient along the axis (top-to-bottom effect) */
  linear(colors) {
    return {
      type: "linear",
      getColor: (t, dx, hw, segStart, segEnd) => {
        const progress = (t - segStart) / (segEnd - segStart);
        const idx = clamp(Math.round(progress * (colors.length - 1)), 0, colors.length - 1);
        return colors[idx];
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// Pixel Engine
// ═══════════════════════════════════════════════════════════════

class PixelEngine {
  /**
   * @param {Object} cfg
   * @param {number}  cfg.size        - Canvas size (32/64/128)
   * @param {number}  [cfg.scale=8]   - Output scale multiplier
   * @param {Object}  cfg.palette     - { name: "#hex", ... }
   * @param {string}  cfg.symmetry    - "diagonal" | "vertical" | "horizontal"
   * @param {Array}   cfg.body        - Symmetric segments
   * @param {Array}   [cfg.decorations] - Asymmetric decorations
   * @param {number}  [cfg.center]    - Symmetry center (auto if omitted)
   */
  constructor(cfg) {
    this.size = cfg.size || 128;
    this.scale = cfg.scale || 8;
    this.outSize = this.size * this.scale;
    this.palette = cfg.palette || {};
    this.symmetry = cfg.symmetry || "diagonal";
    this.body = cfg.body || [];
    this.decorations = cfg.decorations || [];
    this.template = cfg.template || null; // path to template PNG
    this.pixels = []; // { x, y, color }
    this._templateData = null; // cached template data

    // Resolve palette colors from name → hex → rgb
    this._resolvedPalette = {};
    for (const [name, hex] of Object.entries(this.palette)) {
      this._resolvedPalette[name] = hex; // keep hex
    }

    // Auto-compute center
    const half = this.size / 2;
    if (cfg.center !== undefined) {
      this.center = cfg.center;
    } else {
      this.center = half; // for vertical/horizontal
    }

    // Setup symmetry strategy
    const sym = this.symmetry;
    if (sym === "diagonal") {
      this._sym = SYMMETRY.diagonal(this.center, this.center);
    } else if (sym === "vertical") {
      this._sym = SYMMETRY.vertical(this.center);
    } else if (sym === "horizontal") {
      this._sym = SYMMETRY.horizontal(this.center);
    } else {
      throw new Error("Unknown symmetry: " + sym);
    }

    // Parse fill strategies
    this._fillCache = new Map();
  }

  // ─── Pixel placement ───

  /**
   * Place a pixel WITHOUT symmetry (for decorations).
   * Handles bounds check automatically.
   */
  px(x, y, color) {
    const hex = this._resolvedPalette[color] || color;
    if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
      this.pixels.push({ x, y, color: hex });
    }
  }

  /**
   * Place a pixel WITH symmetry.
   * In seed region: adds pixel + mirror.
   */
  m(x, y, color) {
    const hex = this._resolvedPalette[color] || color;
    const seed = { x, y };
    if (this._sym.validSeed(seed, this.size)) {
      this.pixels.push({ x: seed.x, y: seed.y, color: hex });
      if (seed.x !== seed.y || this._sym.name !== "diagonal") {
        const mir = this._sym.mirror(seed.x, seed.y);
        // Only add mirror if it's different AND valid
        if ((mir.x !== seed.x || mir.y !== seed.y) &&
            mir.x >= 0 && mir.x < this.size && mir.y >= 0 && mir.y < this.size) {
          this.pixels.push({ x: mir.x, y: mir.y, color: hex });
        }
      }
    }
  }

  // ─── Segment processing ───

  /**
   * Compute half-width at position t for a segment.
   */
  _getWidth(seg, t) {
    const w = seg.width;
    if (typeof w === "number") return Math.round(w);
    if (w.from !== undefined && w.to !== undefined) {
      const range = seg.range;
      const progress = (t - range[0]) / (range[1] - range[0]);
      return Math.round(lerp(w.from, w.to, progress));
    }
    if (typeof w === "function") return Math.round(w(t));
    return 0;
  }

  /**
   * Resolve a fill spec to a fill strategy.
   */
  _getFill(fillSpec) {
    if (!fillSpec) return FILLS.solid("#000000");
    const key = JSON.stringify(fillSpec);
    if (this._fillCache.has(key)) return this._fillCache.get(key);

    let fill;
    if (typeof fillSpec === "string") {
      fill = FILLS.solid(fillSpec);
    } else if (fillSpec.type === "gradient") {
      fill = FILLS.gradient(fillSpec.colors);
    } else if (fillSpec.type === "linear") {
      fill = FILLS.linear(fillSpec.colors);
    } else if (fillSpec.type === "solid") {
      fill = FILLS.solid(fillSpec.color);
    } else {
      fill = FILLS.solid("#000000");
    }
    this._fillCache.set(key, fill);
    return fill;
  }

  /**
   * Process one body segment.
   *   segment: {
   *     range: [tStart, tEnd],
   *     width: number | { from, to },
   *     fill: { type, colors/color },
   *     textures: [...],
   *     lighting: "centerDark" | "topLeft" | null,
   *   }
   */
  _processSegment(seg) {
    const [tStart, tEnd] = seg.range;
    const fill = this._getFill(seg.fill);
    const textures = seg.textures || [];
    const lighting = seg.lighting !== undefined ? seg.lighting : "centerDark";

    for (let t = tStart; t <= tEnd; t++) {
      const hw = this._getWidth(seg, t);
      if (hw < 0) continue;

      // Step 4b: 初步填色
      for (let dx = 0; dx <= hw; dx++) {
        const color = fill.getColor(t, dx, hw, tStart, tEnd);
        // For vertical symmetry, pixel x is centered: cx + dx
        // For diagonal symmetry, pixel x tracks the axis: t + dx
        if (this._sym.name === "vertical") {
          this.m(Math.ceil(this.center) + dx, t, color);
        } else {
          this.m(t + dx, t, color);
        }
      }

      // Textures (overlay patterns)
      for (const tex of textures) {
        this._applyTexture(tex, t, hw);
      }

      // Step 4c: 使用简单光影 (applied AFTER textures)
      this._applyLighting(lighting, t, hw);
    }
  }

  /**
   * Apply a texture overlay at axis position t with given half-width.
   *   texture: { type, ... }
   */
  _applyTexture(tex, t, hw) {
    const color = this._resolve(tex.color);
    if (!color) return;

    // Helper: resolve the seed x for the current symmetry
    const _sx = (dx) =>
      this._sym.name === "vertical" ? Math.ceil(this.center) + dx : t + dx;

    switch (tex.type) {
      case "stripe": {
        // Periodic horizontal stripe on the body
        if (tex.every && t % tex.every === 0) {
          const w = tex.width || hw;
          for (let dx = 0; dx <= Math.min(w, hw); dx++) {
            this.m(_sx(dx), t, color);
          }
        }
        break;
      }
      case "moss": {
        // Random moss patch
        const chance = tex.chance || 0.15;
        if (Math.random() < chance) {
          for (let dx = 0; dx <= Math.min(2, hw); dx++) {
            this.m(_sx(dx), t, color);
          }
        }
        break;
      }
      case "outline": {
        // Outline at the edge of the width
        if (hw >= 0) this.m(_sx(hw), t, color);
        break;
      }
      case "center": {
        // Overlay at the center
        this.m(_sx(0), t, color);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Apply lighting to a segment.
   *   mode: "centerDark" | "topLeft" | "none"
   */
  _applyLighting(mode, t, hw) {
    if (mode === "none" || hw < 0) return;

    switch (mode) {
      case "centerDark": {
        // Center = darkest, edge = lightest
        // Already handled by gradient fill in Step 4b.
        // Additional: ensure the very center is extra dark
        // and the very edge is extra light IF the palette has those.
        // This is optional — gradient fill already covers it.
        break;
      }
      case "topLeft": {
        // Asymmetric lighting (only works with vertical/horizontal symmetry)
        // Highlight on left/top, shadow on right/bottom
        if (this._sym.name === "vertical") {
          // Only highlight on seed side (right), shadow on mirror side (left)
          // This creates a 3D effect
        }
        break;
      }
      default:
        break;
    }
  }

  // ─── Decoration processing ───

  _processDecoration(dec) {
    switch (dec.type) {
      case "vine":
        this._processVine(dec);
        break;
      case "vineLeaf":
        this._processVineLeaf(dec);
        break;
      case "particles":
        this._processParticles(dec);
        break;
      case "pixel":
        this.px(dec.at[0], dec.at[1], dec.color);
        break;
      case "rect":
        this._processRect(dec);
        break;
      default:
        break;
    }
  }

  _processVine(dec) {
    const [tStart, tEnd] = dec.range;
    const range = tEnd - tStart;
    const cycles = dec.cycles || 2;
    const amplitude = dec.amplitude || 3;
    const baseOffset = dec.baseOffset || 2;
    const mainColor = dec.colors?.[0] || dec.color;
    const darkColor = dec.colors?.[1] || dec.colors?.[0] || mainColor;
    const brightColor = dec.colors?.[2] || dec.colors?.[0] || mainColor;

    for (let t = tStart; t <= tEnd; t++) {
      const phase = ((t - tStart) / range) * Math.PI * 2 * cycles;
      const offset = baseOffset + amplitude * Math.sin(phase);
      const side = Math.sin(phase);
      const vineColor = t % 2 === 0 ? mainColor : brightColor;

      if (side > 0.3) {
        const vx = t + Math.round(Math.abs(offset));
        const vy = t;
        if (vx < this.size && vy < this.size && vx >= vy) {
          this.px(vx, vy, vineColor);
          this.px(vx, vy + 1, darkColor);
          if (t % 3 === 0) this.px(vx + 1, vy, brightColor);
        }
      } else if (side < -0.3) {
        const vx = t;
        const vy = t + Math.round(Math.abs(offset));
        if (vx < this.size && vy < this.size && vx <= vy) {
          this.px(vx, vy, vineColor);
          this.px(vx + 1, vy, darkColor);
          if (t % 3 === 0) this.px(vx, vy + 1, brightColor);
        }
      }
      // |side| <= 0.3: vine crosses behind → hidden
    }
  }

  _processVineLeaf(dec) {
    const at = dec.at;
    const side = dec.side || 1;
    const offset = dec.offset || dec.leafSize || 5;
    const leafColor = dec.colors?.[0] || dec.color || "lMain";
    const brightColor = dec.colors?.[1] || leafColor;

    if (side > 0) {
      const vx = at + offset, vy = at;
      for (let d = 0; d <= 1; d++) {
        this.px(vx + d, vy, brightColor);
        this.px(vx + d, vy - 1, leafColor);
      }
    } else {
      const vx = at, vy = at + offset;
      for (let d = 0; d <= 1; d++) {
        this.px(vx, vy + d, brightColor);
        this.px(vx - 1, vy + d, leafColor);
      }
    }
  }

  _processParticles(dec) {
    const positions = dec.positions || [];
    const mainColor = dec.colors?.[0] || dec.color || "eGlow";
    const brightColor = dec.colors?.[1] || mainColor;

    for (const p of positions) {
      const big = p.big;
      if (big) {
        for (let dy = 0; dy <= 1; dy++) {
          for (let dx = 0; dx <= 1; dx++) {
            this.px(p.x + dx, p.y + dy, mainColor);
          }
        }
        this.px(p.x, p.y, brightColor);
      } else {
        this.px(p.x, p.y, mainColor);
        if (Math.random() > 0.5) this.px(p.x + 1, p.y, brightColor);
      }
    }
  }

  _processRect(dec) {
    const [x1, y1, x2, y2] = dec.area;
    const color = dec.color;
    const filled = dec.filled !== false;

    for (let x = x1; x <= x2; x++) {
      for (let y = y1; y <= y2; y++) {
        if (filled || x === x1 || x === x2 || y === y1 || y === y2) {
          this.px(x, y, color);
        }
      }
    }
  }

  // ─── Resolution helper ───

  _resolve(nameOrHex) {
    return this._resolvedPalette[nameOrHex] || nameOrHex || null;
  }

  // ─── Main render ───

  render() {
    this.pixels = [];

    if (this.template) {
      // Template mode: geometry from template PNG, color from body segments
      this._renderTemplate();
    } else {
      // Classic mode: geometry from body segments (width-based)
      for (const seg of this.body) {
        this._processSegment(seg);
      }
    }

    // Process asymmetric decorations (always)
    for (const dec of this.decorations) {
      this._processDecoration(dec);
    }

    return this;
  }

  // ═══════════════════════════════════════════════════════════════
  // Template System
  // ═══════════════════════════════════════════════════════════════

  /**
  /**
   * Read an image file (PNG, WebP, or other PIL-supported formats) from disk.
   * Dispatches to the appropriate decoder based on file extension.
   * @param {string} filepath - Path to image file
   * @returns {{ width, height, pixels: Array }}
   */
  _readImage(filepath) {
    // Resolve relative paths
    let actualPath = filepath;
    if (!path.isAbsolute(filepath)) {
      // Try relative to CWD first, then relative to template path hint
      if (!fs.existsSync(filepath)) {
        const resolved = path.resolve(path.dirname(this.template || "."), filepath);
        if (fs.existsSync(resolved)) actualPath = resolved;
      }
    }
    return decodeImage(actualPath);
  }

  /**
   * Load a template image and extract logical pixel-art pixel positions.
   * Template is an upscaled image (e.g., 512x512 for a 64x64 pixel art at 8× scale).
   *
   * Supports: PNG (native), WebP (via Python PIL)
   *
   * Process:
   *   1. Decode image → raw RGBA pixels
   *   2. Detect logical size (32/64/128) from dimensions
   *   3. Downsample: for each scale×scale block, check if any pixel is non-transparent
   *   4. Group by axis parameter t
   *
   * @param {string} filepath - Path to template image (.png, .webp)
   * @returns {Object} Template data
   */
  _loadTemplate(filepath) {
    const decoded = this._readImage(filepath);
    const { width, height, pixels } = decoded;

    // Detect template's logical scale (block size per pixel-art pixel)
    const { logicalSize: _tmplSize, scale: tmplScale } = detectLogicalSize(decoded);
    // Compute logical dimensions (handles non-square templates like 26×40)
    const tmplWidth = Math.round(width / tmplScale);
    const tmplHeight = Math.round(height / tmplScale);
    const scaleRatioX = this.size / tmplWidth;

    const scaleRatioY = this.size / tmplHeight;
    const blockSizeX = Math.max(1, Math.ceil(scaleRatioX));
    const blockSizeY = Math.max(1, Math.ceil(scaleRatioY));

    // Build a 2D occupancy grid
    const occupied = new Set();
    // Block fill: ensures no gaps when scaleRatio is fractional.
    // For each file pixel with alpha > 0, mark the corresponding logical pixel
    for (const p of pixels) {
      if (p.a === 0) continue;
      // Map file pixel to template logical coords
      const tx = Math.floor(p.x / tmplScale);
      const ty = Math.floor(p.y / tmplScale); // PNG: y=0 is top
      // Flip Y: engine uses bottom-left origin (y=0 is bottom)
      const flipY = tmplHeight - 1 - ty;
      // Map template logical coords to engine logical coords (block fill)
      const baseEx = Math.floor(tx * scaleRatioX);
      const baseEy = Math.floor(flipY * scaleRatioY);
      for (let dy = 0; dy < blockSizeY; dy++) {
        for (let dx = 0; dx < blockSizeX; dx++) {
          const ex = baseEx + dx;
          const ey = baseEy + dy;
          if (ex >= 0 && ex < this.size && ey >= 0 && ey < this.size) {
            occupied.add(`${ex},${ey}`);
          }
        }
      }
    }

    // Convert to array of {x, y}
    const templatePixels = [];
    for (const key of occupied) {
      const [x, y] = key.split(",").map(Number);
      templatePixels.push({ x, y });
    }

    // Group by axis parameter t
    const byT = new Map();
    for (const p of templatePixels) {
      const t = this._templateAxisParam(p.x, p.y);
      if (!byT.has(t)) byT.set(t, []);
      byT.get(t).push(p);
    }

    // Compute half-width per t
    const hwByT = new Map();
    for (const [t, tPixels] of byT) {
      let maxDx = 0;
      for (const p of tPixels) {
        const dx = this._templateDx(p.x, p.y);
        if (dx > maxDx) maxDx = dx;
      }
      hwByT.set(t, maxDx);
    }

    const data = { pixels: templatePixels, byT, hwByT };
    console.log(`   Template: ${filepath} (${tmplWidth}×${tmplHeight} @${tmplScale}× → engine ${this.size}×${this.size})`);
    console.log(`   Template pixels: ${templatePixels.length}, t range: [${Math.min(...byT.keys())}, ${Math.max(...byT.keys())}]`);
    return data;
  }

  /**
   * Compute the axis parameter t for a template pixel.
   * For diagonal: t = Math.min(x, y) (seed at (t+dx, t), mirror at (t, t+dx))
   * For vertical: t = y
   * For horizontal: t = x
   */
  _templateAxisParam(x, y) {
    // Diagonal: seed pixel at (t+dx, t), mirror at (t, t+dx).
    // For any pixel (x,y), the original seed t = Math.min(x,y)
    if (this._sym.name === "diagonal") return Math.min(x, y);
    // Vertical: both seed and mirror share same y = t
    if (this._sym.name === "vertical") return y;
    // Horizontal: both seed and mirror share same x = t
    return x;
  }

  /**
   * Compute the distance from the symmetry axis for a template pixel.
   * For diagonal: dx = |x - y| (distance from y=x axis)
   * For vertical: dx = |x - ceil(center)|
   * For horizontal: dx = |y - ceil(center)|
   */
  _templateDx(x, y) {
    if (this._sym.name === "diagonal") return Math.abs(x - y);
    if (this._sym.name === "vertical") return Math.abs(x - Math.ceil(this.center));
    return Math.abs(y - Math.ceil(this.center)); // horizontal
  }

  /**
   * Template rendering mode.
   * Iterates template pixels grouped by t, matches each to a body segment,
   * and applies the segment's fill color.
   */
  _renderTemplate() {
    this._templateData = this._loadTemplate(this.template);
    const { pixels, byT, hwByT } = this._templateData;

    // Sort body segments by range for efficient lookup
    const sortedSegs = [...this.body].sort((a, b) => a.range[0] - b.range[0]);

    // Iterate template pixels grouped by t
    for (const [t, tPixels] of byT) {
      // Find body segment covering this t
      const seg = sortedSegs.find(s => t >= s.range[0] && t <= s.range[1]);
      if (!seg) continue; // no segment covers this t → skip

      const fill = this._getFill(seg.fill);
      const hw = hwByT.get(t) || 0;
      const textures = seg.textures || [];

      for (const p of tPixels) {
        const dx = this._templateDx(p.x, p.y);
        const color = fill.getColor(t, dx, hw, seg.range[0], seg.range[1]);
        const hex = this._resolvedPalette[color] || color || "#000000";
        // Place without symmetry (template already contains mirrored positions)
        this.px(p.x, p.y, hex);
      }

      // Apply textures to template pixels for this t
      for (const tex of textures) {
        this._applyTemplateTexture(tex, t, tPixels, hw);
      }
    }
  }

  /**
   * Apply a texture overlay to template pixels at axis position t.
   * Adapted from _applyTexture but works with template pixel lists.
   */
  _applyTemplateTexture(tex, t, tPixels, hw) {
    const color = this._resolve(tex.color);
    if (!color) return;

    switch (tex.type) {
      case "stripe": {
        // Periodic horizontal stripe
        if (tex.every && t % tex.every === 0) {
          const w = tex.width || hw;
          for (const p of tPixels) {
            const dx = this._templateDx(p.x, p.y);
            if (dx <= Math.min(w, hw)) {
              this.px(p.x, p.y, color);
            }
          }
        }
        break;
      }
      case "moss": {
        // Random moss patch
        const chance = tex.chance || 0.15;
        if (Math.random() < chance) {
          for (const p of tPixels) {
            const dx = this._templateDx(p.x, p.y);
            if (dx <= Math.min(2, hw)) {
              this.px(p.x, p.y, color);
            }
          }
        }
        break;
      }
      case "outline": {
        // Outline = template pixel with max dx for its t
        for (const p of tPixels) {
          const dx = this._templateDx(p.x, p.y);
          if (dx === hw) {
            this.px(p.x, p.y, color);
          }
        }
        break;
      }
      case "center": {
        // Center = template pixel on the axis (dx = 0)
        for (const p of tPixels) {
          const dx = this._templateDx(p.x, p.y);
          if (dx === 0) {
            this.px(p.x, p.y, color);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // ─── PNG output ───

  savePNG(filepath) {
    const os = this.outSize;
    const buf = Buffer.alloc(os * os * 4, 0);

    for (const p of this.pixels) {
      const hex = p.color;
      if (!hex || hex === "none") continue;
      const rgb = hexToRgb(hex);
      const py = (this.size - 1 - p.y) * this.scale;
      const px2 = p.x * this.scale;

      for (let dy = 0; dy < this.scale; dy++) {
        for (let dx = 0; dx < this.scale; dx++) {
          const off = ((py + dy) * os + (px2 + dx)) * 4;
          buf[off] = rgb.r;
          buf[off + 1] = rgb.g;
          buf[off + 2] = rgb.b;
          buf[off + 3] = 255;
        }
      }
    }

    const png = encodePNG(os, os, buf);
    fs.writeFileSync(filepath, png);
    console.log(`✅ PNG: ${filepath}`);
    console.log(`   ${os}x${os} px (${this.size}x${this.size} pixel art × ${this.scale}×)`);
    console.log(`   ${this.pixels.length} pixels, ${png.length} bytes`);
    return this;
  }

  // ─── Stats ───

  stats() {
    const unique = new Set(this.pixels.map((p) => p.color));
    let minX = this.size, maxX = -1, minY = this.size, maxY = -1;
    for (const p of this.pixels) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      totalPixels: this.pixels.length,
      uniqueColors: unique.size,
      bbox: { x: [minX, maxX], y: [minY, maxY] },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════

module.exports = { PixelEngine, FILLS, SYMMETRY };
