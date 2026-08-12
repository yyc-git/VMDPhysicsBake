# MMD 物理解算对齐方案

> 状态：方案完成 | 日期：2026-08-06
> 依赖：research.md、bake-physics.mjs、MikuMikuPhysics（GitHub）、MMM 本地（D:\MMM\）
> 目标：解决胸部大幅摆动（267° vs 6°）和裙子幅度偏小（33° vs 96°），对齐 MMD 原生物理行为

---

## 摘要

**核心发现**：Ammo.js 本身就是 Bullet 2.82 的 Emscripten 编译版，与 MikuMikuPhysics 的 `pmx_bullet.dll` 使用**同一版本物理引擎**。当前 267° vs 6° 的差异不是「换引擎」问题，而是**约束参数映射不全**的问题。MikuMikuPhysics 暴露了 6 个我们缺失的参数维度（ERP/CFM ×4、spring damping 差异、kinematic smoothing），补齐这些映射预期可将胸部和裙子的偏差缩小到可接受范围。

**推荐路线**：路线 A（Ammo.js 调参）的 fix5，融合 MikuMikuPhysics 的 6 项参数映射 + 分区域调参（zone rules），不需要路线 B/C。

---

## 1. 三条路线对比分析

### 1.1 关键事实：Ammo.js 就是 Bullet 2.82

| 事实 | 证据 |
|------|------|
| Ammo.js 编译自 Bullet 2.82 | `ammojs-typed` README + 源码引用 Bullet 2.82 API（`btGeneric6DofSpringConstraint`、`set_m_numIterations`） |
| MikuMikuPhysics 使用 Bullet 2.82 r2704 | README 明确声明（`native/pmx_bullet_api.cpp` → Bullet 2.82 r2704） |
| Ammo.js 提供相同 API | `btGeneric6DofSpringConstraint.setStiffness/setDamping/setEquilibriumPoint` 均在 ammojs-typed 中可用（我们的 bake-physics.mjs 已调用） |
| BulletSharp（MMM）也是 Bullet 封装 | `D:\MMM\System\BulletSharp.dll` 是 C# 封装，底层同样是 Bullet C++ |

**结论**：三条路线在物理引擎层面本质相同。差异全在**参数映射层**（PMX 语义 → Bullet API 的翻译方式）和**求解器配置**（ERP/CFM/迭代次数）。

### 1.2 路线 A：Ammo.js 调参对齐（fix5）

**现状**：bake-physics.mjs 已完成 fix1-4（position 归零、warmup 分离、spring equilibrium/damping、stiffness 缩放+solver 迭代），fix5 待做。

**fix5 诊断清单**（逐一对照 MikuMikuPhysics 参数表，见 §3.1）：

| # | 参数 | 我们的值 | MikuMikuPhysics 值 | 差异影响 |
|---|------|---------|-------------------|---------|
| 1 | spring damping | 0.05（全局） | 1.0（默认）/ 0.85（zone） | **0.05 是极低阻尼 → 弹簧持续振荡 → 胸部 267°** |
| 2 | joint_stop_erp | **未设置**（Bullet 默认 ~0.2） | -1.0（使用 Bullet 内置默认） | 约束停止误差修正参数，影响约束稳定性 |
| 3 | joint_stop_cfm | **未设置**（Bullet 默认 ~0.0） | -1.0（使用 Bullet 内置默认） | 约束力混合因子 |
| 4 | locked_joint_stop_erp | **未设置** | 0.2 | 锁定轴（如 PMX 中 linear_lower==upper 的轴）的停止误差修正 |
| 5 | locked_joint_stop_cfm | **未设置** | 0.0002 | 锁定轴的力混合因子 — **极低 CFM 意味着极硬的锁定** |
| 6 | kinematic smoothing | **无** | 12 步插值（move=0.03，angle=8°） | 高速拖动/首帧跳变时平滑 kinematic 刚体过渡 |
| 7 | temporal kinematic init | **无**（物理直接以 dynamic 模式启动） | 初始化所有 dynamic 刚体为 kinematic → 对齐骨骼 → 切回 dynamic | 减少初始爆炸/震荡 |
| 8 | solver iterations | 50 | 20（默认）/ 可调 | 我们更高，没问题 |
| 9 | stiffness scale | ÷2000 | 原值（Bullet 内部处理？）/ 也可能是 PMX API 直接接受 PMX 量级 | 需确认 — MikuMikuPhysics 是否对 spring stiffness 做换算 |

