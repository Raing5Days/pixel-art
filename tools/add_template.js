/**
 * tools/add_template.js — Import external images as pixel art templates.
 *
 * Usage:
 *   node tools/add_template.js <image_path> [template_name]
 *
 * Reads any image (PNG, WebP, JPEG, GIF, etc.), detects pixel-art scale,
 * and saves as a proper PNG template in base_shapes/.
 *
 * If template_name is omitted, uses the original filename (with .png extension).
 *
 * Examples:
 *   node tools/add_template.js ~/Downloads/my_axe.webp
 *   node tools/add_template.js ~/Downloads/star.jpg star_template
 */
const path = require("path");
const fs = require("fs");
const { decodeImage } = require("../lib/image");
const { detectLogicalSize } = require("../lib/png");

const src = process.argv[2];
if (!src) {
  console.error("Usage: node tools/add_template.js <image_path> [template_name]");
  process.exit(1);
}

if (!fs.existsSync(src)) {
  console.error(`File not found: ${src}`);
  process.exit(1);
}

// Resolve template name
let baseName = process.argv[3];
if (!baseName) {
  baseName = path.basename(src, path.extname(src));
}
// Ensure .png extension
if (!baseName.endsWith(".png")) baseName += ".png";

const dest = path.resolve("base_shapes", baseName);

// Read the image (handles PNG natively, WebP/JPEG/etc via PIL)
console.log(`Reading: ${src}`);
const decoded = decodeImage(src);
const { width, height } = decoded;

// Detect pixel-art logical size
const { logicalSize, scale } = detectLogicalSize(decoded);

console.log(`  Dimensions: ${width}×${height}`);
console.log(`  Detected:   ${logicalSize}×${logicalSize} pixel art @ ${scale}×`);

// For non-pixel-art images (scale=1), warn but continue
if (scale <= 1 && logicalSize > 64) {
  console.log(`  Note: Image appears to be a continuous-tone image, not pixel art.`);
  console.log(`  The template may need manual adjustment.`);
}

// Re-encode as PNG (using the internal PNG encoder)
const { encodePNG } = require("../lib/png");

// Build RGBA buffer from decoded pixel data
// Templates need: opaque pixels for the shape, transparent for background
const buf = Buffer.alloc(width * height * 4, 0);
for (const p of decoded.pixels) {
  if (p.a === 0) continue; // keep transparent
  const off = (p.y * width + p.x) * 4;
  buf[off] = p.r;
  buf[off + 1] = p.g;
  buf[off + 2] = p.b;
  buf[off + 3] = 255; // shape pixels fully opaque
}

const pngData = encodePNG(width, height, buf);
fs.writeFileSync(dest, pngData);

console.log(`✅ Template saved: ${dest}`);
console.log(`   ${logicalSize}×${logicalSize} logical pixels @ ${scale}×`);
console.log(`   Use in config: template: "base_shapes/${baseName}"`);
