# AGENTS.md — Pixel Art Generator

## 项目概述

本项目的核心目标是根据自然语言描述，**自动生成像素画**，输出格式为 **PNG**。  
使用声明式配置驱动 `pixel_engine.js` 核心引擎，无需手动逐像素编码。

### 核心工作流：模板化二次着色

```
base_shapes/ (轮廓模板 PNG)  →  body segments (颜色填充)  →  最终作品 PNG
        ↑                              ↑
  武器几何形状                   声明式颜色描述
  (复用通用轮廓)                  (gradient/solid)
```

**模板模式**将几何与颜色解耦：
- `base_shapes/*.png` 定义武器的**几何轮廓**（预先创建的像素画，仅含形状）
- `body` segments 只定义**颜色填充**（无 width 参数）
- 引擎加载模板 PNG，提取像素位置，按 body segment 的 range 匹配并着色

---

## 1. 坐标系标准

所有像素坐标和尺寸描述**必须**遵循以下约定：

```
   y
   ↑
   5  ·  ·  ·  ·  ·
   4  ·  ·  ·  ·  ·
   3  ·  ·  ·  ·  ·
   2  ·  ·  ·  ·  ·
   1  ·  ·  ·  ·  ·
   0  ·  ·  ·  ·  ·
      0  1  2  3  4  5 → x
```

| 属性 | 值 |
|---|---|
| **原点** | 左下方 `(0, 0)` |
| **X 轴正方向** | 向右 |
| **Y 轴正方向** | 向上 |
| **像素位置** | 像素中心或左上角均可，需在代码中保持一致 |

> 注意：这与常见计算机图形学中「原点在左上角」的惯例不同。所有从自然语言到坐标的转换，**必须先做此坐标映射**。

### 语义映射表

| 自然语言 | 坐标系含义 |
|---|---|
| "在左上角" | x 靠近 0，y 靠近最大值（如 (0, 63)） |
| "在右下角" | x 靠近最大值，y 靠近 0（如 (63, 0)） |
| "在上面" | y 值大 |
| "在下面" | y 值小 |
| "在左边" | x 值小 |
| "在右边" | x 值大 |
| "向上移动" | y 增加 |
| "向下移动" | y 减少 |
| "宽度" | x 方向尺寸 |
| "高度" | y 方向尺寸 |

---

## 2. 像素画规格

| 参数 | 值 |
|---|---|
| **画布尺寸** | 32×32、64×64 或 128×128（按需选择） |
| **输出格式** | PNG（位图） |
| **像素风格** | 每个像素用一个色块表示，无抗锯齿、无渐变 |
| **背景** | **默认透明**（PNG 使用 RGBA 色彩模式，未绘制区域 alpha = 0） |
| **调色板** | 限制颜色数量（建议 ≤16 色），优先使用像素风格常见调色板 |

### 模板示例（推荐）

```javascript
const { PixelEngine } = require("./lib");

const config = {
  size: 64,                     // 与模板匹配或按比例缩放的尺寸
  scale: 8,                     // 输出放大倍数
  palette: { /* 语义色板 */ },
  symmetry: "diagonal",
  template: "base_shapes/broadsword.png",  // ← 模板轮廓
  body: [
    // 只定义颜色，无 width——几何来自模板
    { range: [6, 8],   fill: { type: "gradient", colors: ["#gold_dark", "#gold_main", "#gold_light"] } },
    { range: [8, 20],  fill: { type: "gradient", colors: ["#wood_dark", "#wood_main", "#wood_light"] } },
    { range: [20, 24], fill: { type: "gradient", colors: ["#guard_dark", "#guard_main", "#guard_light"] } },
    { range: [24, 48], fill: { type: "gradient", colors: ["#blade_dark", "#blade_main", "#blade_light"] } },
  ],
  decorations: [ /* 非对称装饰（藤蔓、叶片、粒子等）*/ ],
};

new PixelEngine(config).render().savePNG("output.png");
```

### 经典模式（向后兼容，不推荐新作品使用）

```javascript
const config = {
  size: 64,
  scale: 8,
  palette: { /* 语义色板 */ },
  symmetry: "diagonal",
  body: [
    // 定义几何（width） + 颜色（fill）
    { range: [6, 8], width: 2, fill: { type: "gradient", colors: [...] } },
  ],
};
```

---

## 3. 模板系统

### 3.1 base_shapes/ 目录说明

`base_shapes/` 存放预先生成的武器轮廓 PNG，作为**模板库**。

| 模板文件 | 说明 | 尺寸 |
|---|---|---|
| `broadsword.png` | 阔剑 | 64×64 @8× |
| `short_sword.png` | 短剑 | 64×64 @8× |
| `staff.png` | 法杖 | 64×64 @8× |
| `throwing_knife.png` | 飞刀 | 64×64 @8× |

