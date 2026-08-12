# VMD 物理烘焙 — 研究与可行性验证（2026-08-06）

> **关联 Issue**: `笔记/项目文档/issue/2026-08-06-VMD_Node_Ammo.js_PMX_491_847_V-88d2e9ef.md`
> **前置资料**: vmd-unify 方案（plan.md v2）+ vmd-generator（extension-plan.md + mmd-mpl-research.md）
> **状态**: 研究完成 + 双 spike 验证通过 → 进入方案阶段
> **兄弟需求**: 参考 vmd unify 和 vmd generator，为 VMD 加入物理烘焙。首期只做 Xiaye1 的 pickup.vmd，输出新文件（不与 MMM 烘焙版混淆）。

---

## 1. 需求背景

- 游戏侧**运行时物理已关闭**（`MMDUtils.ts` 的 `isEnablePhysics = () => false`；meta3d 版 `MMDLoader.js` 中 rigidBodies/constraints 构建被 `/*! edit by meta3d */` 注释，`geometry.userData.MMD.rigidBodies` 为空数组）
- 角色衣服/头发的物理效果**完全依赖 vmd_bake_physics/ 烘焙 VMD**（逐帧写入物理骨骼关键帧，播放时直接驱动骨骼）
- 兄弟目前的做法：拿 vmd_160 的 vmd 在 **MMM 软件**中手工烘焙，输出到角色目录 `vmd_bake_physics/`
- 目标：用我们自己的工具链（Node + Ammo.js + three，复用项目内 MMDPhysics/MMDLoader 组件）做**离线烘焙工具**，自动化替代 MMM 手工操作

## 2. 烘焙本质（对比原始/烘焙版 pickup.vmd 实测）

用 `diff-bake-vs-raw.mjs` 对比 `packages/frontend/src/resource_girl/city/vmd_160/pickup.vmd`（原始）vs
`mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd`（MMM 烘焙版）：

| 项 | 原始 | 烘焙版 |
|---|---|---|
| motions | 374（160 骨） | **14995（309 骨）** |
| 新增物理骨 | — | **186 个**：スカート×90+、前髪/右前髪/左前髪、胸上/胸下/胸上2、呆毛、垂?、十字架腰装、后腰装?A/B、吊?L/R、右前尾、左/右胸下 等 |
| 物理骨帧数 | — | 主物理骨 **91 帧逐帧**（0..90）；部分 1 帧（无动画的装饰骨） |
| 动作骨 position | グルーブ 5 帧（-3.64..1.57） | **与原始完全一致（maxPosDiff=0）** |
| morphs | 78 | 61（烘焙工具剔除无对应 morph） |

**结论**: 烘焙 = PMX 物理模拟（491 刚体 / 847 约束）结果**逐帧写入物理骨骼 rotation 关键帧**；动作骨（VMD 原有）原样保留，不被修改。

## 3. 技术可行性验证（双 spike 全过 ✅）

### Spike 1（`spike-physics-bake.mjs`）— 物理引擎可用性

- `ammojs-typed` 的 ammo.js 在 Node 中可加载（`await Ammo()`），物理世界创建成功
- MMDParser 完整解析 Xiaye1 PMX：**310 骨 / 491 刚体 / 847 约束**
- 用 MMDParser 数据手工构建 three Bone 层级 + SkinnedMesh + Skeleton
- `new MMDPhysics(mesh, rigidBodyParams, pmx.constraints)` 创建成功
- **30 步模拟后 156/163 物理骨骼产生非平凡旋转**（物理模拟正常工作）

### Spike 2（`spike2-physics-bake.mjs`）— 完整烘焙闭环

- iks/grants 从 PMX 构建（提取自 MMDLoader GeometryBuilder 逻辑）：**iks=5, grants=29**
- `new MMDLoader().animationBuilder.build(vmdRaw, mesh)` → AnimationClip（**246 tracks, 3s**）
- 自组装逐帧循环（Node ESM 无法解析 MMDAnimationHelper 的 bare import `three/examples/jsm/...`，改为手动组装）：
  ```
  mixer.update(1/30) → mesh.updateMatrixWorld → ikSolver.update() → grantSolver.update() → physics.update(1/30) → 记录物理骨骼
  ```
