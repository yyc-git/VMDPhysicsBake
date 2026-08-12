# fix5 轮3 — temporal kinematic init + kinematic smoothing 结果

> 日期：2026-08-06
> 目标：对齐 MikuMikuPhysics 时间层处理，压低 median 角差（30.47° → ≤20°），改善裙子摆幅
> 结论：**Step 3 对本 bake 无增益，已回滚 smoothing（保留 temporal init 为无害 no-op）**

## 实现方式

全部在 bake 脚本层（`packages/mmd_tool/src/tool/bake-physics.mjs`），未改 `MMDPhysics.js`。

### 拦截点（关键发现）

读代码确认：`MMDPhysics.update()` 内部每次调用都会执行 `_updateRigidBodies()`，把 **type-0（kinematic）刚体无条件对齐到骨骼姿态**（`updateFromBone → _setTransformFromBone`，用 `bone world × boneOffsetForm` 覆盖 body transform）。因此**无法在外部预置插值姿态**（会在 `update()` 开头被覆盖）。

→ 采用 wrap 实例方法的方式（bake 层合法，等价于轮1 patch `setStiffness` 的模式）：
```js
physics._updateRigidBodies = function () {
  origUpdateRigidBodies();   // 先 snap 到骨骼目标姿态
  // 对每个 kinematic 刚体：若位移>move 或 角度>angle，则只走 1/steps 距离
  //   pos = prev + (target-prev)/steps；quat = slerp(prev, target, 1/steps)
  // 否则完全对齐（不插值）
};
```
限制后的姿态在 `_stepSimulation` 期间保持（kinematic 刚体不被物理积分移动），等效于 MikuMikuPhysics 的「每 substep 前限制 kinematic 刚体位移」。

### config 段（`bake-config.json`）

```json
"temporalKinematicInit": { "enabled": true },
"kinematicSmoothing": {
  "enabled": false,          // ⚠️ 轮3 实测无增益，默认关闭（已回滚）
  "steps": 12, "move": 0.03, "angle": 8, "useDegrees": true
}
```

- `temporalKinematicInit`：首帧前把 kinematic 刚体对齐骨骼姿态 + 清零速度（消除「骨骼已动/刚体还在 bind pose」瞬态冲击）
- `kinematicSmoothing`：每帧限制 kinematic 刚体相对骨骼目标的位移/转角，超阈值时按 `steps` 分段插值

## 前后对比

| 指标 | 轮2 zone2#3 | 轮3 smoothing=steps12 (第一次 bake) | 轮3 回滚后 (smoothing off) |
|---|---|---|---|
| median 角差 | 30.47° | **44.47°（劣化）** | 30.47°（无回归） |
| 左胸上 f45 / f75 | 19.9 / 28.8 | - | 19.9 / 28.8 |
| 右胸上 f45 / f75 | 9.8 / 76.4 | - | 9.8 / 76.4 |
| スカート_0_1 f30/f45/f75 | 33.7 / 35.6 / 4.8 | - | 33.7 / 35.6 / 4.8 |

## sweep 数据（6 组独立 bake，禁累积修改）

errSum = 左/右胸上 f45/f75 + スカート_0_1 f30/f45/f75 的 |ours−MMM| 之和（轮2 基线 358.7）：

| 组合 | 左胸 f45/f75 | 右胸 f45/f75 | 裙 f30/f45/f75 | errSum |
|---|---|---|---|---|
| baseline（smoothing off） | 19.9 / 28.8 | 9.8 / 76.4 | 33.7 / 35.6 / 4.8 | **358.7** |
| steps=2 | 56.1 / 49.9 | 56.8 / 21.6 | 38.6 / 36.7 / 16.4 | 364.2 |
| steps=3 | 106.3 / 52.7 | 36.3 / 68.8 | 40.6 / 35.7 / 27.2 | 625.5 |
| steps=6 | 58.6 / 170.1 | 45.9 / 90.4 | 25.1 / 24.1 / 105.4 | 719.4 |
| steps=3 move=0.3 | - | - | - | 568.5 |
| steps=3 angle=45 | - | - | - | 625.5 |

观察：
- **所有 smoothing 档 errSum ≥ 基线 358.7**，无任何一档改善
- `steps=3 angle=45` 与 `steps=3` 完全相同 → angle 阈值 8° 几乎从不触发（骨骼角度变化普遍 >8° 或位移触发主导）
- 左/右胸 f45/f75 全部劣化（插值引入的相位滞后让 tuned 弹簧（damping 0.85 / stiffness ÷1000）驱动相位错位）
- 裙子摆幅没有改善（35.6° 摆幅仍不足，深层裙关节能量分配问题依旧）

## 结论与原因分析

**Step 3 对本 bake 无增益，已回滚**（`kinematicSmoothing.enabled=false`；代码保留在 bake 脚本，按需可重开，但不影响默认路径）。

根因：**物理演算频率不匹配**。
- MikuMikuPhysics：固定步长 120Hz × 8 substeps = **960Hz**，kinematic smoothing 在每 substep 前插值，steps=12 时 lag 仅 12 substeps ≈ 12.5ms，几乎无感知；
- 本 bake：`unitStep≈1/65`（65Hz），每帧（1/30s）只有 ~2 个 Bullet substep，却把「1/steps 距离」按帧应用（每帧只走 1/12 或 1/3），相当于给 kinematic 刚体注入几十 ms 的相位滞后 → 与 tuned 弹簧参数冲突 → 胸部跟踪误差放大、深层裙关节能量分配更乱。

MikuMikuPhysics 的 960Hz 是它的参数（STOP_ERP/springDamping 等）配套的演算层；我们已对齐参数层（轮1/2），但物理频率仍 65Hz——**要把 smoothing 用起来，需要把 bake 物理频率提到 ~960Hz 并重新 sweep 全部参数**，这超出了轮3 范围（且会推翻轮1/2 已调优参数），需单独评审。

## 全量验证（回滚后最终态）

- verify V1-V6：**全 PASS**（V6 确定性通过，非 SKIP；163/163 重合率 1.0）
- median 角差：**30.47°**（无回归，未达 ≤20° 目标）
- 左胸上 f75 28.8° ✅（≤50）、右胸上 f45 9.8° ✅（≤20）、裙子 f45 35.6° ❌（目标 ≥60°，极限仍 ~36°）
- BDD：12/12 全绿
- tsc：0 错误（本次改动仅 .mjs/.json，无 TS 新增）

## 遗留事项

1. 裙子摆幅不足 + 深层裙关节能量分配（107° vs MMM 37°）为求解器级问题，**禁令，另行评审**
2. median 30.47° 距 ≤20° 差 10°，需 Step 4/5 或求解器级改动
3. 若想真正启用 kinematic smoothing：bake 物理频率需提升至 ~960Hz 并全参数重 sweep（独立任务）
4. `scripts/fix5-sweep-kinematic.mjs` 保留，可复跑任意 smoothing 参数组合