所有模板满足：
- 黑色填充（R=0, G=0, B=0, A=255），透明背景
- 对角线对称（diagonal symmetry）
- 使用三段宽度原则设计
- 为后期着色优化：内部无空洞，轮廓清晰

### 3.2 模板工作流程

```
1. 选择模板  →  2. 定义 body segments  →  3. 添加装饰  →  4. 输出
                   │                        │
              range + fill               decorations
              (无 width！)               (无对称约束)
```

**关键约束：**
- **body 中不得包含 width** — 几何来自模板，width 被忽略
- **body 的 range 必须覆盖模板所有 t 值** — 未覆盖的区域保持透明
- **template 和 size 必须匹配** — 引擎会自动缩放（支持 32/64/128 互通）

### 3.3 创建新模板

暂时通过经典模式生成后提取 PNG：

```javascript
// 1. 先用经典模式生成轮廓
const cfg = {
  size: 64, scale: 8, palette: { c: "#000000" }, symmetry: "diagonal",
  body: [ /* 定义 width + fill: "#000000" */ ],
};
new PixelEngine(cfg).render().savePNG("base_shapes/new_weapon.png");
// 2. 其他脚本即可引用 template: "base_shapes/new_weapon.png"
```

> 未来版本将支持纯黑白轮廓模板的自动生成。

---

## 4. 对称性描述规范

在自然语言描述物品时，大量使用对称性来简化表达。以下是标准术语映射：

### 4.1 对称轴命名

| 术语 | 数学含义 | 视觉效果 |
|---|---|---|
| **沿 x 轴对称** / **上下对称** | 以 y = 常数为中心线翻转 | 上方和下方镜像 |
| **沿 y 轴对称** / **左右对称** | 以 x = 常数为中心线翻转 | 左方和右方镜像 |
| **沿 y = x 对称** / **斜对称** | 以对角线为轴翻转 | 左上↔右下镜像 |
| **中心对称** / **点对称** | 绕中心点旋转 180° | 每个点关于中心对称 |

### 4.2 坐标变换函数

```python
def reflect_x(x, y, center_y):
    """沿 x 轴（水平轴）翻转：上下对称"""
    return (x, 2 * center_y - y)

def reflect_y(x, y, center_x):
    """沿 y 轴（垂直轴）翻转：左右对称"""
    return (2 * center_x - x, y)

def reflect_yx(x, y):
    """沿 y = x 翻转：斜对称"""
    return (y, x)

def rotate_180(x, y, center):
    """中心对称：旋转 180°"""
    cx, cy = center
    return (2 * cx - x, 2 * cy - y)
```

### 4.3 典型对称场景

| 物品 | 典型对称类型 | 说明 |
|---|---|---|
| 人物/角色正面 | 左右对称 (y 轴) | 左右镜像，中间是脊柱 |
| 人物侧脸 | 无对称 | 仅描述一侧 |
| 树木 | 上下对称 (x 轴) | 树冠和倒影 |
| 蝴蝶 | 左右对称 (y 轴) | 翅膀左右镜像 |
| 菱形/星形 | 四重对称 | 同时沿 x、y、y=x 对称 |
| 宝可梦风格精灵 | 左右对称 (y 轴) | 面向前方时 |
| 建筑/城堡 | 左右对称 (y 轴) | 塔楼对称排列 |
| 表情符号 | 左右对称 (y 轴) | 眼睛、眉毛对称 |

---

## 5. 从自然语言到像素的转换流程

当接收到一个物品描述时，按以下流程处理：

```
输入描述
  │
  ▼
Step 1: 确定画布尺寸 (32×32 / 64×64 / 128×128)
  │
  ▼
Step 2: 判断使用哪种模式
  │  ├─ 有匹配的 base_shapes 模板 → 模板模式
  │  └─ 无模板或需要全新形状 → 经典模式（定义 width）
  │
  ▼
Step 3: 确定对称类型和主体位置
  │
  ▼
Step 4: 模板模式：body 只定义颜色，遍历模板像素着色
  │  经典模式：body 定义 width + fill，从轴向外绘制
  │
  ▼
Step 5: 添加非对称装饰（藤蔓、叶片、粒子、矩形等）
  │
  ▼
Step 6: 生成 PNG 输出
```

---

## 6. 武器设计的三段宽度原则

对于具有对称轴的武器（法杖、剑等），模板设计中通常由以下三段构成：

### 6.1 法杖三段

| 段 | 宽度原则 | 说明 |
|---|---|---|
| **握柄** | **细** | 手持部分，hw 相对最小 |
| **连接件** | 介于握柄和法球之间 | 过渡段，hw 可粗可细 |
| **法球** | **宽** | 法杖顶端（水晶/宝石/装饰），hw 应显著大于握柄 |

### 6.2 剑的三段

