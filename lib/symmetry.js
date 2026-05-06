/**
 * lib/symmetry.js — Symmetry strategy factories.
 *
 * Each symmetry type returns a strategy object with:
 *   name, seed(t, dx), mirror(x,y), isSeed(x,y),
 *   boundCheck(p, size), validSeed(p, size), axisParam(x,y)
 */

const SYMMETRY = {
  /**
   * Diagonal (y=x) symmetry.
   * Seed: x >= y  → mirror: (x,y) ↔ (y,x)
   * Axis runs bottom-left to top-right.
   */
  diagonal(cx, cy) {
    return {
      name: "diagonal",
      seed: (t, dx) => ({ x: t + dx, y: t }),
      mirror: (x, y) => ({ x: y, y: x }),
      isSeed: (x, y) => x >= y,
      boundCheck: (px, size) => px.x >= 0 && px.x < size && px.y >= 0 && px.y < size,
      validSeed: (p, size) => p.x >= p.y && p.x >= 0 && p.x < size && p.y >= 0 && p.y < size,
      axisParam: (x, y) => y,
    };
  },

  /**
   * Vertical (left-right) symmetry about x = cx.
   * Seed: x >= cx  → mirror: (x,y) ↔ (2*cx-x, y)
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

module.exports = { SYMMETRY };
