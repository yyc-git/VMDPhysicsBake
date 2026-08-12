# VMDPhysicsBake

将 **PMX 模型 + 动作 VMD** 离线烘焙为 **逐帧物理骨 VMD**：用 Ammo.js（Bullet）完整模拟骨骼物理，把裙摆 / 头发 / 胸部等物理骨的每帧姿态写入 VMD，MMD 中播放时即可复现烘焙时的物理效果，无需依赖 MMD 内置物理引擎。

> 背景：MMD 的实时物理依赖观看端物理引擎，不同播放器物理效果不一致。本工具在烘焙阶段就把物理结果「烤」进 VMD —— 产物在任何 MMD 播放器中都是同一份物理动画。

## ✨ 特性

- **离线烘焙**：PMX + 动作 VMD → 物理骨逐帧 VMD（Ammo.js / Bullet 数值模拟，离线可复现）
- **动作骨原样保留**：非物理骨关键帧（position/rotation/interpolation）逐帧不变
- **morph 原样复制**：表情帧与权重逐条保留
- **确定性输出**：同一输入两次烘焙字节一致（V6 断言）
- **多档物理参数**：`src/tool/bake-config*.json` 可调 spring 刚度 / solver 迭代 / 阻尼 / 平衡点 / zone rules
- **内置验证**：V1-V6 断言 + verify-report.json
- **零游戏项目依赖**：纯 Node + npm 依赖（three / ammojs-typed / pako）
- **MIT 协议**：完全开源，可自由商用

## 🚀 快速开始

### 安装

```bash
git clone git@github.com:yyc-git/VMDPhysicsBake.git
cd VMDPhysicsBake
yarn install
```

> 环境要求：Node.js 18.19+，使用 yarn（推荐）或 npm。

### 烘焙 + 验证

```bash
yarn bake        # 产出 output/pickup_bake.vmd（demo/assets 的 HMS 模型 + pickup.vmd）
yarn verify      # V1-V6 断言 + output/verify-report.json（含 MMM 粗对比，仅参考不判 FAIL）
yarn test:bdd    # jest-cucumber BDD 全绿
npx tsc --noEmit # 类型检查
```

### 核心 CLI

```bash
# 指定配置文件（bake-config*.json，路径相对 src/tool/）
node src/tool/bake-physics.mjs --config bake-config.json

# CLI 覆盖输入输出
node src/tool/bake-physics.mjs --pmx demo/assets/xxx.pmx --vmd demo/assets/anim.vmd --output output/anim_bake.vmd

# 自检模式（不落盘，纯内存校验）
node src/tool/bake-physics.mjs --self-check

# 物理部件统计
node src/tool/count-physics.mjs "demo/assets/Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx"
```

配置文件相对路径以 `src/tool/` 为基准解析：

| 字段 | 说明 | 默认示例 |
|------|------|----------|
| `pmx` | PMX 模型 | `../../demo/assets/Tda HMS ... [Silver].pmx` |
| `vmdRaw` | 原始动作 VMD | `../../demo/assets/pickup.vmd` |
| `output` | 烘焙产物 VMD | `../../output/pickup_bake.vmd` |
| `ammoSource` | `npm`（默认）\| `game`（仓库内 lib/ammo 的 wasm 版） | `npm` |
| `useLoader` | `true` 时走 **MMDLoader.load2 链路**（与 demo 页面完全同构建同驱动，产物逐字节一致）；`false`/缺省走手动构建模拟 | `false` |
| `helperDriver` | 是否用 MMDAnimationHelper 完整驱动 | `false` |
| `physicsParams` | spring/solver/阻尼/平衡点等物理参数 | 见 bake-config.json |
| `zoneRules` | 分区调参（胸部 / 裙子碰撞 mask 等） | 见 bake-config.json |

## 🔬 核心 API

编译入口：`src/index.ts`（`npm run build` 输出到 `dist/`，`main`/`types` 指向 dist）。