**胸部根因分析**（weight=0.05 + springRot=[100,200]）：

胸部刚体 weight=0.05（其他刚体通常 0.1~1.0）是极轻质量。物理公式：角加速度 = 力矩 / 转动惯量，质量减半 → 相同弹簧力矩产生双倍加速度。

- 弹簧 stiffness 换算后：100/2000=0.05, 200/2000=0.1（Bullet 0-1 量级，合理）
- **但**：damping=0.05 意味着每步只消散 5% 的振荡能量 → 弹簧像无阻尼简谐振动 → 振幅越甩越大
- MikuMikuPhysics 的 damping 默认 1.0（每步全阻尼）→ 弹簧快速收敛到平衡点，胸部几乎不动
- 此外：locked_joint_stop_cfm=0.0002 在锁定轴（如 chest 的某些轴）上施加极大力以防脱离 → 我们也缺这个

**验证方法**：将 spring damping 从 0.05 提升到 0.85，观察胸部角度是否从 267° 降至接近 MMM 的 6°。

**路线 A 可行性**：高。所有参数均可在 Ammo.js 中设置（`btGeneric6DofSpringConstraint.setParam` 对应 ERP/CFM，`setDamping` 已有）。Risk：如果 ERP/CFM 在 Ammo.js 中的 setParam 参数编号与 Bullet C++ 不同，需要对照 ammojs-typed 绑定确认。

### 1.3 路线 B：迁移到原生 Bullet 2.82

**方案**：用原生编译的 Bullet 2.82 替代 Ammo.js，参考 MikuMikuPhysics 的 pmx_bullet.dll。

**可用选项评估**：

| 选项 | 可行性 | 工作量 | 问题 |
|------|--------|--------|------|
| `bullet.js`（另一个 WASM 编译版） | 中 | 2-3 天 | 与 ammo.js 本质相同（都是 Emscripten 编译），参数映射差异未知 |
| Node native addon（C++ 编译） | 低 | 2-4 周 | 需要 C++/Node-API/nan 开发能力；Windows/macOS/Linux 三平台编译；Ammo.js 的三方包依赖（MMDPhysics.js 直接 import Ammo）需全部改写 |
| Python subprocess（通过 MikuMikuPhysics 的 DLL） | 低 | 1-2 周 | 架构割裂；Node→Python 通信开销；不适合离线工具链 |
| node-ffi（直接调 pmx_bullet.dll） | 极低 | 3-4 周 | node-ffi 年久失修（最后更新 2019），不支持 x64/Win 稳定调用；需要写完整的 C 结构体映射 |

**结论**：路线 B 方向错误。Ammo.js **就是** Bullet 2.82，问题不在引擎而在参数层。换引擎不会改变物理结果，除非新引擎有不同默认参数——但那恰好是参数映射问题（即路线 A 的范畴）。

### 1.4 路线 C：参考 MMM BulletSharp 思路

**MMM 物理烘焙工作流**（从 MikuMikuPlugin.xml 推断）：

1. 软件进入 `SceneState.PhysicsBaking` 模式
2. 后台运行 Bullet 物理模拟，**逐帧记录物理骨骼 position/rotation → 写入骨骼关键帧 → 导出 .vmd**
3. 通过 `ModelPropertyFrameData.Physics` 关键帧控制物理引擎开关（动画不同段落精确控制）
4. 通过 `ModelPropertyFrameData.PhysicsStillMode` 关键帧设置物理静止模式
5. `BoneType.TransformAfterPhysics` 标识需要物理后变换的骨骼

**路线 C 可行性**：低（Node.js 无 C#/BulletSharp 运行时）。但上述工作流概念可直接借鉴到现有 bake-physics.mjs：
- physical ON/OFF 关键帧：已隐含支持（我们只 bake 固定段，但可扩展支持分段的 Physics flag）
- TransformAfterPhysics：对应 PMX 的 `transformationClass`，我们的 bone hierarchy 构建已正确处理

**路线 C 的实际价值**：作为工作流参考，不涉及引擎替换。

### 1.5 路线对比汇总

