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
| `helperDriver` | 是否用 MMDAnimationHelper 完整驱动（复刻游戏链路） | `false` |
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

## 🖥️ 运行 Demo（Session 2 建设中）

```bash
yarn webpack:dev-server   # 可视化烘焙验证页（demo/）
```

## 📁 目录结构

```
VMDPhysicsBake/
├── src/
│   ├── index.ts                    # 库入口（bakePhysics / verifyBake / countPhysics）
│   └── tool/                       # 核心 CLI 工具（node 直接运行，零游戏依赖）
│       ├── bake-physics.mjs        #   主烘焙脚本（Ammo.js / Bullet 模拟 → VMD）
│       ├── bake-physics-initpose.mjs / bake-physics-freq60.mjs   # 实验档
│       ├── bake-game.mjs           #   复刻游戏运行时链路的烘焙
│       ├── verify-bake.mjs         #   V1-V6 验证 + verify-report.json
│       ├── vmd-writer.mjs          #   VMD 写出（SJIS 编码）
│       ├── count-physics.mjs       #   物理部件统计
│       ├── bake-from-view.cjs / bake-from-game-*.cjs   # 抓取数据 → VMD
│       ├── bake-view-oneclick.cjs  #   一键可视化烘焙（Playwright）
│       └── bake-config*.json       #   物理参数档
├── lib/                            # three MMD 扩展（MMDLoader / MMDPhysics / MMDAnimationHelper）+ ammo.wasm.js
├── demo/
│   ├── assets/                     # 示例资产：HMS PMX + pickup.vmd
│   └── view-bake.orig.html         # 可视化页蓝本（Session 2 改造）
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

## ✨ Features

- **Offline baking**: PMX + action VMD → per-frame physics bone VMD (Ammo.js / Bullet, reproducible offline)
- **Action bones preserved verbatim**: non-physics keyframes (position/rotation/interpolation) unchanged
- **Morphs copied as-is**: expression frames and weights preserved
- **Deterministic output**: two runs with the same input produce byte-identical files (V6 assertion)
- **Configurable physics**: multiple presets under `src/tool/bake-config*.json` (spring stiffness / solver iterations / damping / equilibrium / zone rules)
- **Built-in verification**: V1-V6 assertions + verify-report.json
- **Zero game-project dependency**: pure Node + npm deps (three / ammojs-typed / pako)
- **MIT licensed**

## 🚀 Quick Start

```bash
git clone git@github.com:yyc-git/VMDPhysicsBake.git
cd VMDPhysicsBake
yarn install
yarn bake        # → output/pickup_bake.vmd
yarn verify      # V1-V6 assertions + output/verify-report.json
yarn test:bdd    # jest-cucumber BDD
npx tsc --noEmit # type check
```

## 📄 License

[MIT](./LICENSE) — free to use, modify, and use commercially, provided the copyright notice is retained.

---

**Source**: derived from the mmd_tool package of the GTS-Play project, released standalone under MIT. Issues welcome at [GitHub Issues](https://github.com/yyc-git/VMDPhysicsBake/issues).
