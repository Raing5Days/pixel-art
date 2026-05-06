/**
 * lib/image.js — Image loading: PNG via native decoder, WebP/others via PIL subprocess.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { decodePNG } = require("./png");

/**
 * Decode a WebP (or any PIL-supported format) file into raw RGBA pixel data.
 * Uses Python PIL/Pillow via subprocess.
 * @returns {{ width, height, pixels: [{x, y, r, g, b, a}, ...] }}
 */
function decodeImage(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  if (ext === ".png") {
    return decodePNG(filepath);
  }

  const pythonScript = `
from PIL import Image
import sys, struct, io, os

with open(sys.argv[1], "rb") as f:
    data = f.read()
im = Image.open(io.BytesIO(data))

if im.mode != "RGBA":
    im = im.convert("RGBA")

w, h = im.size
sys.stdout.buffer.write(struct.pack("<II", w, h))
sys.stdout.buffer.write(im.tobytes())
`;

  const pythonCmd = _findPython();

  const result = spawnSync(pythonCmd, ["-c", pythonScript, filepath], {
    timeout: 10000,
    maxBuffer: 50 * 1024 * 1024,
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
  const width = stdout.readUInt32LE(0);
  const height = stdout.readUInt32LE(4);
  const rawData = stdout.slice(8);

  const expectedLen = width * height * 4;
  if (rawData.length !== expectedLen) {
    throw new Error(
      `Decoded image data size mismatch: expected ${expectedLen}, got ${rawData.length}`
    );
  }

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
 */
function _findPython() {
  const isWin = process.platform === "win32";
  const ext = isWin ? ".exe" : "";
  const knownPaths = [
    `D:/tokenySpace/.shared-venv/Scripts/python${ext}`,
    path.join(path.dirname(process.execPath), "..", ".shared-venv", "Scripts", `python${ext}`),
    path.join(process.env.USERPROFILE || "C:\\Users\\default", "tokeny", "space", ".shared-venv", "Scripts", `python${ext}`),
    "/opt/tokeny/.shared-venv/bin/python3",
    "/usr/local/tokeny/.shared-venv/bin/python3",
  ];

  const _testPIL = (cmd) => {
    try {
      const r = spawnSync(cmd, ["-c", "from PIL import Image; print(Image.__version__)"], { timeout: 3000 });
      return r.status === 0;
    } catch { return false; }
  };

  for (const p of knownPaths) {
    try {
      if (fs.existsSync(p) && _testPIL(p)) return p;
    } catch { /* try next */ }
  }

  for (const cmd of ["python", "python3", "py"]) {
    if (_testPIL(cmd)) return cmd;
  }

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

module.exports = { decodeImage, _findPython };