| 维度 | 路线 A（fix5 调参） | 路线 B（原生 Bullet） | 路线 C（MMM 思路） |
|------|---------------------|----------------------|-------------------|
| 物理引擎一致性 | ✅ 同一引擎 | ✅ 同一引擎 | ✅ 同一引擎（C# 封装） |
| 工作量 | **2-4 天** | 2-4 周 | 1-2 周（重写全栈） |
| 解决了什么 | 参数映射缺口 | 无（引擎相同） | 架构模式参考 |
| 对现有代码影响 | 增量修改 bake-physics.mjs | 重写物理层 + MMDPhysics.js | 重写整个物理+烘焙层 |
| 能否直接消除 267°→6° | ✅（damping+ERP/CFM） | ❌（参数不交仍然差） | ❌ |
| 能否复用现有验证 | ✅ verify-bake.mjs 直接复用 | ❌ 需重写 | ❌ 需重写 |

---

## 2. 推荐路线 + 详细实施计划

### 2.1 推荐：路线 A fix5（融合 MikuMikuPhysics 参数映射）

**原因**：
1. Ammo.js = Bullet 2.82，引擎无需更换
2. MikuMikuPhysics 提供了明确的对齐目标（6 项参数缺口）
3. 改动范围小（仅 bake-physics.mjs + 可能的 MMDPhysics.js monkey-patch）
4. 验收标准明确（与 MMM 烘焙版逐骨对比）

### 2.2 实施步骤（fix5 的 5 个子阶段）

#### Step 1：预研——确认 Ammo.js ERP/CFM API（0.5 天）

**目标**：确认 `btGeneric6DofSpringConstraint.setParam` 在 ammojs-typed 中的参数编号。

**方法**：
1. 读 `node_modules/ammojs-typed/ammo/ammo.d.ts` 查找 `setParam` 签名
2. 对照 Bullet 2.82 官方 API：
   - `BT_CONSTRAINT_STOP_ERP` = 3
   - `BT_CONSTRAINT_STOP_CFM` = 4
   - `BT_CONSTRAINT_ERP` = 5（对应普通约束 ERP）
   - 通用约束的 ERP/CFM 参数索引需在 ammo.js 中验证
3. 如 Ammo.js 不暴露这些参数枚举 → 在 bake-physics.mjs 中硬编码参数编号（Bullet 源码保证不变）

**输出**：`analysis/vmd-physics-bake/fix5-ammo-api-verify.md`（Ammo.js ERP/CFM 参数编号确认表）

**验证标准**：调用 `setParam(3, 0.2)` 不报错（即 Ammo.js 接受该参数编号）

#### Step 2：补全约束参数映射（1 天）

**目标**：在 bake-physics.mjs 的 spring 约束循环（L225-236）中增加 ERP/CFM + 阻尼修正。

**参数来源**（直接对齐 MikuMikuPhysics 默认值）：

| 参数 | 目标值 | 说明 |
|------|--------|------|
| `springDamping` | **0.85**（全局默认）→ 可对 chest 区单独提升到 0.95 | MikuMikuPhysics zone_rules 对 soft-body-part 的推荐 |
| `joint_stop_erp` | -1.0（保持 Bullet 默认，不覆盖） | 仅在 PMX 中 joint limit 被显式使用时才设置非负值 |
| `joint_stop_cfm` | -1.0（保持 Bullet 默认） | 同上 |
| `locked_joint_stop_erp` | 0.2 | 用于 PMX 中 linear_lower==upper 的锁定轴 |
| `locked_joint_stop_cfm` | 0.0002 | **极低值** → 极硬的锁定约束 |

**实现要点**：
- `btGeneric6DofSpringConstraint` 继承自 `btGeneric6DofConstraint`，后者有 `setParam` 方法
- 锁定轴判断：对 PMX constraint 的 6 个自由度（linear xyz, angular xyz），当 `linear_lower[i] == linear_upper[i]` 时该轴为锁定轴
- 对锁定轴设置 `locked_joint_stop_erp` / `locked_joint_stop_cfm`
- 对非锁定轴设置 `joint_stop_erp` / `joint_stop_cfm`（如果值非负）

**输出**：修改 `bake-physics.mjs` 的 constraint setup 段

**验证标准**：重新 bake → verify-bake V7，胸骨角度从 267° 降至 50° 以内（目标接近 MMM 的 6°，实际预期 10-40°）

