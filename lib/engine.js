/**
 * lib/engine.js — PixelEngine class.
 *
 * The core rendering engine: takes a declarative config (size, palette,
 * symmetry, body segments, decorations, template) and produces pixel art.
 *
 * Usage:
 *   const { PixelEngine } = require("./lib");
 *   new PixelEngine(config).render().savePNG("output.png");
 */
const fs = require("fs");
const path = require("path");
const {
  hexToRgb, H, hexToRgbArr, rgbArrToHex, mixColor,
  darken, lighten, adaptiveOutline, noiseInject,
} = require("./color");
const { encodePNG, detectLogicalSize } = require("./png");
const { decodeImage } = require("./image");
const { SYMMETRY } = require("./symmetry");
const { FILLS } = require("./fills");

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
    this.template = cfg.template || null;
    this.postProcess = cfg.postProcess || null;
    this.pixels = [];
    this._templateData = null;

    // Resolve palette colors from name → hex
    this._resolvedPalette = {};
    for (const [name, hex] of Object.entries(this.palette)) {
      this._resolvedPalette[name] = hex;
    }

    // Auto-compute center
    const half = this.size / 2;
    this.center = cfg.center !== undefined ? cfg.center : half;

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

    this._fillCache = new Map();
  }

  // ─── Pixel placement ───

  /** Place a pixel WITHOUT symmetry (for decorations). */
  px(x, y, color) {
    const hex = this._resolvedPalette[color] || color;
    if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
      this.pixels.push({ x, y, color: hex });
    }
  }

  /** Place a pixel WITH symmetry (seed + mirror). */
  m(x, y, color) {
    const hex = this._resolvedPalette[color] || color;
    const seed = { x, y };
    if (this._sym.validSeed(seed, this.size)) {
      this.pixels.push({ x: seed.x, y: seed.y, color: hex });
      if (seed.x !== seed.y || this._sym.name !== "diagonal") {
        const mir = this._sym.mirror(seed.x, seed.y);
        if ((mir.x !== seed.x || mir.y !== seed.y) &&
            mir.x >= 0 && mir.x < this.size && mir.y >= 0 && mir.y < this.size) {
          this.pixels.push({ x: mir.x, y: mir.y, color: hex });
        }
      }
    }
  }

  // ─── Segment processing ───

  _getWidth(seg, t) {
    const w = seg.width;
    if (typeof w === "number") return Math.round(w);
    if (w.from !== undefined && w.to !== undefined) {
      const range = seg.range;
      const progress = (t - range[0]) / (range[1] - range[0]);
      return Math.round((w.from + (w.to - w.from) * progress));
    }
    if (typeof w === "function") return Math.round(w(t));
    return 0;
  }

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
    } else if (fillSpec.type === "dual") {
      fill = FILLS.dual(fillSpec.colorsLight, fillSpec.colorsDark);
    } else {
      fill = FILLS.solid("#000000");
    }
    this._fillCache.set(key, fill);
    return fill;
  }

  _processSegment(seg) {
    const [tStart, tEnd] = seg.range;
    const fill = this._getFill(seg.fill);
    const textures = seg.textures || [];
    const lighting = seg.lighting !== undefined ? seg.lighting : "centerDark";

    for (let t = tStart; t <= tEnd; t++) {
      const hw = this._getWidth(seg, t);
      if (hw < 0) continue;

      for (let dx = 0; dx <= hw; dx++) {
        const color = fill.getColor(t, dx, hw, tStart, tEnd);
        if (this._sym.name === "vertical") {
          this.m(Math.ceil(this.center) + dx, t, color);
        } else {
          this.m(t + dx, t, color);
        }
      }

      for (const tex of textures) {
        this._applyTexture(tex, t, hw);
      }

      this._applyLighting(lighting, t, hw);
    }
  }

  // ─── Texture system ───

  _applyTexture(tex, t, hw) {
    const color = this._resolve(tex.color);
    if (!color) return;

    const _sx = (dx) =>
      this._sym.name === "vertical" ? Math.ceil(this.center) + dx : t + dx;

    switch (tex.type) {
      case "stripe": {
        if (tex.every && t % tex.every === 0) {
          const w = tex.width || hw;
          for (let dx = 0; dx <= Math.min(w, hw); dx++) {
            this.m(_sx(dx), t, color);
          }
        }
        break;
      }
      case "moss": {
        const chance = tex.chance || 0.15;
        if (Math.random() < chance) {
          for (let dx = 0; dx <= Math.min(2, hw); dx++) {
            this.m(_sx(dx), t, color);
          }
        }
        break;
      }
      case "outline": {
        if (hw >= 0) this.m(_sx(hw), t, color);
        break;
      }
      case "center": {
        this.m(_sx(0), t, color);
        break;
      }
      case "crystal": {
        const facetSize = tex.facetSize || 2;
        for (let dx = 0; dx <= hw; dx++) {
          const facetX = Math.floor(dx / facetSize);
          const facetY = Math.floor(t / facetSize);
          const facetVal = H(facetX * 7, facetY * 13);
          const isBright = facetVal > 0.5;
          const isEdge = Math.abs((dx % facetSize) - (facetSize / 2)) < 0.8 ||
                         Math.abs((t % facetSize) - (facetSize / 2)) < 0.8;
          if (isBright) {
            this.m(_sx(dx), t, isEdge ? color : tex.highlight || color);
          } else {
            this.m(_sx(dx), t, tex.dark || color);
          }
          if (dx === 0 && tex.glow && Math.abs(t % (facetSize * 2) - facetSize) < 1.5) {
            this.m(_sx(dx), t, tex.glow);
          }
        }
        break;
      }
      case "metal": {
        const specPos = tex.specular || 0.3;
        const specWidth = tex.specularWidth || 0.15;
        for (let dx = 0; dx <= hw; dx++) {
          const ratio = hw > 0 ? dx / hw : 0;
          if (Math.abs(ratio - specPos) < specWidth) {
            const intensity = 1 - Math.abs(ratio - specPos) / specWidth;
            const base = hexToRgbArr(color);
            const bright = hexToRgbArr(tex.highlight || "#FFFFFF");
            const mixed = mixColor(base, bright, intensity * 0.6);
            this.m(_sx(dx), t, rgbArrToHex(mixed[0], mixed[1], mixed[2]));
          } else {
            const base = hexToRgbArr(color);
            const noisy = noiseInject(base, dx, t, 2);
            this.m(_sx(dx), t, rgbArrToHex(noisy[0], noisy[1], noisy[2]));
          }
        }
        break;
      }
      default:
        break;
    }
  }

  _applyLighting(mode, t, hw) {
    if (mode === "none" || hw < 0) return;
    // Currently a no-op placeholder; gradients and textures handle lighting.
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
      if (p.big) {
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

  // ─── Post-processing ───

  _autoShade(strength) {
    if (!strength || strength <= 0) return;
    const shadeStrength = strength;
    for (const p of this.pixels) {
      const dx = this._templateDx(p.x, p.y);
      let hw = 0;
      if (this._templateData) {
        hw = this._templateData.hwByT.get(this._templateAxisParam(p.x, p.y)) || 0;
      }
      const ratio = hw > 0 ? dx / hw : 0;
      const shadeAmount = Math.pow(ratio, 0.5) * shadeStrength;
      const hex = p.color;
      if (hex && hex !== "none" && hex.startsWith("#")) {
        const c = hexToRgbArr(hex);
        const darkened = darken(c, shadeAmount * 0.3);
        const lighted = lighten(c, shadeAmount * 0.2);
        const result = mixColor(lighted, darkened, ratio);
        p.color = rgbArrToHex(result[0], result[1], result[2]);
      }
    }
  }

  _adaptiveOutline(amount) {
    if (!amount || amount <= 0) return;
    const pixelSet = new Set();
    for (const p of this.pixels) {
      pixelSet.add(`${p.x},${p.y}`);
    }

    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const p of this.pixels) {
      for (const [dx, dy] of dirs) {
        const nk = `${p.x + dx},${p.y + dy}`;
        if (!pixelSet.has(nk)) {
          const hex = p.color;
          if (hex && hex !== "none" && hex.startsWith("#")) {
            const c = hexToRgbArr(hex);
            const oc = adaptiveOutline(c);
            const a = amount;
            p.color = rgbArrToHex(
              c[0] * (1 - a) + oc[0] * a,
              c[1] * (1 - a) + oc[1] * a,
              c[2] * (1 - a) + oc[2] * a,
            );
          }
          break;
        }
      }
    }
  }

  _quantizePalette(maxColors) {
    if (!maxColors || maxColors <= 0) return;
    const colorCount = new Map();
    for (const p of this.pixels) {
      const hex = p.color;
      if (hex && hex !== "none") {
        colorCount.set(hex, (colorCount.get(hex) || 0) + 1);
      }
    }

    if (colorCount.size <= maxColors) return;

    const sorted = [...colorCount.entries()].sort((a, b) => b[1] - a[1]);
    const keep = new Set(sorted.slice(0, maxColors).map(e => e[0]));

    const discardMap = new Map();
    const keptColors = [...keep].map(h => ({ hex: h, rgb: hexToRgbArr(h) }));

    for (const [hex] of sorted.slice(maxColors)) {
      const rgb = hexToRgbArr(hex);
      let nearest = keptColors[0];
      let minDist = Infinity;
      for (const kc of keptColors) {
        const dr = rgb[0] - kc.rgb[0];
        const dg = rgb[1] - kc.rgb[1];
        const db = rgb[2] - kc.rgb[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < minDist) { minDist = dist; nearest = kc; }
      }
      discardMap.set(hex, nearest.hex);
    }

    for (const p of this.pixels) {
      if (discardMap.has(p.color)) {
        p.color = discardMap.get(p.color);
      }
    }
  }

  // ─── Main render ───

  render() {
    this.pixels = [];

    if (this.template) {
      this._renderTemplate();
    } else {
      for (const seg of this.body) {
        this._processSegment(seg);
      }
    }

    for (const dec of this.decorations) {
      this._processDecoration(dec);
    }

    if (this.postProcess) {
      if (this.postProcess.autoShade) this._autoShade(this.postProcess.autoShade);
      if (this.postProcess.adaptiveOutline) this._adaptiveOutline(this.postProcess.adaptiveOutline);
      if (this.postProcess.quantize) this._quantizePalette(this.postProcess.quantize);
    }

    return this;
  }

  // ─── Template System ───

  _readImage(filepath) {
    let actualPath = filepath;
    if (!path.isAbsolute(filepath)) {
      if (!fs.existsSync(filepath)) {
        const resolved = path.resolve(path.dirname(this.template || "."), filepath);
        if (fs.existsSync(resolved)) actualPath = resolved;
      }
    }
    return decodeImage(actualPath);
  }

  _loadTemplate(filepath) {
    const decoded = this._readImage(filepath);
    const { width, height, pixels } = decoded;

    const { logicalSize: _tmplSize, scale: tmplScale } = detectLogicalSize(decoded);
    const tmplWidth = Math.round(width / tmplScale);
    const tmplHeight = Math.round(height / tmplScale);
    const scaleRatioX = this.size / tmplWidth;
    const scaleRatioY = this.size / tmplHeight;
    const blockSizeX = Math.max(1, Math.ceil(scaleRatioX));
    const blockSizeY = Math.max(1, Math.ceil(scaleRatioY));

    const occupied = new Set();
    for (const p of pixels) {
      if (p.a === 0) continue;
      const tx = Math.floor(p.x / tmplScale);
      const ty = Math.floor(p.y / tmplScale);
      const flipY = tmplHeight - 1 - ty;
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

    const templatePixels = [];
    for (const key of occupied) {
      const [x, y] = key.split(",").map(Number);
      templatePixels.push({ x, y });
    }

    const byT = new Map();
    for (const p of templatePixels) {
      const t = this._templateAxisParam(p.x, p.y);
      if (!byT.has(t)) byT.set(t, []);
      byT.get(t).push(p);
    }

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

  /** Compute the axis parameter t for a template pixel. */
  _templateAxisParam(x, y) {
    if (this._sym.name === "diagonal") return Math.min(x, y);
    if (this._sym.name === "vertical") return y;
    return x;
  }

  /** Compute the distance from the symmetry axis for a template pixel. */
  _templateDx(x, y) {
    if (this._sym.name === "diagonal") return Math.abs(x - y);
    if (this._sym.name === "vertical") return Math.abs(x - Math.ceil(this.center));
    return Math.abs(y - Math.ceil(this.center));
  }

  _renderTemplate() {
    this._templateData = this._loadTemplate(this.template);
    const { byT, hwByT } = this._templateData;

    const sortedSegs = [...this.body].sort((a, b) => a.range[0] - b.range[0]);

    for (const [t, tPixels] of byT) {
      const seg = sortedSegs.find(s => t >= s.range[0] && t <= s.range[1]);
      if (!seg) continue;

      const fill = this._getFill(seg.fill);
      const hw = hwByT.get(t) || 0;
      const textures = seg.textures || [];

      for (const p of tPixels) {
        const dx = this._templateDx(p.x, p.y);
        const color = fill.getColor(t, dx, hw, seg.range[0], seg.range[1]);
        const hex = this._resolvedPalette[color] || color || "#000000";
        this.px(p.x, p.y, hex);
      }

      for (const tex of textures) {
        this._applyTemplateTexture(tex, t, tPixels, hw);
      }
    }
  }

  _applyTemplateTexture(tex, t, tPixels, hw) {
    const color = this._resolve(tex.color);
    if (!color) return;

    switch (tex.type) {
      case "stripe": {
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
        for (const p of tPixels) {
          const dx = this._templateDx(p.x, p.y);
          if (dx === hw) {
            this.px(p.x, p.y, color);
          }
        }
        break;
      }
      case "center": {
        for (const p of tPixels) {
          const dx = this._templateDx(p.x, p.y);
          if (dx === 0) {
            this.px(p.x, p.y, color);
          }
        }
        break;
      }
      case "crystal": {
        const facetSize = tex.facetSize || 2;
        for (const p of tPixels) {
          const dx = this._templateDx(p.x, p.y);
          const facetX = Math.floor(dx / facetSize);
          const facetY = Math.floor(t / facetSize);
          const facetVal = H(facetX * 7, facetY * 13);
          const isBright = facetVal > 0.5;
          const isEdge = Math.abs((dx % facetSize) - (facetSize / 2)) < 0.8 ||
                         Math.abs((t % facetSize) - (facetSize / 2)) < 0.8;
          this.px(p.x, p.y, isBright ? (isEdge ? color : (tex.highlight || color)) : (tex.dark || color));
          if (dx === 0 && tex.glow && Math.abs(t % (facetSize * 2) - facetSize) < 1.5) {
            this.px(p.x, p.y, tex.glow);
          }
        }
        break;
      }
      case "metal": {
        const specPos = tex.specular || 0.3;
        const specWidth = tex.specularWidth || 0.15;
        for (const p of tPixels) {
          const dx = this._templateDx(p.x, p.y);
          const ratio = hw > 0 ? dx / hw : 0;
          if (Math.abs(ratio - specPos) < specWidth) {
            const intensity = 1 - Math.abs(ratio - specPos) / specWidth;
            const base = hexToRgbArr(color);
            const bright = hexToRgbArr(tex.highlight || "#FFFFFF");
            const mixed = mixColor(base, bright, intensity * 0.6);
            this.px(p.x, p.y, rgbArrToHex(mixed[0], mixed[1], mixed[2]));
          } else {
            const base = hexToRgbArr(color);
            const noisy = noiseInject(base, dx, t, 2);
            this.px(p.x, p.y, rgbArrToHex(noisy[0], noisy[1], noisy[2]));
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

module.exports = { PixelEngine };
