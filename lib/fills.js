/**
 * lib/fills.js — Fill strategy factories for body segment coloring.
 *
 * Each factory returns { type, getColor(t, dx, hw, segStart, segEnd) }.
 * getColor returns a palette key name or hex string.
 */
const { clamp, H, hexToRgbArr, rgbArrToHex, mixColor } = require("./color");

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

  /**
   * Dual-palette shading: light palette near axis, dark palette near edge.
   * Uses deterministic noise for natural variation.
   */
  dual(lightColors, darkColors) {
    return {
      type: "dual",
      getColor: (t, dx, hw) => {
        if (hw <= 0) return lightColors[0];
        const ratio = dx / hw;
        const jitter = (H(t * 3, dx * 7) - 0.5) * 0.04;
        const biasedRatio = clamp(ratio + jitter, 0, 1);
        const lightIdx = clamp(Math.round(biasedRatio * (lightColors.length - 1)), 0, lightColors.length - 1);
        const darkIdx = clamp(Math.round(biasedRatio * (darkColors.length - 1)), 0, darkColors.length - 1);
        const mix = Math.pow(biasedRatio, 0.7);
        const l = hexToRgbArr(lightColors[lightIdx]);
        const d = hexToRgbArr(darkColors[darkIdx]);
        const m = mixColor(l, d, mix);
        return rgbArrToHex(m[0], m[1], m[2]);
      },
    };
  },
};

module.exports = { FILLS };