#### Step 3：temporal kinematic init + kinematic smoothing（1 天）

**目标**：在 warmup 前和每帧物理前，对 dynamic 刚体执行 temporal kinematic init。

**从 MikuMikuPhysics 复现的核心流程**：

```
1. 创建物理世界后：
   - 对每个刚体，以当前骨骼姿态设置 transform（kinematic 模式）
   - temporal_kinematic_init() → Bullet 内部将 dynamic body 标记为 kinematic → 对齐姿态 → 恢复 dynamic
   - 目的：消除初始姿态与物理刚体位置的差异，避免首帧大位移 → 爆炸力

2. 每帧 step 前：
   - kinematic_smoothing：把 static 刚体的此帧姿态与上帧姿态做插值（最多 12 段）
   - 每段 set_kinematic_transforms + step(timestep/segments, 1)
   - 目的：快速移动的角色骨骼不会一帧内跳变 → kinematic 平滑过渡 → 动态刚体不因"隔壁 static 刚体瞬间位移"产生巨大碰撞力
```

**实现要点**：
- temporal_kinematic_init：Ammo.js 的 `btRigidBody.setCollisionFlags(btCollisionObject.CF_KINEMATIC_OBJECT)` + 设置 transform + 恢复 flags
- kinematic smoothing：在每帧 step 前，计算此帧与上帧各 static 刚体的位移/角度差，若超过阈值则拆分 substeps
- 阈值参考 MikuMikuPhysics：move > 0.03 或 angle > 8° 时触发

**输出**：bake-physics.mjs 增加 temporal kinematic init + kinematic smoothing 逻辑

**验证标准**：首次 warmup 帧不再有刚体"蹦飞"现象（如现在偶尔出现的某个裙子刚体初始位移大）；平滑步后物理稳定性提升

#### Step 4：分区域参数调优（胸部 / 裙子专项）（1 天）

**目标**：参考 MikuMikuPhysics 的 zone rules 体系，按刚体名称规则对胸部、裙子分别调参。

**胸部 zone（soft-body-part）配置**：

| 参数 | 值 | 理由 |
|------|----|------|
| `springDamping` | **0.90-0.95** | 极轻质量（0.05）需高阻尼防止振荡 |
| `locked_joint_stop_cfm` | **0.00005**（比默认 0.0002 更低） | 胸部锁定轴需更硬约束 |
| `angular_damping` 缩放 | ×1.3 | 额外衰减角速度 |

**裙子 zone（skirt）配置**：

| 参数 | 值 | 理由 |
|------|----|------|
| `springDamping` | **0.70** | 裙子需要一定的摆动幅度（低于全局 0.85，高于当前 0.05） |
| `linear_damping` 缩放 | ×0.8 | 裙摆平移运动不受过大阻力 |
| `joint_stop_erp` | 0.5（非负） | 关节限位需要有效约束以防穿腿 |

**匹配规则**：
- 胸部：boneName 匹配 `胸上` / `胸下` / `胸` + rigidName 匹配 `胸` 模式
- 裙子：boneName 匹配 `スカート` / `前髪` / `後髪` / `右前髪` / `左前髪`

**实现方式**：在 bake-physics.mjs 的 constraint 设置循环中，根据刚体名匹配 zone pattern，覆盖对应参数。

**输出**：bake-physics.mjs 的 zone_rules 段 + bake-config.json 增加 `zoneRules` 配置段落

**验证标准**：重新 bake verify-bake V8，胸骨 f75 角度 ≤ 20°，裙子 f30 角度 ≥ 60°

#### Step 5：全量对比验收（0.5 天）

**目标**：用 verify-bake.mjs 输出与 MMM 烘焙版的全量逐骨对比报告。

**指标**：
- 163 物理骨重合率（当前 1.0 → 需保持）
- median 角差（当前 28.9° → 目标 ≤ 20°）
- 胸部专项：左胸上 f75 < 20°、f45 < 15°
- 裙子专项：スカート_0_1 f30 > 60°
- 起身段前倾：f40 偏差 < 8°（当前 13°，MMM 15°）

**输出**：verify-bake V8 全 PASS 报告

