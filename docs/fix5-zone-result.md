# fix5 轮2 报告：zone rules 分区域调参（右胸尖峰 + 裙子幅度）

> 日期：2026-08-06 ｜ 方案：`mmd-physics-alignment-plan.md` Step 4 ｜ 工具：`bake-physics.mjs` + `bake-config.json` + `verify-bake.mjs`
> 目标缺口：① 右胸上 f45=150.4°（MMM=7.7°，要求 ≤20°）② 裙子 スカート_0_1 f45≈35°（MMM=87°，要求 ≥60°）

## 一、zone rules 机制

### 1. 配置段 `bake-config.json → zoneRules`

按 zone 声明顺序取**第一个命中的 zone**（任一候选名包含任一 needle 即命中）。匹配依据分两级：

- **约束级**：约束关联刚体 bodyA/bodyB 的**刚体名 + 骨名**（`constraintZone`）
- **刚体级**：刚体自身名 + 骨名（`bodyZone` / `rigidParamZone`）

```json
"zoneRules": [
  {
    "id": "chest",
    "match": { "boneNameContains": ["胸"], "rigidNameContains": ["胸"] },
    "constraint": { "springDamping": 0.9, "lockedStopCfm": 0.00005 },
    "rigidBody": { "angularDampingScale": 1.0, "disableDeactivation": true }
  },
  {
    "id": "skirt",
    "match": { "boneNameContains": ["スカート"], "rigidNameContains": ["スカート"] },
    "constraint": { "springDamping": 0.7, "springStiffnessScale": 1000 },
    "rigidBody": { "linearDampingScale": 1.0 }
  }
]
```

> ⚠️ 轮1 全局参数保持为默认（springDamping 0.85 / scale 1000 / solverIterations 50），zone 只覆盖匹配部分。

### 2. 覆盖能力（bake-physics.mjs）

| 级别 | 参数 | 实现方式 |
|------|------|----------|
| 约束 | springDamping | `cst.setDamping(i, zone值)` 覆盖全局 |
| 约束 | lockedStopErp / lockedStopCfm | 锁定轴（lower==upper）`setParam(2/4)` 覆盖 |
| 约束 | jointStopErp | 非锁定轴 `setParam(2)`（裙子防穿腿，本轮实测会破坏胸部稳定性→最终未用） |
| 约束 | springStiffnessScale | 用 `_origSetStiffness` 直接写 raw÷zone分频（**避开全局 setStiffness patch 二次 ÷1000**，见 bug 记录） |
| 刚体 | linearDampingScale / angularDampingScale | `body.setDamping()`（clamp 0..1） |
| 刚体 | disableDeactivation | `body.setActivationState(4)` |
| 刚体 | collisionMask / noCollisionGroups | **构造前** patch `rigidBodyParams[].groupTarget`（MMDPhysics addRigidBody 的碰撞过滤） |
| 刚体 | massScale | 构造前 patch `weight` |

### 3. 本轮踩坑（sweep 有效性相关，均已修复）

- **zone 级 setStiffness 双除 bug**：初版用 `cst.setStiffness()`，因全局 patch 仍在，实际被 ÷1000 再 ÷zone scale（÷100000，弹簧近乎关闭）→ 第一版 sweep 结果失真。改用 `_origSetStiffness` 修复。
- **碰撞 mask patch 时序**：初版放在 `new MMDPhysics()` 之后（rigidBodyParams 已被消费），无效。移到 rigidBodyParams 构建后、MMDPhysics 构造前。
- **非确定性排查**：`det-a/det-b.vmd` 字节比对确认 bake 确定性 OK（bytesEqual=true）。sweep 中 chest 值随 skirt 参数大幅漂移是**求解器耦合**（skirt 弹簧改动影响全局求解轨迹），非随机性。

## 二、sweep 数据（5 轮，全部独立进程/独立临时 config）

chest 固定最优组合（springDamping 0.90 / ang 1.0 / cfm 5e-5 / disableDeactivation），扫 skirt：

| 轮 | 变量 | 范围 | 裙 f45 结果 | 结论 |
|----|------|------|-------------|------|
| zone1 | springDamping | 0.5 / 0.6 / 0.7 / 0.8 | 27-36 | 不变 → 非 damping 驱动 |
| zone2 | springStiffnessScale | 100 / 250 / 500 / 1000 / 2000 | 34-38 | 不变（修复双除后） |
| zone3 | 极强弹簧 scale 5-50 + damp 0.3-0.9 | | 32-35 | 不变 |
| zone4 | massScale 0.05-0.5 × scale | | 34-37 | 不变 |
| zone5 | body lin/ang damping 压到 0.05-0.2 | | 8-16（**更差**） | 高 body 阻尼反而维持摆动 |
| 碰撞 | noCollisionGroups [1]（裙×腿） | | 27（更差） | 不是碰撞挡摆 |

