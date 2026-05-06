const { PixelEngine } = require("./pixel_engine");

// 五彩调色板 — 红/橙/黄/绿/蓝/紫/粉
const P = {
  // Red → Orange (Handle)
  rDark: "#8B0000", rMain: "#FF2200", rLight: "#FF6644", rBright: "#FF8866",
  // Gold (Collar / accent)
  gDark: "#B8860B", gMain: "#FFD700", gLight: "#FFEB3B", gBright: "#FFF9C4",
  // Green → Teal (Shaft)
  grDark: "#006400", grMain: "#228B22", grMid: "#00AA55", grLight: "#44DD88", grBright: "#88FFBB",
  // Blue → Indigo (Diamond head body)
  bDark: "#00008B", bMain: "#1E3AFF", bMid: "#4169E1", bLight: "#6495ED", bBright: "#87CEEB",
  // Purple (Diamond head accent)
  pDark: "#4B0082", pMain: "#8A2BE2", pLight: "#9966FF", pBright: "#CC99FF",
  // Pink → Magenta (Diamond tip / crystal glow)
  pkDark: "#C71585", pkMain: "#FF1493", pkLight: "#FF69B4", pkGlow: "#FFB6C1", pkCore: "#FFE4E1",
  // White sparkle
  white: "#FFFFFF",
};

new PixelEngine({
  size: 42,
  scale: 10,
  palette: P,
  symmetry: "diagonal",
  template: "base_shapes/Diamond_Staff.webp",
  body: [
    // ========== 1. Handle — Red/Orange gradient ==========
    { range: [0, 7],
      fill: { type: "gradient", colors: ["rDark", "rMain", "rLight", "rBright"] },
      textures: [{ type: "stripe", every: 2, color: "gMain" }] },

    // ========== 2. Shaft — Green → Teal gradient ==========
    { range: [8, 19],
      fill: { type: "gradient", colors: ["grDark", "grMain", "grMid", "grLight", "grBright"] } },

    // ========== 3. Collar — Gold accent ==========
    { range: [20, 25],
      fill: { type: "gradient", colors: ["gDark", "gMain", "gLight", "gBright"] } },

    // ========== 4. Diamond head — Blue → Purple gradient ==========
    { range: [26, 33],
      fill: { type: "gradient", colors: ["bDark", "bMain", "bMid", "bLight", "bBright", "pLight", "pMain"] },
      textures: [
        { type: "outline", color: "pBright" },
        { type: "center", color: "white" },
      ] },

    // ========== 5. Diamond tip — Pink/Magenta glow ==========
    { range: [34, 39],
      fill: { type: "gradient", colors: ["pkDark", "pkMain", "pkLight", "pkGlow", "pkCore"] },
      textures: [{ type: "outline", color: "white" }] },
  ],
  decorations: [
    // Sparkle particles around the diamond head
    { type: "particles",
      colors: ["white", "pkGlow", "pkCore", "gBright"],
      positions: [
        { x: 26, y: 30 }, { x: 29, y: 34 }, { x: 33, y: 29 },
        { x: 30, y: 36 }, { x: 35, y: 32 }, { x: 36, y: 36 },
        { x: 28, y: 28, big: true }, { x: 34, y: 34, big: true },
      ] },
  ],
}).render().savePNG("colorful_staff.png");