### 2.3 关键风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Ammo.js 的 `setParam` 参数编号与 Bullet 不同 | 中 | 高 | Step 1 预研先确认；如不同则硬编码正确的枚举值 |
| ERP/CFM 后胸部仍振荡 | 低 | 中 | 将 spring damping 进一步提升至 0.98；关闭胸部弹簧的 angle 轴（仅用 joint limit 控制） |
| kinematic smoothing 导致物理"迟钝" | 低 | 低 | 可降至 4 步插值；在 bake 场景下骨骼运动慢，smoothing 影响小 |
| 裙子仍不够大 | 中 | 中 | 降低裙子 zone spring damping 至 0.5；检查是否裙子碰撞组与腿碰撞组的 mask 设置不当（碰撞被禁用导致裙子不弹） |

---

## 3. 技术细节研究

### 3.1 MikuMikuPhysics → Bullet 完整参数映射表

以下从 MikuMikuPhysics 源码（`physics/bullet_native.py` + `physics/pmx_data_reader.py` + `physics/physics_world.py`）提取的完整参数流转：

#### 3.1.1 刚体参数（PMX → Bullet）

| PMX 字段 | 对应 PMX 属性 | Bullet API | 换算 | 我们的状态 |
|----------|--------------|-----------|------|-----------|
| shape | Sphere/Box/Capsule | `btSphereShape` / `btBoxShape` / `btCapsuleShape` | PMX 尺寸×缩放 | ✅ MMDPhysics.js 已处理 |
| mass | rigidBody.mass | `btRigidBodyConstructionInfo.mass` | 0=static, >0=dynamic | ✅ MMDPhysics.js 已处理 |
| friction | rigidBody.friction | `btRigidBody.setFriction()` | 直接 | ✅ |
| restitution | rigidBody.restitution | `btRigidBody.setRestitution()` | 直接 | ✅ |
| linear_damping | rigidBody.linearDamping（PMX 默认 0.04） | `btRigidBody.setDamping(linear, angular)` | 直接 | ✅ |
| angular_damping | rigidBody.angularDamping（PMX 默认 0.1） | 同上 | 直接 | ✅ |
| collision_group | rigidBody.groupIndex | `collisionFilterGroup` (1 << groupNumber) | 位运算 | ✅ |
| collision_mask | rigidBody.noCollisionGroups | `collisionFilterMask` (0xFFFF & ~mask) | 位运算 | ✅ |
| position | PMX 坐标 → 骨骼局部偏移 | `btTransform.setOrigin()` | 减去 bone.position | ✅ 我们的 L140-143 |
| rotation | PMX 四元数 | `btTransform.setRotation()` | 直接 | ✅ |
| **mode (type)** | 0=static, 1=dynamic, 2=dynamic_bone | rigid body type + collision flags | 0→static, 1/2→dynamic | ✅ |

#### 3.1.2 约束参数（PMX → Bullet）—— ⚠️ 这是关键差异区

| PMX 字段 | Bullet API | MikuMikuPhysics 如何设 | **我们的状态** |
|----------|-----------|----------------------|-------------|
| linear_lower / upper | `btGeneric6DofConstraint.setLinearLowerLimit/UpperLimit` | 直接映射 | ✅ MMDPhysics.js |
| angular_lower / upper | `btGeneric6DofConstraint.setAngularLowerLimit/UpperLimit` | 直接映射（弧度） | ✅ MMDPhysics.js |
| springPos (PMX → linear spring) | `btGeneric6DofSpringConstraint.enableSpring(i, true)` + `setStiffness(i, val)` | 原值传入 **无缩放** | ✅ 但我们除以 2000 |
| springRot (PMX → angular spring) | 同上 | 原值传入 **无缩放** | ✅ 但我们除以 2000 |
| **spring damping** | `btGeneric6DofSpringConstraint.setDamping(i, val)` | **默认 1.0**（per-axis tuple） | ⚠️ **我们设 0.05** |
| **equilibrium point** | `btGeneric6DofSpringConstraint.setEquilibriumPoint()` | 在 Bullet world 初始化后调用 | ✅ 我们已补 |
| **joint_stop_erp** | `btGeneric6DofConstraint.setParam(BT_CONSTRAINT_STOP_ERP, val, axis)` | **-1.0（默认）** / zone 可覆盖 | ❌ **未设置** |
| **joint_stop_cfm** | `btGeneric6DofConstraint.setParam(BT_CONSTRAINT_STOP_CFM, val, axis)` | **-1.0（默认）** / zone 可覆盖 | ❌ **未设置** |
| **locked_joint_stop_erp** | `btGeneric6DofConstraint.setParam(BT_CONSTRAINT_ERP, val, locked_axis)` | **0.2** | ❌ **未设置** |
| **locked_joint_stop_cfm** | `btGeneric6DofConstraint.setParam(BT_CONSTRAINT_CFM, val, locked_axis)` | **0.0002** | ❌ **未设置** |
| joint_quality.use_frame_offset | `btGeneric6DofConstraint.setParam(BT_CONSTRAINT_USE_FRAME_OFFSET, 1)` | `true` | ❓ 不确定 MMDPhysics.js 是否设置 |
| disable_collisions | `btRigidBody.addConstraintRef()` + collision group | 仅在 joint 连接的两刚体间禁用碰撞 | ✅ MMDPhysics.js |