**裙 f45 在所有参数下被压在 34-38°** → 结构性限制。

## 三、裙子根因分析（为何无法到 60°）

1. **欧拉角检查**：MMM 裙子根摆 87-96° 是 **X 轴负方向**（euler x≈-87°），落在约束 rotLim X∈[-2.094, +0.017] 内 → **不是 rotation limit 卡住**，是摆动幅度本身不足。
2. **驱动源弱**：raw VMD 中 下半身/センター 全静态，唯一输入是 グルーブ（根）f45 下蹲 -3.64、f90 前倾 0.45rad。MMM 在相同驱动下能激出 96° 摆动，three.js MMDPhysics 弹簧约束模型只能激出 ~35°。
3. **能量分配异常**：ours 深层裙关节过冲（スカート_1_1 f90=107° vs MMM 37°），根关节却欠摆 → 链上能量传给深部，根不摆。
4. **结论**：本模型 MMM 参考是 MMD 自家求解器产物，three.js MMDPhysics（游戏侧组件，禁止改动）的参数化无法复现。**裙子 f45 极限 ≈ 38°**，验收线 ≥60° 无法达成（不伪造 PASS）。

## 四、最终配置前后对比（zone2#3 组合，即最终 bake-config.json）

| 骨 | 帧 | 轮1（全局） | 轮2（最终 zone） | MMM | 达标 |
|----|-----|------------|-----------------|-----|------|
| 左胸上 | f45 | 41.4 | **19.9** | 2.8 | ✅ |
| 左胸上 | f75 | 45.9 | **28.8** | 5.7 | ✅（≤50）|
| 右胸上 | f45 | **150.4** | **9.8** | 7.7 | ✅（≤20）|
| 右胸上 | f75 | 38.0 | 76.4 | 5.7 | ❌（trade-off，尖峰转移）|
| スカート_0_1 | f30 | ~33 | 33.7 | 96.0 | ❌（结构限制）|
| スカート_0_1 | f45 | 35.6 | 35.6 | 87.0 | ❌（结构限制）|
| スカート_0_1 | f75 | 13.9 | 4.8 | 63.4 | ❌（结构限制）|

- errSum（9 采样点）= **358.7**（轮1 354.7，略升但右胸 f45 从 150.4→9.8 是决定性改善）

## 五、全量门禁（Step C）

```powershell
cd packages/mmd_tool
node src/tool/bake-physics.mjs --config bake-config.json      # 全量 rebake
node src/tool/verify-bake.mjs --config bake-config.json        # V6 不 SKIP
npx jest --config jest.config.js                                # BDD 12/12
npx tsc --noEmit -p tsconfig.json                               # 0 新增错误
```

| 门禁 | 结果 |
|------|------|
| verify V1-V6 | **全 PASS** |
| 163/163 重合率 | **1.0** |
| median 角差 | **30.47°**（轮1 32.56°，改善；未达 ≤20°） |
| 左胸上 f75 ≤50° | ✅ 28.8° |
| 右胸上 f45 ≤20° | ✅ 9.8° |
| 裙子 f45 ≥60° | ❌ 35.6°（极限 ≈38°，结构限制） |
| BDD | ✅ 12/12 |
| tsc | ✅ 无新增错误 |

## 六、遗留事项

1. 裙子 f45 ≥60° 无法在本轮参数化内达成 → **建议 Step 5 或专项：调 MMDPhysics.js 求解器参数**（但当前禁令不改游戏侧，需单独评审）或换裙摆物理模型验证。
2. 右胸上 f75 从 38→76.4（尖峰从 f45 转移到 f75）——若后续要求 f75 达标，需再 zone 细分（如仅 右胸上2 阻尼）或 jointStopErp 微调。
3. median 30.47° 仍 >20°：全模型角差由其它骨主导，非本轮 zone 范围（chest+skirt 只占 163 骨中一部分）。
4. 遗留诊断脚本 `scripts/fix5-sweep-zone*.mjs`、`fix5-diag-*.mjs`、`output/probe-zone*.mjs` 可保留供后续复用，不参与构建。