```ts
import { bakePhysics, verifyBake, countPhysics } from 'vmd-physics-bake';

// 烘焙：等价于 `node src/tool/bake-physics.mjs --config bake-config.json`
const result = bakePhysics();
// result.outputPath / result.bytes / result.stdout

// 验证：等价于 `node src/tool/verify-bake.mjs`，读取 output/verify-report.json
const report = verifyBake();
// report.allPass / report.assertions / report.compareWithMmm

// 统计 PMX 物理部件
const count = countPhysics('path/to/model.pmx');
// count.rigidBodies / count.joints / count.rigidBodyType
```

> 完整能力（物理参数微调、zone rules、initpose、helperDriver 等）以 CLI + `bake-config*.json` 为主接口；编程接口为 CLI 转发。

## 🖥️ 运行 Demo（可视化烘焙）

Demo 是浏览器里的可视化烘焙页：加载 PMX 模型 + VMD 动画，用页面内 Ammo.js 实时跑物理，逐帧记录物理骨采样，自动转成最终 VMD。

> **两种烘焙方式**（同一 PMX+VMD，产物逐字节一致）
>
> | 方式 | 命令 | 特点 |
> |------|------|------|
> | **页面烘焙** | `node src/tool/bake-view-oneclick.cjs`（或手动浏览器） | 浏览器内实时模拟，可视化观察物理效果 |
> | **命令行烘焙** | `yarn bake`（bake-config.json 默认 `useLoader: true`） | 纯命令行，MMDLoader.load2 同构建同驱动同抽帧，适合脚本化 / CI |
>
> 两种方式产物完全一致（V6 实测 bytes identical）。

### 方式 A：一键全自动（推荐）

```bash
node src/tool/bake-view-oneclick.cjs
# 可选参数：--vmds pickup --speed 10 --warmup 60 --out output --char hms --pmx <仓库内相对路径>
```

链路：启动静态 server（8123）→ headless Chromium 打开页面 → 逐动画播放（**最高档物理 interval=1/solver=10 + warmup=60 + speed=K 加速**）→ 每帧记录物理骨 → **server 自动转 VMD** 到 `--out` 目录。

### 方式 B：手动浏览器验证

```bash
node scripts/view-bake-server.cjs   # 静态 server，端口 8123（含 /api/save-bone-log + 自动转 VMD）
```

浏览器打开（**默认即最高档物理**；URL 参数可覆盖）：

```
http://localhost:8123/demo/index.html
```

URL 参数：

| 参数 | 默认 | 说明 |
|------|------|------|
| `fixed` | 0（rAF） | 固定步长 fps（如 60）；0 = 跟随浏览器 rAF |
| `interval` | 1 | 物理更新间隔（1 = 每渲染帧更新，最高档） |
| `solver` | 10 | solver 迭代次数（最高档） |
| `warmup` | 60 | 物理预热帧数（头发预下落；0 = frame0 绑定姿态） |
| `speed` | 1 | 加速倍数（fixed 模式下墙钟快 K 倍，物理结果逐位一致） |
| `vmds` | pickup | 多动画逗号分隔，按顺序逐动画烘焙 |
| `useLoader` | true | `true` 时命令行烘焙走 MMDLoader.load2 链路（与页面一致） |
| `char` | hms | 导出文件名人物标签 |
| `pmx` | HMS | 模型路径（demo/assets 相对路径） |

页面 HUD 会显示当前物理档位与产物说明。**播放完自动导出**：

```
✅ 已导出 VMD: output/hms_pickup_view.vmd（采样 N 条）
```

### 输出链路

```
demo 页面 → 播放完自动导出 → output/<char>_<anim>_view.vmd（最终产物）
```

页面烘焙在播放结束后自动产出最终 VMD；中间采样 JSON（`output/view-bake-bone-log-*.json`）仅调试用，可忽略。命令行烘焙（`yarn bake`）不经浏览器，直接产出 `output/pickup_bake.vmd`。

如需用已有采样 JSON 重跑转换（跳过浏览器烘焙）：

```bash
node src/tool/bake-from-view.cjs output/view-bake-bone-log-*.json output/anim_bake.vmd
```

## 📁 目录结构