#### 3.1.3 求解器配置

| 参数 | MikuMikuPhysics 默认 | **我们的值** | 差异 |
|------|---------------------|-------------|------|
| solver iterations | 20（可调，默认 20） | 50 | ✅ 我们对收敛性更好 |
| fixed_step (Hz) | 120 | 65 (1/unitStep) | ⚠️ 我们 ≈ 65Hz，MikuMikuPhysics 120Hz × 8 substeps = 960Hz 等效精度 |
| max substeps | 8 | 3 (maxStepNum) | ⚠️ 我们 3，MikuMikuPhysics 8 |
| gravity | 可配 | (0, -98, 0) | ≈ 一致（MMD 标准 -9.8m/s² × 10） |
| prewarm_steps | 可配（≥0） | 60 | ✅ 我们更多 |

#### 3.1.4 关键参数默认值对比

| 参数 | MikuMikuPhysics | bake-physics.mjs | 推荐的 fix5 值 |
|------|----------------|-----------------|-------------|
| springStiffness 换算 | **无缩放**（PMX API 直接 → Bullet） | ÷2000 | **需确认**：MikuMikuPhysics 在 pmx_bullet_api.cpp 是否内部做了缩放？如果没做，我们的 ÷2000 可能过度弱化了 spring |
| springDamping | 1.0（全局），0.85（zone hair/skirt），可调 0.5~1.0 | 0.05 | **0.85（全局），0.95（胸部）** |
| joint_stop_erp | -1.0（使用 Bullet 默认≈0.2） | 未设置（≈默认 0.2，但各约束默认可能不同） | 对显式 joint limit 设置 0.5 |
| locked_joint_stop_erp | 0.2 | 未设置 | **0.2** |
| locked_joint_stop_cfm | 0.0002 | 未设置 | **0.0002** |
| kinematic smoothing | enabled (12 steps, move=0.03, angle=8°) | 无 | **enabled (6 steps，bake 场景骨骼运动幅度小)** |

### 3.2 Bullet 2.82 vs Ammo.js 差异分析

**编译差异**：
- Bullet 2.82 C++ → Emscripten → ammo.js：浮点运算从硬件 FPU 变为 JS 64-bit float（IEEE 754），精度理论上等价
- **关键差异点**：Emscripten 编译可能改变某些编译期常量的值（如 `#define BT_DEFAULT_ERP 0.2`），但 Bullet 的运行时 `setParam` 覆盖这些常量
- SIMD 差异：Bullet 2.82 在 x64 上使用 SSE，ammo.js 无 SIMD → 求解器性能差异（2-5x 慢）但**数值结果应相同**

**参数编号差异风险**：
- Emscripten 编译后的枚举可能被重新编号。例如 `BT_CONSTRAINT_STOP_ERP` 在 Bullet C++ 中是 3，在 ammo.js 可能也是 3（因为它是 Bullet 源码的 1:1 翻译），但需在 Step 1 确认。

**结论**：Ammo.js 与 Bullet 2.82 的求解器算法相同，参数映射的数值路径相同。差异仅可能在编译期常量和枚举编号上，可通过运行时 setParam 覆盖解决。

### 3.3 胸部轻质量刚体（weight=0.05）在 Bullet 中的处理策略

