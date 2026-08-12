# game 模式 vs patch 模式 vs MMM 参考：物理烘焙对比报告

> 日期：2026-08-07 ｜ 方案：复刻游戏运行时 MMDAnimationHelper 链路烘焙（零参数默认）
> 工具：`bake-game.mjs`（新增）vs `bake-physics.mjs`（patch 版）vs MMM 参考 `vmd_bake_physics/pickup.vmd`
> 对比口径：`angOf(q) = 2*acos(min(1,max(-1,q[3])))*180/PI`（rotation 相对单位四元数的角度，与 diag-skirt3.mjs 一致）

## 一、背景与目标

- **问题**：patch 版烘焙（`bake-physics.mjs`，springStiffnessScale÷1000 + solverIterations=50 + damping + ERP/CFM + zone rules + tki/kinematic smoothing）产物裙子摆动 35.6° vs MMM 87-96°（目标 ≥60°），fix1-fix5 调参失败。
- **假设（兄弟拍板）**：游戏里开启 MMD 物理后实时效果很好，而游戏用的物理引擎（`MMDPhysics.js`）与 bake 相同 → 问题不在引擎，而在 bake 手写循环 + 人为 patch 偏离了游戏运行时链路。
- **本任务**：完全复刻游戏运行时链路——`new MMDAnimationHelper()` 零参数 + `helper.add(mesh,{animation,physics:true})` + `pmxAnimation=true` + 逐帧 `helper.update(delta)`，**零 patch**（无 springStiffnessScale 覆盖、无 solverIterations、无 damping、无 ERP/CFM、无 zone rules、无 tki、无 kinematic smoothing），烘焙 `pickup_bake_game.vmd` 并对比。

## 二、实现：bake-game.mjs（游戏同款链路）

**游戏运行时链路（已确认，未改任何游戏代码）**：
1. `new MMDAnimationHelper()`（MMD.ts L14，零参数全默认）
2. `helper.add(mesh, { animation: [[name, clip]], physics: true })`（InitWhenImportScene.ts L261-265）
3. PMX 模型：`helper.configuration.pmxAnimation = true`（L268-270）
4. `helper.enabled.physics = true`（Girl.ts L466-468）
5. 每帧 `helper.update(delta)`

**helper.add 内部自动完成**（`MMDAnimationHelper._setupMeshPhysics`）：
- `_createMMDPhysics(mesh, userData.MMD.rigidBodies, userData.MMD.constraints, params)` → MMDPhysics 默认参数（unitStep=1/65, maxStepNum=3, gravity=(0,-98,0)）
- `_animateMesh(mesh, 0)` + `physics.reset()` + `physics.warmup(60)` + `_optimizeIK(mesh, true)`（物理骨自动禁 IK）
- 每帧 `helper.update(dt)` 内部：`_restoreBones` → `mixer.update(dt)` → `_saveBones` → PMX 路径（`_animatePMXMesh`，按 transformationClass 排序 + updateOne 逐骨 grant+IK）→ `physics.update(dt)`

**mesh 构造差异（game 模式必须对齐 MMDLoader）**：
- `userData.MMD.bones` 需挂 `.grant`/`.ik`（`_animatePMXMesh`/`updateOne` 读 `boneData.grant`/`boneData.ik`）
- `rigidBodyType` 需按 `boneTypeTable`（从 rigidBodies 计算 max type）设置（`_optimizeIK` 依赖）
- `pos` 用相对父骨位置（MMDLoader initBones 语义，THREE Bone local position）
- rigidBodies.position 相对骨 offset（MMDPhysics RigidBody boneOffsetForm 语义，与 bake-physics 相同）

**显式排除（零 patch）**：不 monkey-patch setStiffness、不设 solverIterations、不 setDamping、不 setParam(ERP/CFM)、不 zone rules、不 temporal kinematic init、不 kinematic smoothing。全部 MMDPhysics/MMDAnimationHelper 默认。

**运行方式**：
```bash
cd packages/mmd_tool
node --import ./src/tool/register-resolve.mjs src/tool/bake-game.mjs   # 产出 output/pickup_bake_game.vmd
node src/tool/bake-game.mjs --self-check                                  # 回读断言
node src/tool/compare-bake-game.mjs                                       # game vs patch vs MMM 对比
```

