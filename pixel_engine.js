/**
 * pixel_engine.js — Backward-compatible re-export.
 *
 * The engine has been split into modular files under lib/.
 * This file exists so existing scripts (require("./pixel_engine"))
 * continue to work without changes.
 *
 * New code should use: const { PixelEngine } = require("./lib");
 */
module.exports = require("./lib");
