# fix5 技能反思（gts-skill-reflect 快速路径）

> 2026-08-06 17:59 · vmd 物理烘焙 fix5 全自动（gts-auto）完成

## 执行概况

- **Issue**: `笔记/项目文档/issue/2026-08-06-VMD_fix5_MikuMikuPhysics_dampi-d139bee2.md`（completed 4/4）
- **Dispatch**: Flash × 3（轮1 amber-ember / 轮2 grand-basil / 轮3 quick-comet）
- **总耗时**: ~2h（16:05 → 17:59）
- **异常**: 0 次 dispatch 失败

## 本次 pitfall（已记录 issue）

- **kinematic smoothing 移植无效**（type: repeated_error, step: B2）
  - MikuMikuPhysics 的 smoothing 是 960Hz substep 级插值；bake 是 65Hz 按帧插值 → 直接移植产生几十 ms 相位滞后
  - sweep 6 档（steps 2/3/6 + move/angle 变体）全部 errSum 变差（基线 358.7 最优）
  - 结论：bake 侧默认关闭 smoothing，除非物理频率提升到 ~960Hz 再重试

## 可复用经验（非通用规则，记 daily log）

1. **参数调优必须真实 bake + 独立进程 sweep**（diag-chest2 简化模型 23° vs 真实 267°，教训延续）
2. **zone rules 机制有效**：单一全局参数无法同时满足不同物理区域（胸 vs 裙），按骨名/刚体名分区是 MikuMikuPhysics 的核心设计，已落地 bake-config.json `zoneRules`
3. **ERP/CFM 编号以运行时实测为准**：方案文档假设 STOP_ERP=3 是错的，实测 STOP_ERP=2/CFM=3/STOP_CFM=4
4. **V6 stale-file 假失败**：修改 config 后 verify 的 V6 会对比磁盘旧产物 → 先重新 bake 再 verify

## 状态

- ✅ 无异常事件，无 skill 修改建议
- 📏 MEMORY.md 大小：待保存时检查
- 结论：快速路径通过，继续通知