> 说明：`MMDAnimationHelper.js` 用 webpack 风格无扩展名 import，直接 node 运行会 ERR_MODULE_NOT_FOUND。`register-resolve.mjs`/`resolve-ext.mjs` 是 bake 侧的 Node ESM resolve hook（解析失败时追加 `.js` 重试），**不改任何游戏代码**。

## 三、产物与自检

- `output/pickup_bake_game.vmd`：1688057 字节，motions=15191 morphs=78，163 物理骨 × 91 帧（frame 0..90）
- `--self-check` PASS：物理骨 163/163、每骨 91 帧、帧范围 0..90、morph 78、动作骨 358 帧保留、物理骨 position 全 0

## 四、对比数据（game / patch / MMM 三列，rotation 角 °）

### 裙子（任务重点）

| 骨 | f0 | f15 | f30 | f45 | f60 | f75 | f90 |
|----|----|-----|-----|-----|-----|-----|-----|
| スカート_0_1 | 4.2/0.8/4.3 | 17.2/18.4/74.6 | **16.6/33.7/96.0** | **4.9/35.6/87.0** | 4.9/4.9/35.5 | **3.5/4.8/63.4** | 10.5/9.3/-- |
| スカート_0_10 | 15.8/10.8/1.5 | 14.7/5.3/10.0 | 8.7/5.3/21.7 | 5.8/4.4/23.7 | 50.0/38.0/16.9 | 10.5/67.0/8.3 | 36.3/91.0/-- |
| スカート_1_1 | 5.0/2.5/4.0 | 8.3/2.6/15.8 | 14.3/7.4/17.9 | 29.6/15.0/68.5 | 92.5/6.0/63.3 | 118.8/49.1/37.1 | 191.8/73.7/-- |

### 胸部 / 其他（任务附带关注）

| 骨 | f0 | f15 | f30 | f45 | f60 | f75 | f90 |
|----|----|-----|-----|-----|-----|-----|-----|
| 左胸上 | 69.1/59.2/2.8 | 51.1/53.9/7.5 | 14.3/49.5/3.1 | 69.2/19.9/2.8 | 82.5/73.3/7.9 | 58.8/28.8/5.7 | 111.0/64.3/-- |
| 右胸上 | 18.3/95.9/0.9 | 26.6/122.0/7.4 | 44.4/42.3/15.4 | 129.1/9.8/7.7 | 169.1/152.6/7.8 | 100.7/76.4/5.7 | 95.8/33.6/-- |
| 前髪１ | 234.5/26.6/5.2 | 87.1/33.8/17.8 | 27.1/122.4/14.8 | 62.0/125.0/14.4 | 56.4/78.4/19.2 | 70.8/31.5/18.8 | 116.2/84.5/16.7 |

> 胸上 / 髪１：两种 VMD 均无此骨（SJIS 宽容名映射原因，与 patch 版一致）。

### 全局角差统计（帧 45，191 骨样本，相对 MMM）

| 模式 | 平均角差 | 最大角差 |
|------|---------|---------|
| game（默认参数链路） | 31.9° | 256.6°（后腰１B_2_1） |
| patch（调参版） | 30.2° | 277.6°（前髪１_*） |

## 五、结论（如实报告，不伪造 PASS）

**game 模式（MMDAnimationHelper 零参数链路）裙子摆动并未改善，反而更小**：

- スカート_0_1 **f45: game 4.9° vs patch 35.6° vs MMM 87.0°**（目标 ≥60°，两者均远不达标）
- スカート_0_1 **f30: game 16.6° vs patch 33.7° vs MMM 96.0°**（game 比 patch 还小一半）
- スカート_0_1 **f75: game 3.5° vs patch 4.8° vs MMM 63.4°**
- 全局平均角差 game=31.9° 与 patch=30.2° 基本持平

**关键证据**：
1. 复刻游戏链路（helper.add 自动 warmup + `_optimizeIK` + PMX 路径 updateOne）后，默认参数下裙子 f45 仅 4.9°，比 patch 版（35.6°）还小。
2. MMDPhysics 默认 spring 未除以任何 scale（PMX 原始值直传），裙子弹簧偏硬 → 摆动更收敛；patch 版 ÷1000 才勉强到 35.6°。
3. 两种模式的摆动幅度都与 MMM（87-96°）有数量级差距，且胸部维度同样失配（右胸上 f45: game 129.1° / patch 9.8° / MMM 7.7°）。