```
VMDPhysicsBake/
├── src/
│   ├── index.ts                    # 库入口（bakePhysics / verifyBake / countPhysics）
│   └── tool/                       # 核心 CLI 工具（node 直接运行）
│       ├── bake-physics.mjs        #   主烘焙脚本（Ammo.js / Bullet 模拟 → VMD）
│       ├── bake-physics-initpose.mjs / bake-physics-freq60.mjs   # 实验档
│       ├── bake-game.mjs / bake-from-game-value.cjs              #   实验档（旧运行时抓取链路）
│       ├── verify-bake.mjs         #   V1-V6 验证 + verify-report.json
│       ├── vmd-writer.mjs          #   VMD 写出（SJIS 编码）
│       ├── count-physics.mjs       #   物理部件统计
│       ├── bake-from-view.cjs      #   可视化抓取 JSON → VMD（能量法主段 + 抽稀 + 补帧）
│       ├── bake-view-oneclick.cjs  #   一键可视化烘焙（Playwright）
│       └── bake-config*.json       #   物理参数档
├── lib/                            # three MMD 扩展（MMDLoader / MMDPhysics / MMDAnimationHelper）+ ammo.wasm.js
├── demo/
│   ├── assets/                     # 示例资产：HMS PMX + pickup.vmd + 贴图（data/ + sph/）
│   └── index.html                  # 可视化烘焙页（webpack 入口 demo/main.ts）
├── scripts/
│   ├── view-bake-server.cjs        # 可视化烘焙静态 server（/api/save-bone-log 落盘）
│   └── view-bake-pako-wrapper.mjs
├── test/
│   ├── features/bake-physics.feature       # BDD 契约
│   ├── step-definitions/bake-physics.steps.ts
│   └── helpers/                            # bake-check / bake-assembly-check
├── docs/                           # 研究资料（留档）
└── package.json
```

## ✅ 测试

```bash
yarn test:bdd          # BDD（jest-cucumber）：163 物理骨 / 78 morph / 91 帧 / solver 50 等契约
npx tsc --noEmit       # 类型检查
```

## 📄 License

[MIT](./LICENSE) — 可自由使用、修改、商用，保留版权声明即可。

---

