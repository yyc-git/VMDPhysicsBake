# fix5-ammo-api-verify.md — Ammo.js ERP/CFM API 运行时确认

日期：2026-08-06（fix5 轮 1，Step 1）

## 目标

方案文档（mmd-physics-alignment-plan.md）假设 Bullet 参数编号：
`BT_CONSTRAINT_STOP_ERP=3`、`BT_CONSTRAINT_STOP_CFM=4`、`BT_CONSTRAINT_ERP=5`、`BT_CONSTRAINT_CFM=6`。
该编号需在 ammo.js 运行时验证，否则 setParam 写错槽位无效果。

## 验证方法

`packages/mmd_tool/scripts/fix5-ammo-api-check.mjs`：构造 `btGeneric6DofSpringConstraint`（含 2 个 btRigidBody + btSphereShape），
对 num=1..8 每个参数 `setParam(num, feature, axis)` 后 `getParam(num, axis)` 读回，对比写读一致性。

## 确认表（实测结果）

| num | getParam 默认值 | setParam 特征值 | getParam 读回 | 判定 | Bullet 语义 |
|-----|---------------|----------------|---------------|------|-------------|
| 1   | 0             | 0.12445        | 0             | 无效果 | BT_CONSTRAINT_ERP（6Dof 不生效） |
| 2   | **0.2**       | 0.12545        | 0.125450      | ✔ 可用且读回一致 | **BT_CONSTRAINT_STOP_ERP** |
| 3   | 0             | 0.12645        | 0.126450      | ✔ 可用且读回一致 | **BT_CONSTRAINT_CFM** |
| 4   | 0             | 0.12745        | 0.127450      | ✔ 可用且读回一致 | **BT_CONSTRAINT_STOP_CFM** |
| 5   | 0             | 0             | 0             | 无效果 | （超出 6Dof 范围） |
| 6   | 0             | 0             | 0             | 无效果 | — |
| 7   | 0             | 0             | 0             | 无效果 | — |
| 8   | 0             | 0             | 0             | 无效果 | — |

逐轴检查（num=3/4/5/6，axis 0..5 全部 set+读回）：
- num=2：所有轴可写可读，默认 0.2（Bullet STOP_ERP 默认值一致）
- num=3：所有轴可写可读，默认 0
- num=4：所有轴可写可读，默认 0
- num=5/6：无任何轴生效

## 关键交叉验证

`MMDPhysics.js`（three.js）L1290-1298 现有代码对所有 constraint 调 `setParam(2, 0.475, i)`，
注释为「physics will be more like MMD's」。运行时实测 num=2 默认 0.2 且可写可读 —— 与上述结论互证，
**num=2 确为 BT_CONSTRAINT_STOP_ERP**，MMDPhysics 用它把默认 0.2 抬到 0.475。

## 结论（推翻方案假设）

- 方案假设 `STOP_ERP=3 / CFM=6` **错误**。实测为经典 Bullet 编号：
  **STOP_ERP=2、CFM=3、STOP_CFM=4**，`ERP=1`（6Dof 无效果）。
- 本项目要用的是 **锁定轴的 STOP_ERP/STOP_CFM**（即 MikuMikuPhysics 的 locked_joint_stop_erp/cfm）：
  `setParam(2, 0.2, axis)` + `setParam(4, 0.0002, axis)`。
- 覆盖语义：MMDPhysics 已对所有轴 set STOP_ERP=0.475，bake-physics.mjs 在构造后对锁定轴**覆盖为 0.2**
  （覆盖发生在 MMDPhysics 之后，实测确认生效）。

## 落地映射（bake-physics.mjs L224-254）

```js
const LOCKED_STOP_ERP = 0.2;      // locked_joint_stop_erp
const LOCKED_STOP_CFM = 0.0002;   // locked_joint_stop_cfm
// 锁定轴判定：linear lower==upper（i<3）或 angular lower==upper（i>=3）
//   setParam(2, LOCKED_STOP_ERP, i)   // STOP_ERP
//   setParam(4, LOCKED_STOP_CFM, i)   // STOP_CFM
```

锁定轴判断字段：`p.translationLimitation1[i] == p.translationLimitation2[i]`（线性）、
`p.rotationLimitation1[i-3] == p.rotationLimitation2[i-3]`（角度）。
