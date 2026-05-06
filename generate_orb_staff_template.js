/**
 * generate_orb_staff_template.js
 * 
 * 用经典模式（含 width）生成斜对角对称的圆形法球法杖模板。
 * 核心：法球部分用 hw(t) = -(t-c) + sqrt(R² - (t-c)²) 产生精确圆形边界。
 * 
 * 在斜对称下，经典模式对每个 t 在 (t+dx, t) 绘制种子像素，
 * 再镜像到 (t, t+dx)。填充区域等价于：|x-y| ≤ hw(min(x,y))。
 * 
 * 代入圆形 hw 函数后，该条件等价于 (x-c)² + (y-c)² ≤ R²，即正圆。
 * 这就是为什么斜对称也能做出圆形法球——关键在于 hw(t) 不是线性的。
 */
const { PixelEngine } = require("./pixel_engine");

const P = { black: "#000000" };

// ─── 圆形法球参数 ───
const ORB_CENTER = 50;   // 圆心在斜对角轴上的位置 t=c
const ORB_RADIUS = 13;   // 法球半径
// 圆心 t=50, R=13 → 斜轴上范围: [50-13/√2, 50+13/√2] ≈ [40.8, 59.2]
// 最大种子 x = 50 + 13 = 63，刚好在 64×64 画布内

/**
 * 圆形半宽函数：
 *   hw(t) = -(t-c) + sqrt(R² - (t-c)²)
 * 
 * 对于圆心 (c, c) 半径 R：
 *   - t 的有效范围是 [c - R/√2, c + R/√2]
 *   - 在 t=c 时 hw=R（最宽处）
 *   - 在 t=c±R/√2 时 hw=0（球的两端）
 *   - 范围外的 t 返回 -1（跳过绘制）
 */
function orbWidth(t) {
  const u = t - ORB_CENTER;
  const R = ORB_RADIUS;
  const maxU = R / Math.SQRT2; // ≈ 9.19
  if (Math.abs(u) > maxU) return -1;
  const hw = -u + Math.sqrt(R * R - u * u);
  // 对于边界外的点，hw 可能为很小的负数，返回 -1 跳过
  return hw < 0 ? -1 : Math.round(hw);
}

new PixelEngine({
  size: 64,
  scale: 8,
  palette: P,
  symmetry: "diagonal",
  body: [
    // ═══ 1. 握柄 (t=0~6) — 细，手持部分 ═══
    { range: [0, 6], width: 2, fill: "black" },

    // ═══ 2. 杖身 (t=7~34) — 长而均匀 ═══
    { range: [7, 27], width: 2, fill: "black" },

    // ═══ 3. 杖身上段微收 (t=28~34) — 自然过渡 ═══
    { range: [28, 34], width: 2, fill: "black" },

    // ═══ 4. 连接件/护手 (t=35~40) — 从杖身渐变加宽到法球底部 ═══
    { range: [35, 40], width: { from: 2, to: 5 }, fill: "black" },

    // ═══ 5. 圆形法球 (t=41~60) — 正圆！ ═══
    { range: [41, 60], width: orbWidth, fill: "black" },
  ],
}).render().savePNG("base_shapes/orb_staff_circle.png");
