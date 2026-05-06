/**
 * lib/color.js — Color utility functions for pixel art engine.
 * Pure functions, no engine dependencies.
 */

/** Parse hex color "#rrggbb" → { r, g, b } */
function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** Linear interpolation: a + (b - a) * t */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Clamp v between min and max */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Deterministic integer hash: same (x,y) always produces same 0-1 value.
 * No seed management, naturally tileable, fully reproducible.
 */
function H(x, y) {
  let n = ((x | 0) * 374761393 + (y | 0) * 668265263 + 1013904223) | 0;
  n = (((n >> 13) ^ n) * 1274126177) | 0;
  return (((n >> 16) ^ n) >>> 0) / 4294967296;
}

/** Darken an RGB array by factor a (0-1) */
function darken(c, a) {
  return [Math.max(0, (c[0] * (1 - a)) | 0), Math.max(0, (c[1] * (1 - a)) | 0), Math.max(0, (c[2] * (1 - a)) | 0)];
}

/** Lighten an RGB array by factor a (0-1) */
function lighten(c, a) {
  return [Math.min(255, (c[0] + (255 - c[0]) * a) | 0), Math.min(255, (c[1] + (255 - c[1]) * a) | 0), Math.min(255, (c[2] + (255 - c[2]) * a) | 0)];
}

/** Noise injection: add deterministic variance to each channel */
function noiseInject(c, x, y, range) {
  const n = (H(x * 7, y * 13) - 0.5) * range;
  return [Math.max(0, Math.min(255, (c[0] + n) | 0)), Math.max(0, Math.min(255, (c[1] + n) | 0)), Math.max(0, Math.min(255, (c[2] + n) | 0))];
}

/** Linear interpolation between two RGB arrays by ratio t (0=a, 1=b) */
function mixColor(a, b, t) {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

/** Adaptive outline color: hue-aware darkening instead of uniform black */
function adaptiveOutline(c) {
  const avg = (c[0] + c[1] + c[2]) / 3;
  return [
    Math.max(0, (c[0] * 0.35 + (c[0] - avg) * 0.15 - 5) | 0),
    Math.max(0, (c[1] * 0.30 + (c[1] - avg) * 0.15 - 8) | 0),
    Math.max(0, (c[2] * 0.40 + (c[2] - avg) * 0.15) | 0),
  ];
}

/** Parse hex string to RGB array [#rrggbb] → [r, g, b] */
function hexToRgbArr(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Format RGB array to hex string [r, g, b] → "#rrggbb" */
function rgbArrToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

module.exports = {
  hexToRgb,
  lerp,
  clamp,
  H,
  darken,
  lighten,
  noiseInject,
  mixColor,
  adaptiveOutline,
  hexToRgbArr,
  rgbArrToHex,
};