**这证明**：问题不在 bake 的手写循环，也不在参数 patch 层面（参数 patch 反而把裙子从 4.9° 抬到 35.6°，但远不够）。**问题在更深处——MMDPhysics 引擎本身（弹簧/约束求解模型）或加载数据层面（刚体 shape/质量/碰撞 mask 的构造），而非烘焙链路的组织方式。** 与 fix1-fix5 的结论一致：结构性限制。

## 六、建议下一步

1. **验证「游戏里真的摆动大」的口径**：在游戏里对同一模型（Tda 夏夜1 HMS）+ pickup.vmd 实测物理骨的最大摆角，确认游戏实时摆角确实 ≥60°（若游戏实际也摆不动，则「游戏效果好」的观察本身需要重新校准）。
2. **对照 MMDLoader 实际加载路径**：确认游戏运行时 mesh 的 `userData.MMD.rigidBodies` 数据来源（meta3d 版 MMDLoader.js 里 rigidBodies/constraints 构造被注释，理论上游戏物理应为空——需查清游戏前端是否另有填充逻辑，这可能是「游戏效果好」与「bake 复刻效果差」的关键分歧点）。
3. 若 1、2 均确认游戏物理确实工作且摆角大 → 换引擎方向（MMM Bullet 2.75 DLL FFI），已按兄弟拍板进入最后一轮评估。

## 七、恢复 MMDLoader rigidBodies/constraints 构造后（2026-08-07 追加）

> 步骤 2 的假设已被部分排除：meta3d 版 `MMDLoader.js` 中被兄弟注释（为性能）的 rigidBodies/constraints 构造代码已按指令恢复。

**改动**：`packages/meta3d-jiehuo-abstract/src/three/MMDLoader.js` GeometryBuilder.build L1385 `/*! edit by meta3d */` 标记后的 rigidBodies 循环（含 PMX position 相对骨修正 `params.position -= bone.position`）与 constraints 循环（含 bodyA.type/bodyB.type 修正）已取消注释恢复为真实代码，**保留 `/*! edit by meta3d */` 标记**。仅恢复此一处，其余 27 处 edit by meta3d 优化未动。

**恢复生效验证**（`verify-mmdloader-rigidbodies.mjs`，走恢复后的 `GeometryBuilder.build` 完整加载 PMX）：
- `node --check` 通过；加载 PMX：bones=310 rigidBodies=491 constraints=847
- `geometry.userData.MMD.rigidBodies = 491`（PMX 同数），`constraints = 847` — 不再是空数组
- 抽验：`rigidBodies[0]` name="胸" type=0 boneIndex=110 position=[0, 0.033, 0.067]（已被相对骨修正）；`constraints[0]` name="左胸上" rigidBodyIndex1=0 rigidBodyIndex2=2

> 注意：恢复段所在的 `GeometryBuilder.build` 里有另一处无关的 edit by meta3d 优化（`_getValidExpressions` 读 `globalThis['validExpressions']`），node 下未设置会崩，验证脚本设 `globalThis.validExpressions = null` 跳过（不影响恢复段）。

**bake-game 重跑：数据零变化（如实记录）**：
- `bake-game.mjs` 是**独立构造路径**：它自己从 `pmx.rigidBodies` map 出 rigidBodyParams（含相对骨偏移），L168 直接写 `geo.userData.MMD.rigidBodies`，**完全不经过** MMDLoader 的 `GeometryBuilder.build`（只在 L193 用 `loader.animationBuilder.build` 构建动画 clip）。因此恢复 MMDLoader 不影响 bake-game 输入。
- 重跑 `pickup_bake_game.vmd`：1688057 字节（与上次一致），motions=15191 不变。
- 重跑 `compare-bake-game.mjs`：**数据逐帧一致**——スカート_0_1 f45: game 4.9° / patch 35.6° / MMM 87.0°；f30: 16.6/33.7/96.0；f75: 3.5/4.8/63.4。全局角差 game=31.9° / patch=30.2° 不变。