**问题机制**：
- Bullet 使用 PGS（Projected Gauss-Seidel）迭代求解器
- 质量小的刚体在约束求解中权重低 → 每次迭代的修正量小 → 需要更多迭代才能收敛
- 当轻质量刚体 + 弹簧约束组合时：弹簧力 = stiffness × displacement，不依赖质量；但加速度 = force / mass
- mass=0.05 → 加速度放大 20 倍 → 每步位移大 → 约束求解器下一帧要修正 → 可能过冲 → 振荡

**标准应对策略**（从 Bullet 社区 + MikuMikuPhysics 实践）：

| 策略 | 效果 | 实现难度 |
|------|------|---------|
| 提高约束求解迭代次数（>50） | 更充分收敛，减少过冲 | 低（改配置） |
| 增加角阻尼（angular_damping ×1.3） | 直接衰减振荡 | 低（per-body 设置） |
| 提高弹簧阻尼（damping >0.9） | 临界阻尼/过阻尼，弹簧不复振 | 低（已有 setDamping） |
| 降低 ERP（error reduction parameter） | 约束修正更慢 → 减少过冲 | 低（setParam 设置） |
| 质量缩放（mass scaling） | 让轻质量刚体在求解器中有更高权重 | 中（可能与物理真实性冲突） |
| 子步细分（maxSubsteps ↑） | 每帧更多物理步 → 位移小 → 约束不容易穿透 | 低（改 maxStepNum 配置） |
| **deactivation 禁用** | 轻质量刚体容易进入 sleep 状态 → 不响应力 | 低（`setActivationState(DISABLE_DEACTIVATION)`） |

**推荐组合**（对胸部 zone）：
1. spring damping: 0.90 → 弹簧振荡几乎消除
2. angular damping: ×1.3 → 角速度更快衰减
3. locked_joint_stop_cfm: 0.0001 → 锁定轴极硬
4. 胸部 rigid body 设置 `DISABLE_DEACTIVATION` → 防止 sleep

---

## 4. 三态定义

- **输入**：
  - 现有工具链：`analysis/vmd-physics-bake/`（bake-physics.mjs / bake-config.json / verify-bake.mjs / diag-chest*.mjs / research.md / diff-bake-vs-raw.mjs / 全部诊断脚本）
  - 参考源码：GitHub MikuMikuPhysics（`physics/bullet_native.py`、`physics/physics_world.py`、`physics/pmx_data_reader.py` — 通过 web_fetch 已验证可读）
  - MMM 本地：`D:\MMM\System\BulletSharp.dll`、`MikuMikuPlugin.xml`（API 文档 — 已验证可读）
  - 对比基准：`vmd_bake_physics/pickup.vmd`（MMM 烘焙版）+ `vmd_160/pickup.vmd`（原始版）
- **输出**：`analysis/vmd-physics-bake/mmd-physics-alignment-plan.md`（本文件 — 中文方案文档）
- **失败态**：GitHub 源码已成功读取，无访问失败；胸部根因已给出假设 + 验证方法；如 fix5 实施后仍不收敛 → 升级为路线 B（重新编译 Bullet 2.82 WASM 或直接用 MikuMikuPhysics DLL 通过 Python subprocess）
- **返回格式**：见下方「方案完成摘要」

---

## 5. 不做清单

- 不修改任何现有文件（bake-physics.mjs / diag-*.mjs / verify-bake.mjs / config 只读）
- 不写任何新代码 / 不跑任何 bake / 不跑诊断脚本（方案阶段）
- 不改游戏运行时源码（MMDData.ts / MMDLoader.js / MMDUtils.ts）
- 不部署、不提交 git
- 不做全部动画批量烘焙

---

## 6. springStiffnessScale 校准的重新评估

⚠️ **关键问题**：fix4 实验通过 sweep 验证了 ÷2000 最优。但 MikuMikuPhysics 源码中**没有对 spring stiffness 做任何缩放**——它直接把 PMX 的 `spring_angular` 值（0-1000 量级）传给 Bullet 的 `btGeneric6DofSpringConstraint.setStiffness()`。

Bullet 的 spring stiffness 范围是 0.0 到 1.0（内部 `m_springStiffness[i]`）。如果 PMX 的 spring 值直接传入（例如 100），会被截断或产生超自然行为。