| 段 | 宽度原则 | 说明 |
|---|---|---|
| **剑柄** | **细** | 手持部分，hw 相对最小 |
| **剑颚**（中间件） | **宽于剑柄** | 连接剑柄与剑身的过渡段 |
| **剑身** | **宽** | 剑刃部分，hw 应大于或等于剑颚 |

### 6.3 核心约束

1. **剑颚宽度 > 剑柄宽度** — 硬性要求
2. **法球/剑身宽度 > 握柄/剑柄宽度** — 末端部分应比手持部分宽
3. 三段的比例可以根据武器类型调整，但相对关系必须保持

---

## 7. 编程规范

### 7.1 项目结构

```
pixel-art/
├── AGENTS.md               # 本文件（智能体行为约束）
├── SKILL.md                # OpenCode Skill 定义（安装/使用说明）
├── package.json            # npm 包元数据
├── pixel_engine.js          # 向后兼容的 re-export 桥接（≡ require("./lib")）
├── lib/                    # 模块化核心引擎
│   ├── index.js            # 入口：re-export PixelEngine, FILLS, SYMMETRY
│   ├── color.js            # 颜色工具函数（hexToRgb, H, mixColor 等）
│   ├── png.js              # PNG 编码/解码、逻辑尺寸检测
│   ├── image.js            # 图片加载（PNG native, WebP via PIL）
│   ├── symmetry.js         # 对称策略（diagonal, vertical, horizontal）
│   ├── fills.js            # 填充策略（solid, gradient, linear, dual）
│   └── engine.js           # PixelEngine 主类
├── base_shapes/             # 预置武器轮廓模板（PNG）
│   ├── broadsword.png
│   ├── short_sword.png
│   ├── staff.png
│   ├── orb_staff_circle.png
│   ├── throwing_knife.png
│   └── ...
├── cache/                  # 生成脚本缓存（自动清理，gitignored）
│   ├── .gitkeep
│   ├── gen_20260506_vortex_staff.js
│   └── ...
├── tools/                  # 辅助工具
│   └── add_template.js     # 外部图片 → PNG 模板转换工具
├── generate_*.js            # 模板生成工具（保留在根目录）
└── *.png                    # 生成的作品输出
```

### 7.2 代码原则

1. **纯函数优先**：给定相同描述和尺寸，每次应生成相同图像
2. **对称性抽象**：将对称操作抽象为独立函数，不要硬编码镜像像素
3. **颜色命名**：使用十六进制颜色码 `#RRGGBB`，配合语义变量名
4. **尺寸参数化**：32、64 和 128 应通过参数切换
5. **配置驱动渲染**：声明式配置（body segments + decorations），由引擎渲染
6. **模板优先**：新武器先检查 `base_shapes/` 是否有匹配模板，有则用模板模式

### 7.3 颜色调色板参考

```python
# 像素画常用调色板（PICO-8 风格）
PALETTE = {
    "black":     "#000000",
    "dark_blue": "#1D2B53",
    "dark_purp": "#7E2553",
    "dark_green": "#008751",
    "brown":     "#AB5236",
    "dark_gray": "#5F574F",
    "light_gray": "#C2C3C7",
    "white":     "#FFF1E8",
    "red":       "#FF004D",
    "orange":    "#FFA300",
    "yellow":    "#FFEC27",
    "green":     "#00E436",
    "blue":      "#29ADFF",
    "indigo":    "#83769C",
    "pink":      "#FF77A8",
    "peach":     "#FFCCAA",
}
```

---

## 7.4 缓存工作流

所有一次性生成脚本写入 `cache/` 目录，不放在项目根目录。

- **命名格式**: `cache/gen_YYYYMMDD_description.js`
- **清理规则**: 写入新缓存前，自动删除 7 天前的旧条目
- **引用路径**: `cache/` 中的脚本用 `require("../pixel_engine")` 或 `require("../lib")`
- **输出位置**: 生成的 PNG 仍保存在项目根目录
- **例外**: 模板生成工具（如 `generate_orb_staff_template.js`）保留在根目录

---

## 8. 智能体行为约束

1. **先判断模板可用性**：匹配武器类型和对称类型，优先使用模板
2. **坐标一致性**：所有中间计算使用左下角坐标系，仅在输出时翻转 Y 轴
3. **避免硬编码**：不要逐像素枚举，使用声明式配置
4. **尺寸自适应**：优先写一次适配 32×32 和 64×64 的通用逻辑
5. **背景透明**：PNG 使用 RGBA 模式，初始化全透明，仅绘制内容的像素设置 alpha = 255
6. **使用引擎**：使用 `pixel_engine.js` 的配置驱动 API
7. **配置优先**：尽量用声明式配置描述几何、颜色、纹理
8. **三段宽度约束**：武器设计必须遵循三段宽度原则（见第 6 节）
9. **body 无 width**：模板模式下 body 不得包含 width 参数