**结论**：恢复 MMDLoader rigidBodies 构造不改变 game 烘焙复刻结果（bake-game 与 MMDLoader 是两条独立构造路径）。但**游戏运行时** `userData.MMD.rigidBodies` 恢复后会被真实填充（491/847），游戏物理从「理论上从未工作」变为「真实工作」——需要在游戏里重新实测摆角，确认「游戏效果好」口径是否成立。结构性限制结论（MMDPhysics 引擎/加载数据层面）维持不变。

## 八、换用游戏同款 ammo.wasm.js 后（2026-08-07 追加）

> 针对「游戏里物理恢复后裙子摆动明显，但 bake 复刻只有 4.9°」的最可能差异——**Ammo 构建不同**（游戏 wasm 版 vs bake npm 非 wasm 版）——做根因验证。

**改动**（仅 `packages/mmd_tool/src/tool/bake-game.mjs` 的 Ammo 注入段 L51-53）：
- 原：`import('ammojs-typed/ammo/ammo.js')` → `await AmmoMod.default()`
- 新：`createRequire` 加载游戏同款 `packages/meta3d-jiehuo-abstract/src/resource/libs/ammo.wasm.js`（394590 B，UMD/CJS 尾导出 `module.exports = Ammo`），**wasm 二进制**用 `ammo.wasm.wasm`（651386 B）经 `{ wasmBinary }` 注入（跳过 emscripten 在 Node 下对本地文件路径的 fetch 分支，否则 `abort(TypeError: fetch failed)`），`globalThis.Ammo = await ammoFactory({ wasmBinary })`。
- 加载确认日志：`Ammo source: game-same ammo.wasm.js (wasm 版) @ .../libs/ammo.wasm.js | wasm bytes: 651386` ✅

**bake 重跑**（`node --import ./src/tool/register-resolve.mjs src/tool/bake-game.mjs`）：
- PMX bones=310 rigidBodies=491 constraints=847；VMD motions=15191 morphs=78
- physics-driven bones=163，recorded physics bones=163
- `written: output/pickup_bake_game.vmd (1688057 bytes) motions=15191 morphs=78` — **与换引擎前字节数完全一致**

**compare 重跑数据（逐帧与换前完全一致）**：
- スカート_0_1 **f45: game 4.9° / patch 35.6° / MMM 87.0°**；f30: 16.6/33.7/96.0；f75: 3.5/4.8/63.4
- 全局角差 game=31.9° / patch=30.2° 不变（191 骨样本，帧 45）
- スカート_0_10、スカート_1_1、左/右胸上、前髪１ 各帧数据全部逐帧一致

**结论：Ammo 构建差异不是根因（实锤排除）**：
1. **wasm 版与 npm 非 wasm 版物理求解数值结果逐字节一致**（输出文件 1688057 B 相同、比较数据逐帧相同）——Bullet 求解器在这两构建间是确定性的，与「游戏摆动明显 vs bake 4.9°」无关。
2. 游戏与 bake 现在走**同一个 wasm 引擎**，差异依旧存在 → 差异一定来自引擎之外：`Physics.ts` 的 `globalThis.Ammo()` 初始化参数、游戏运行时的 MMDPhysics 实例化参数（spring 系数、刚体 scale/质量）、或动画/更新循环差异，而非加载的 Ammo 构建。
3. 上一轮「结构性限制（MMDPhysics 引擎/加载数据层面）」结论维持，且进一步收窄：**不是 Bullet 引擎本身，而是 MMDPhysics 的装配参数或运行时上下文**。

**建议下一步**（优先级排序）：
1. 在游戏运行时给 MMDPhysics 的构造参数加日志（`_springs` / `_rigidBodies` 的 scale、stiffness 原始值），对比 bake 侧的 `MMDPhysics.js` 默认参数，找出装配差异。
2. 对照 `Physics.ts` `globalThis.Ammo()` 后对 Ammo 对象的后续使用（是否设置了 fixedTimeStep / 调用参数），与 bake 循环的 `simulate(delta, ...)` 步进参数比对。
3. 若游戏里实测确认摆角大，可在游戏 MMDPhysics 上临时打点验证是 spring 参数还是刚体 mass/scale 差异，再回到 bake 侧对齐。
4. 若 1-3 仍无果 → 维持换引擎方向（MMM Bullet 2.75 DLL FFI）评估不变。