**来源**：本项目源自 GTS-Play 项目的 mmd_tool 包，独立开源为 MIT 仓库。欢迎提 [Issue](https://github.com/yyc-git/VMDPhysicsBake/issues)。

---

# VMDPhysicsBake (English)

Bake **per-frame physics bone VMD** from a **PMX model + action VMD**: the tool simulates the full skeleton physics with Ammo.js (Bullet) and writes each frame's pose of physics bones (skirts, hair, chest, ...) into the VMD. Playback in any MMD player then reproduces the baked physics — no dependency on the viewer's physics engine.

> Background: MMD's real-time physics depends on the viewer's physics engine, so the same model looks different in different players. This tool bakes the physics results into the VMD at baking time — the output is the same physics animation in every MMD player.

## ✨ Features

- **Offline baking**: PMX + action VMD → per-frame physics bone VMD (Ammo.js / Bullet, reproducible offline)
- **CLI = page, byte-identical**: the CLI uses the same MMDLoader.load2 pipeline as the demo page (same build, same driver, same sampling) — output is byte-identical between the two modes (V6: 1310324B, avg=0.000000)
- **Action bones preserved verbatim**: non-physics keyframes (position/rotation/interpolation) unchanged
- **Morphs copied as-is**: expression frames and weights preserved
- **Deterministic output**: two runs with the same input produce byte-identical files (V6 assertion)
- **Configurable physics**: multiple presets under `src/tool/bake-config*.json` (spring stiffness / solver iterations / damping / equilibrium / zone rules)
- **Built-in verification**: V1-V6 assertions + verify-report.json
- **Zero game-project dependency**: pure Node + npm deps (three / ammojs-typed / pako)
- **MIT licensed**

## 🚀 Quick Start

### Install

```bash
git clone git@github.com:yyc-git/VMDPhysicsBake.git
cd VMDPhysicsBake
yarn install
```

> Requirements: Node.js 18.19+, yarn (recommended) or npm.

### Bake + Verify

```bash
yarn bake        # → output/pickup_bake.vmd (bundled HMS model + pickup.vmd demo)
yarn verify      # V1-V6 assertions + output/verify-report.json (MMM comparison is informational only, does not fail)
yarn test:bdd    # jest-cucumber BDD
npx tsc --noEmit # type check
```

## 🔬 Core CLI

```bash
# Use a specific config file (bake-config*.json, paths relative to src/tool/)
node src/tool/bake-physics.mjs --config bake-config.json

# Override inputs/outputs via CLI
node src/tool/bake-physics.mjs --pmx demo/assets/xxx.pmx --vmd demo/assets/anim.vmd --output output/anim_bake.vmd

# Self-check mode (in-memory only, no file output)
node src/tool/bake-physics.mjs --self-check

# Count physics parts
node src/tool/count-physics.mjs "demo/assets/Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx"
```

Config file paths are resolved relative to `src/tool/`:

| Field | Description | Default example |
|-------|-------------|-----------------|
| `pmx` | PMX model | `../../demo/assets/Tda HMS ... [Silver].pmx` |
| `vmdRaw` | Raw action VMD | `../../demo/assets/pickup.vmd` |
| `output` | Baked VMD output | `../../output/pickup_bake.vmd` |
| `ammoSource` | `npm` (default) \| `game` (wasm build in lib/ammo) | `npm` |
| `useLoader` | `true` → MMDLoader.load2 pipeline (same build/driver as demo page, byte-identical output); `false`/absent → manual-build simulation | `false` |
| `helperDriver` | Whether to drive via MMDAnimationHelper | `false` |
| `physicsParams` | spring / solver / damping / equilibrium params | see bake-config.json |
| `zoneRules` | per-zone tuning (chest / skirt collision mask etc.) | see bake-config.json |

## 🔬 Core API

Compile entry: `src/index.ts` (`npm run build` → `dist/`, `main`/`types` point to dist).

```ts
import { bakePhysics, verifyBake, countPhysics } from 'vmd-physics-bake';

// Bake: equivalent to `node src/tool/bake-physics.mjs --config bake-config.json`
const result = bakePhysics();
// result.outputPath / result.bytes / result.stdout

// Verify: equivalent to `node src/tool/verify-bake.mjs`, reads output/verify-report.json
const report = verifyBake();
// report.allPass / report.assertions / report.compareWithMmm

// Count physics parts of a PMX
const count = countPhysics('path/to/model.pmx');
// count.rigidBodies / count.joints / count.rigidBodyType
```

> Full capabilities (physics param tuning, zone rules, initpose, helperDriver, ...) are exposed via CLI + `bake-config*.json`; the programmatic API forwards to the CLI.

## 🖥️ Demo (visual baking)

The demo is a browser-based visual baking page: load a PMX model + VMD animation, run physics in-page with Ammo.js in real time, record physics bone samples per frame, and auto-convert to the final VMD.

> **Two baking modes** (same PMX+VMD, byte-identical output)
>
> | Mode | Command | Notes |
> |------|---------|-------|
> | **Page baking** | `node src/tool/bake-view-oneclick.cjs` (or open the page manually) | real-time simulation in browser, visually inspect physics |
> | **CLI baking** | `yarn bake` (bake-config.json defaults to `useLoader: true`) | pure CLI, same build/driver/sampling via MMDLoader.load2, good for scripting / CI |
>
> Both modes produce identical output (V6: bytes identical).

### Mode A: one-click (recommended)

```bash
node src/tool/bake-view-oneclick.cjs
# optional: --vmds pickup --speed 10 --warmup 60 --out output --char hms --pmx <repo-relative path>
```

Pipeline: start static server (8123) → headless Chromium opens the page → plays each animation (**highest physics preset interval=1/solver=10 + warmup=60 + speed=K**) → records physics bones per frame → **server auto-converts to VMD** in the `--out` dir.

### Mode B: manual browser verification

```bash
node scripts/view-bake-server.cjs   # static server, port 8123 (incl. /api/save-bone-log + auto VMD conversion)
```

Open in browser (**highest physics preset by default**; URL params can override):

```
http://localhost:8123/demo/index.html
```

URL params:

| Param | Default | Description |
|-------|---------|-------------|
| `fixed` | 0 (rAF) | fixed step fps (e.g. 60); 0 = follow browser rAF |
| `interval` | 1 | physics update interval (1 = every render frame, highest) |
| `solver` | 10 | solver iterations (highest) |
| `warmup` | 60 | physics warmup frames (hair pre-fall; 0 = frame0 bind pose) |
| `speed` | 1 | speed multiplier (wall-clock K× faster under fixed mode, physics result bit-identical) |
| `vmds` | pickup | comma-separated animations, baked sequentially |
| `useLoader` | true | `true` → CLI baking uses MMDLoader.load2 pipeline (same as page) |
| `char` | hms | character tag for output filename |
| `pmx` | HMS | model path (relative to demo/assets) |

The page HUD shows the current physics preset and output info. **Auto-exports when playback finishes**:

```
✅ Exported VMD: output/hms_pickup_view.vmd (N samples)
```

### Output pipeline

```
demo page → auto-export on finish → output/<char>_<anim>_view.vmd (final output)
```

Page baking produces the final VMD automatically after playback; the intermediate sample JSON (`output/view-bake-bone-log-*.json`) is for debugging only. CLI baking (`yarn bake`) skips the browser and produces `output/pickup_bake.vmd` directly.

To re-convert from an existing sample JSON (skip browser baking):

```bash
node src/tool/bake-from-view.cjs output/view-bake-bone-log-*.json output/anim_bake.vmd
```

## 📁 Directory Structure

```
VMDPhysicsBake/
├── src/
│   ├── index.ts                    # library entry (bakePhysics / verifyBake / countPhysics)
│   └── tool/                       # core CLI tools (run directly with node)
│       ├── bake-physics.mjs        #   main baking script (Ammo.js / Bullet simulation → VMD)
│       ├── bake-physics-initpose.mjs / bake-physics-freq60.mjs   # experimental presets
│       ├── bake-game.mjs / bake-from-game-value.cjs              # experimental (legacy runtime capture)
│       ├── verify-bake.mjs         #   V1-V6 verification + verify-report.json
│       ├── vmd-writer.mjs          #   VMD writer (SJIS encoding)
│       ├── count-physics.mjs       #   physics part statistics
│       ├── bake-from-view.cjs      #   visual capture JSON → VMD (energy-based main segment + decimation + frame fill)
│       ├── bake-view-oneclick.cjs  #   one-click visual baking (Playwright)
│       └── bake-config*.json       #   physics parameter presets
├── lib/                            # three MMD extensions (MMDLoader / MMDPhysics / MMDAnimationHelper) + ammo.wasm.js
├── demo/
│   ├── assets/                     # demo assets: HMS PMX + pickup.vmd + textures (data/ + sph/)
│   └── index.html                  # visual baking page (webpack entry demo/main.ts)
├── scripts/
│   ├── view-bake-server.cjs        # visual baking static server (/api/save-bone-log persistence)
│   └── view-bake-pako-wrapper.mjs
├── test/
│   ├── features/bake-physics.feature       # BDD contract
│   ├── step-definitions/bake-physics.steps.ts
│   └── helpers/                            # bake-check / bake-assembly-check
├── docs/                           # research docs (archive)
└── package.json
```

## ✅ Testing

```bash
yarn test:bdd          # BDD (jest-cucumber): 163 physics bones / 78 morphs / 91 frames / solver 50 etc.
npx tsc --noEmit       # type check
```

## 📄 License

[MIT](./LICENSE) — free to use, modify, and use commercially, provided the copyright notice is retained.

---

**Source**: derived from the mmd_tool package of the GTS-Play project, released standalone under MIT. Issues welcome at [GitHub Issues](https://github.com/yyc-git/VMDPhysicsBake/issues).