- warmup 60 帧后逐帧 0..90，**记录 163 个物理骨骼变换**（position + quaternion）
- 与 MMM 烘焙版粗对比：旋转有差异（12-86°），**属预期**——MMM(Bullet C++ 原生) 与 Ammo.js 的求解器/参数/前置帧不同，不追求数值一致

### 关键技术事实

| 项 | 事实 |
|---|---|
| Ammo.js | `node_modules/ammojs-typed/ammo/ammo.js`，Node 可加载（需 `globalThis.Ammo = await Ammo()`） |
| MMDPhysics | `packages/meta3d-jiehuo-abstract/src/three/MMDPhysics.js`，构造函数 `(mesh, rigidBodyParams, constraintParams, params)`，rigidBodyParams 直接来自 PMX（字段名一致），**PMX 刚体 position 需转骨骼局部偏移**（减去 bone.position） |
| AnimationBuilder | `new MMDLoader().animationBuilder`，`build(vmd, mesh)` 返回 AnimationClip（buildMorphAnimation 需 mesh.morphTargetDictionary，空对象即可跳过） |
| CCDIKSolver | `three/examples/jsm/animation/CCDIKSolver.js`，Node 可直接 import（带 .js 扩展名） |
| GrantSolver | MMDAnimationHelper 内部类（未 export），简易版实现只需 `slerp(parentQuat, ratio)` multiply |
| VMD 写出 | 复用 `vmd-generator/vmd-writer.mjs`（SJIS 编码 + 二进制写出） |

## 4. 方案方向

```
输入: vmd_160/pickup.vmd + Xiaye1 PMX
  → MMDParser 解析 PMX（bones/iks/grants/rigidBodies/constraints）
  → 构建 three Bone 层级 + SkinnedMesh + userData.MMD
  → AnimationBuilder.build(vmd) → AnimationClip
  → 自组装循环: mixer + IK + Grant + physics 逐帧模拟（warmup 60）
  → 记录物理骨骼（rigidBody type 1/2 绑定骨骼）逐帧 position/rotation
  → 合并原始 VMD 动作骨 + 物理骨关键帧
  → vmd-writer.mjs 写出新文件（如 pickup_bake.vmd）
```

- **零改游戏运行时**（产出文件直接可用，A/B 对比）
- 参考 vmd-generator 的目录结构：工具脚本 + verify 脚本 + 产出文件
- 物理参数（重力/阻尼/单位步长）与 MMM 对齐的尝试空间：`unitStep=1/65`、`gravity=(0,-98,0)`、warmup=60（游戏同款 helper 默认）

## 5. 风险与不做清单

**风险**：
- 与 MMM 烘焙版数值不一致（12-86°）→ 接受，验收标准是「效果接近、动作自然、无穿地」非逐帧一致
- Ammo.js 求解器与 Bullet 原生差异（约束 spring 参数单位等）→ 通过实机对比调参
- 491 刚体 × 90 帧 × 30fps 模拟耗时 → 预估秒级到十秒级，可接受（离线工具）
- IK/Grant 自组装顺序与游戏 helper 有差异 → 验收时重点检查足首踩地/胸部跟随

**不做清单**（本期）：
- 不改游戏源码（MMDData.ts / MMDLoader.js / MMDUtils.ts）
- 不碰 vmd_bake_physics/ 现有文件（输出新文件）
- 不做全部 56 个动画的批量烘焙（首期只 pickup）
- 不做 WebWorker/并行加速

## 6. 脚本索引

| 文件 | 用途 |
|---|---|
| `diff-bake-vs-raw.mjs` | 原始 vs 烘焙版 VMD 差异对比（骨骼集/帧数/position 一致性） |
| `spike-physics-bake.mjs` | Spike1: Node + Ammo + MMDPhysics 可行性 |
| `spike2-physics-bake.mjs` | Spike2: 完整闭环（clip → mixer/IK/Grant/physics → 记录） |
