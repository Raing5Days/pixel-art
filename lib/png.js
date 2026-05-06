/**
 * lib/png.js — PNG encoder, decoder, and logical size detection.
 * Pure functions, standalone — no engine dependencies.
 */
const zlib = require("zlib");
const fs = require("fs");

// ─── PNG Encoder ───

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

/**
 * Encode raw RGBA buffer to PNG binary.
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgbaBuffer - Flat RGBA bytes, row-major
 * @returns {Buffer} Complete PNG file bytes
 */
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

// ─── PNG Decoder ───

/**
 * Decode a PNG file from disk into raw RGBA pixel data.
 * Handles filter types 0 (None), 1 (Sub), 2 (Up), 3 (Average), 4 (Paeth).
 * @returns {{ width, height, pixels: [{x, y, r, g, b, a}, ...] }}
 */
function decodePNG(filepath) {
  const buf = fs.readFileSync(filepath);
  const sig = buf.slice(0, 8);
  if (sig[1] !== 0x50 || sig[2] !== 0x4e || sig[3] !== 0x47)
    throw new Error("Not a valid PNG: " + filepath);

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

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = 4;
  const stride = 1 + width * bpp;

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

      let leftR = 0, leftG = 0, leftB = 0, leftA = 0;
      if (x > 0) {
        const leftOff = outOff - bpp;
        leftR = reconstructed[leftOff];
        leftG = reconstructed[leftOff + 1];
        leftB = reconstructed[leftOff + 2];
        leftA = reconstructed[leftOff + 3];
      }

      let upR = 0, upG = 0, upB = 0, upA = 0;
      if (prevRow) {
        upR = prevRow[x * bpp];
        upG = prevRow[x * bpp + 1];
        upB = prevRow[x * bpp + 2];
        upA = prevRow[x * bpp + 3];
      }

      let ulR = 0, ulG = 0, ulB = 0, ulA = 0;
      if (x > 0 && prevRow) {
        ulR = prevRow[(x - 1) * bpp];
        ulG = prevRow[(x - 1) * bpp + 1];
        ulB = prevRow[(x - 1) * bpp + 2];
        ulA = prevRow[(x - 1) * bpp + 3];
      }

      let r, g, b, a;

      switch (filter) {
        case 0:
          r = rawR; g = rawG; b = rawB; a = rawA;
          break;
        case 1:
          r = (rawR + leftR) & 0xff;
          g = (rawG + leftG) & 0xff;
          b = (rawB + leftB) & 0xff;
          a = (rawA + leftA) & 0xff;
          break;
        case 2:
          r = (rawR + upR) & 0xff;
          g = (rawG + upG) & 0xff;
          b = (rawB + upB) & 0xff;
          a = (rawA + upA) & 0xff;
          break;
        case 3:
          r = (rawR + ((leftR + upR) >>> 1)) & 0xff;
          g = (rawG + ((leftG + upG) >>> 1)) & 0xff;
          b = (rawB + ((leftB + upB) >>> 1)) & 0xff;
          a = (rawA + ((leftA + upA) >>> 1)) & 0xff;
          break;
        case 4: {
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
 * Uses content analysis to find the minimum block size (scale).
 * @returns {{ logicalSize: number, scale: number }}
 */
function detectLogicalSize(decoded) {
  const { width, height, pixels } = decoded;

  let detectedScale = 0;
  const candidates = [];

  for (let row = 0; row < height; row++) {
    const rowPixels = pixels.filter(p => p.y === row);
    const hasAlpha = rowPixels.filter(p => p.a > 0);
    if (hasAlpha.length === 0 || hasAlpha.length === width) continue;

    const transitions = [];
    let prevAlpha = rowPixels[0].a > 0 ? 1 : 0;
    for (let x = 1; x < width; x++) {
      const currAlpha = rowPixels[x].a > 0 ? 1 : 0;
      if (currAlpha !== prevAlpha) transitions.push(x);
      prevAlpha = currAlpha;
    }

    if (transitions.length < 2) continue;

    const gaps = [];
    for (let i = 1; i < transitions.length; i++) {
      gaps.push(transitions[i] - transitions[i - 1]);
    }

    if (gaps.length === 0) continue;

    const minGap = Math.min(...gaps);
    if (minGap > 1) {
      candidates.push(minGap);
    }
  }

  if (candidates.length > 0) {
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

    if (width % bestScale === 0 && height % bestScale === 0) {
      return { logicalSize: width / bestScale, scale: bestScale };
    }
  }

  const standards = [64, 128, 32];
  for (const s of standards) {
    if (width % s === 0 && height % s === 0) {
      const scale = width / s;
      if (scale >= 2 && scale <= 32) return { logicalSize: s, scale };
    }
  }

  const scale = Math.max(1, Math.round(width / 64));
  return { logicalSize: Math.round(width / scale), scale };
}

module.exports = {
  crc32,
  pngChunk,
  encodePNG,
  decodePNG,
  detectLogicalSize,
};
