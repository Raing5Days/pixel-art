# Pixel Art Engine — OpenCode Skill

A declarative pixel art generation engine. Describe weapons/items in natural language, produce PNG pixel art via a configuration-driven engine.

## Quick Start

```javascript
const { PixelEngine } = require("./lib");

new PixelEngine({
  size: 64,
  scale: 8,
  palette: { dark: "#0a1e3d", mid: "#1a4a8a", light: "#7ab8ff", white: "#ffffff" },
  symmetry: "diagonal",
  template: "base_shapes/orb_staff_circle.png",
  body: [
    { range: [0, 6],   fill: { type: "gradient", colors: ["dark", "mid"] } },
    { range: [7, 27],  fill: { type: "gradient", colors: ["dark", "mid", "light"] } },
    { range: [28, 34], fill: { type: "gradient", colors: ["mid", "light"] } },
    { range: [35, 40], fill: { type: "solid", color: "light" } },
    { range: [41, 60], fill: { type: "gradient", colors: ["white", "light", "mid", "dark"] } },
  ],
}).render().savePNG("output.png");
```

## Library Structure

```
lib/
├── index.js       # Entry point: re-exports PixelEngine, FILLS, SYMMETRY
├── color.js       # Pure color functions (hexToRgb, H, mixColor, etc.)
├── png.js         # PNG encode/decode, logical size detection
├── image.js       # Image loading (PNG native, WebP via PIL)
├── symmetry.js    # SYMMETRY strategies (diagonal, vertical, horizontal)
├── fills.js       # FILLS strategies (solid, gradient, linear, dual)
└── engine.js      # PixelEngine class

base_shapes/        # Pre-made weapon contour templates (PNG)
├── orb_staff_circle.png    # Staff with round orb (64×64)
├── staff.png               # Staff with diamond orb (64×64)
├── broadsword.png          # Broadsword (64×64)
├── short_sword.png         # Short sword (64×64)
├── throwing_knife.png      # Throwing knife (64×64)
└── ...                     # More templates
```

## Config Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `size` | number | 128 | Canvas size (32/64/128) |
| `scale` | number | 8 | Output pixel size multiplier |
| `palette` | object | `{}` | Color names → hex: `{ gold: "#FFD700" }` |
| `symmetry` | string | "diagonal" | "diagonal" \| "vertical" \| "horizontal" |
| `body` | Segment[] | `[]` | Symmetric colored segments |
| `decorations` | Decoration[] | `[]` | Asymmetric decorative elements |
| `template` | string | null | Path to base shape PNG |
| `center` | number | auto | Symmetry axis position |
| `postProcess` | object | null | `{ autoShade, adaptiveOutline, quantize }` |

### Body Segments

```javascript
{ range: [tStart, tEnd],    // Axis parameter range
  fill: { type, colors },    // Fill strategy
  textures: [{ type, ... }], // Optional texture overlays
  lighting: "centerDark"     // Optional lighting mode
}
```

**Fill types:**
- `solid` — `{ type: "solid", color: "name" }`
- `gradient` — `{ type: "gradient", colors: ["name1", "name2", ...] }`
- `linear` — `{ type: "linear", colors: [...] }` (axial gradient)
- `dual` — `{ type: "dual", colorsLight: [...], colorsDark: [...] }` (center light, edge dark)

**Texture types:** `stripe`, `moss`, `outline`, `center`, `crystal`, `metal`

### Decorations

- `vine` — Sine-wave ribbons along the axis
- `vineLeaf` — Leaf accent
- `particles` — Pixel clusters at specific positions
- `pixel` — Single pixel
- `rect` — Filled or outlined rectangle

## Coordinate System

Origin at **bottom-left** `(0, 0)`. X right, Y up. PNG output flips Y automatically.

## Templates

Templates are pre-drawn weapon silhouettes in `base_shapes/`. Template mode separates geometry from coloring:

1. Select template: `template: "base_shapes/broadsword.png"`
2. Define body with colors only (no `width`)
3. Engine fills template pixels with your colors

Create new templates via classic mode:
```javascript
new PixelEngine({
  size: 64, scale: 8, palette: { c: "#000000" }, symmetry: "diagonal",
  body: [ /* segments with width + fill: "#000000" */ ],
}).render().savePNG("base_shapes/new_weapon.png");
```

## Natural Language → Pixel Art Pipeline

1. Determine canvas size (32/64/128)
2. Check `base_shapes/` for matching template
3. Determine symmetry type
4. Template mode: body defines colors only
5. Classic mode: body defines width + fill
6. Add asymmetric decorations
7. Output PNG

## Cache Workflow

All generated artifact scripts go to `cache/`, not project root.

**Naming convention:** `cache/gen_YYYYMMDD_description.js`

**Cleanup rule:** Before writing a new cache entry, delete entries older than 7 days.
The AI agent automatically handles cache cleanup — no manual action needed.

**Example:**
```javascript
// Write script → runs → produces PNG
// Script saved to: cache/gen_20260506_vortex_staff.js
// Output saved to: root (vortex_staff.png)
// Old cache entries (>7d) auto-deleted before write
```

**Import path from cache/:** `require("../pixel_engine")` or `require("../lib")`

## Managing Templates

Templates live in `base_shapes/` as PNG files. The skill loads them at render time — no lock-in.

**Adding a new template:** Use classic mode to generate a silhouette:

```javascript
const { PixelEngine } = require("./lib");

// Classic mode with black fill → produces silhouette
new PixelEngine({
  size: 64, scale: 8,
  palette: { c: "#000000" },
  symmetry: "diagonal",
  body: [
    { range: [0, 6],   width: 2, fill: "c" },
    { range: [7, 30],  width: 3, fill: "c" },
    // ... define geometry with width
  ],
}).render().savePNG("base_shapes/new_weapon.png");
```

Then reference it in any generation script:

```javascript
template: "base_shapes/new_weapon.png",
body: [
  { range: [0, 6],   fill: { type: "gradient", colors: ["#dark", "#light"] } },
  // ... colors only, no width
],
```

**Updating an existing template:** Regenerate the PNG with the same filename — all scripts referencing it will use the new shape next time they run.

**Importing external pixel art as template:** Any PNG with transparent background works. The engine auto-detects scale (supports 32/64/128 at 1×–16×). Place it in `base_shapes/` and reference by filename.
