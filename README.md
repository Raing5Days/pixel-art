# Pixel Art Engine

A declarative pixel art generation engine. Describe weapons and items in natural language, and produce PNG pixel art via a configuration-driven engine.

## Features

- **Declarative Configuration** — Define pixel art via simple JS config objects (body segments, decorations, palettes)
- **Template Mode** — Separate geometry from coloring. Use pre-made weapon silhouettes from `base_shapes/` and fill them with color gradients
- **Classic Mode** — Define geometry and coloring inline for fully custom shapes
- **Symmetry Support** — Diagonal, vertical, and horizontal symmetry strategies
- **Multiple Fill Types** — Solid, gradient, linear, and dual fills
- **Decorations** — Add asymmetric elements like vines, leaves, particles, and rectangles
- **PNG Output** — Generates transparent-background PNG images

## Quick Start

```javascript
const { PixelEngine } = require("./lib");

new PixelEngine({
  size: 64,
  scale: 8,
  palette: {
    dark: "#0a1e3d",
    mid: "#1a4a8a",
    light: "#7ab8ff",
    white: "#ffffff",
  },
  symmetry: "diagonal",
  template: "base_shapes/orb_staff_circle.png",
  body: [
    { range: [0, 6], fill: { type: "gradient", colors: ["dark", "mid"] } },
    { range: [7, 27], fill: { type: "gradient", colors: ["dark", "mid", "light"] } },
    { range: [28, 34], fill: { type: "gradient", colors: ["mid", "light"] } },
    { range: [35, 40], fill: { type: "solid", color: "light" } },
    { range: [41, 60], fill: { type: "gradient", colors: ["white", "light", "mid", "dark"] } },
  ],
}).render().savePNG("output.png");
```

## Project Structure

```
pixel-art/
├── lib/                    # Modular core engine
│   ├── index.js            # Entry point
│   ├── engine.js           # PixelEngine class
│   ├── color.js            # Color utilities
│   ├── png.js              # PNG encode/decode
│   ├── image.js            # Image loading
│   ├── symmetry.js         # Symmetry strategies
│   └── fills.js            # Fill strategies
├── base_shapes/            # Pre-made weapon contour templates (PNG)
├── tools/
│   └── add_template.js     # External image to template converter
├── cache/                  # Auto-generated scripts (auto-cleaned after 7 days)
├── pixel_engine.js         # Backward-compatible re-export bridge
├── SKILL.md                # OpenCode skill definition
└── AGENTS.md               # Agent behavior constraints
```

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `size` | number | 128 | Canvas size (32/64/128) |
| `scale` | number | 8 | Output pixel size multiplier |
| `palette` | object | `{}` | Color names → hex values |
| `symmetry` | string | "diagonal" | "diagonal" / "vertical" / "horizontal" |
| `body` | Segment[] | `[]` | Symmetric colored segments |
| `decorations` | Decoration[] | `[]` | Asymmetric decorative elements |
| `template` | string | null | Path to base shape PNG |
| `center` | number | auto | Symmetry axis position |
| `postProcess` | object | null | Auto-shade / outline / quantize |

## Coordinate System

Origin is at the **bottom-left** `(0, 0)`. X-axis points right, Y-axis points up. PNG output flips Y automatically.

## Templates

Templates are pre-drawn weapon silhouettes in `base_shapes/`. Template mode separates geometry from coloring:

1. Select a template (e.g., `"base_shapes/broadsword.png"`)
2. Define body segments with colors only (no `width` parameter)
3. The engine fills template pixels with your colors

Create new templates using classic mode with black fill, then reference them in any generation script.

## Examples

Generated examples (PNG) are available in the project root:

- `colorful_staff.png`
- `cruciform_lava_sword.png`
- `fire_bone_staff.png`
- `fire_ice_orb_staff.png`
- `fire_ice_staff.png`
- `ice_storm_staff.png`
- `lava_broadsword.png`
- `nightglow_64.png`
- `thunder_staff.png`
- `vortex_staff.png`

## License

MIT