需要确认 MikuMikuPhysics 的 `pmx_bullet_api.cpp` 中是否在 native 层做了 `÷1000` 换算。如果做了：
- 我们的 ÷2000 = PMX 100÷2000 = 0.05 → 太弱
- 实际应该是 PMX 100÷1000 = 0.1 → 应该是我们当前值的 2 倍

**对 fix5 的影响**：如果 spring 过弱 → 裙子幅度小（33° vs 96°）。
**怀疑**：MikuMikuPhysics 内部做了 ÷1000 换算，而我们 ÷2000 换算过度。
**验证方法**：在 diag-chest2.mjs 中测试 scale=1000（不加额外缩放），看胸骨角度是否从当前值变化。如果 scale=1000 时角度在合理范围（但需同时加 damping），则 springStiffnessScale 应改为 1000。

**建议**：fix5 Step 1 额外包含 spring stiffness scale 的 MikuMikuPhysics 源码验证（读 `pmx_bullet_api.cpp`）。

---

## 方案完成摘要

### 推荐路线

**路线 A — Ammo.js fix5 调参对齐**（工作量 2-4 天），融合 MikuMikuPhysics 的 6 项参数映射：spring damping 0.05→0.85、补 ERP/CFM 约束参数、temporal kinematic init、kinematic smoothing、分区域调参（胸部阻尼 0.95、裙子阻尼 0.70）、springStiffnessScale 校准验证。

### 关键结论

1. **Ammo.js 就是 Bullet 2.82**，与 MikuMikuPhysics 的 pmx_bullet.dll 是同一版本引擎。路线 B（换引擎）不可取 —— 问题不在引擎而在参数层。

2. **胸部 267° vs 6° 的根因**：spring damping=0.05（极低）→ 无阻尼简谐振动 → 轻质量刚体（0.05）上弹簧力放大 20 倍 → 越摆越大。MikuMikuPhysics 用 damping=0.85~1.0 彻底抑制这种振荡。补齐 damping + ERP/CFM + locked_cfm 三项即可大幅缩小差距。

3. **裙子 33° vs 96° 可能有两个原因**：
   - A. springStiffnessScale=2000 可能过度弱化了弹簧（MikuMikuPhysics 内部可能用 ÷1000）；需验证 `pmx_bullet_api.cpp`
   - B. spring damping=0.05 过低导致弹簧振荡耗散在非主轴方向（看似有运动，实则能量分散）；修复 damping 后裙子摆动可能更集中、更大

4. **MikuMikuPhysics 的 zone rules 体系** 是最有价值的对齐参考：它根据骨骼/刚体名称匹配区域（头发/裙子/尾巴/软体），对每个区域独立设置 damping、ERP、CFM 等参数。我们可以用同样的名称匹配策略实现分区域调参。

5. **ERP/CFM 是此前完全缺失的参数维度**：locked_joint_stop_cfm=0.0002 在锁定轴上提供极硬约束（10000× 我们当前默认的 ~0.0~0.2），对胸部这种需要精确角度控制的部位尤其关键。

### 待兄弟决策点

1. **是否批准路线 A fix5 的实施？**（投入 2-4 天 vs 直接接受当前精度）
2. **springStiffnessScale 校准研究**：是否先读 `pmx_bullet_api.cpp` 确认 MikuMikuPhysics 内部的 stiffness 换算逻辑？还是直接在 diag-chest2.mjs 中跑 scale sweep（500/1000/2000/5000）用实验确认？
3. **精度目标**：median 角差 28.9° 降到 20° 可接受吗？还是必须 < 10°？（MMM 烘焙版本身的数值波动可能就在这个量级，因为我们无法复现 MMM 的前置 IK/Grant 帧状态）

---

## 兄弟决策记录（2026-08-06 15:17）

1. **fix5 实施：暂缓开工**。相关代码仍在变动（vmd-unify 等），等代码稳定后再 dispatch 实施轮。方案先行，不动代码。
2. **springStiffnessScale 校准方式：跑 sweep 实验**（diag-chest2.mjs 跑 scale=500/1000/2000/5000），不先读 pmx_bullet_api.cpp 源码——实验确认优先，源码核对留作实施阶段补充。
3. **精度目标**：待实施阶段再定（20° vs <10°），方案保留两档选项。

**当前状态**：方案已闭环（三路线对比 + 推荐路线 A + fix5 诊断清单 + 参数映射表）。实施条件 = vmd 相关代码稳定 + 兄弟指令。

