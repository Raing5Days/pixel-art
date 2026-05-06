/**
 * lib/index.js — Pixel Art Engine entry point.
 *
 * Re-exports the PixelEngine class and static strategy objects.
 *
 * Usage:
 *   const { PixelEngine, FILLS, SYMMETRY } = require("./lib");
 *   new PixelEngine({ size: 64, ... }).render().savePNG("out.png");
 */
const { PixelEngine } = require("./engine");
const { FILLS } = require("./fills");
const { SYMMETRY } = require("./symmetry");

module.exports = { PixelEngine, FILLS, SYMMETRY };
