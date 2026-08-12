# blender_mmd_tools 用于 VMD 物理烘焙 — 可行性研究报告

> **日期**: 2026-08-07
> **关联**: `packages/mmd_tool/src/tool/bake-physics.mjs`（现有 Ammo.js 烘焙工具）
> **前置**: MMM 插件自动化路线已证伪（`mmm-plugin-automation-feasibility.md`）
> **结论**: **部分可行 — 需大量自研代码填补刚性体→骨骼→VMD 转换链路，且物理质量不如 MMD 原生引擎**

---

## 1. blender_mmd_tools 能力盘点

### 1.1 基本信息

| 项目 | 内容 |
|------|------|
| **仓库** | `UuuNyaa/blender_mmd_tools`（GitHub，原 `MMD-Blender/blender_mmd_tools` 存档） |
| **Blender Extensions** | [extensions.blender.org/add-ons/mmd-tools](https://extensions.blender.org/add-ons/mmd-tools/) |
| **当前版本** | **v4.5.13**（2026-06 发布） |
| **Blender 要求** | Blender 4.2+ LTS |
| **下载量** | 516k+ |
| **许可证** | GPLv3 |
| **语言** | Python（Blender add-on API） |

### 1.2 PMX 导入/导出 ✅

- **导入模式**: MESH、ARMATURE、PHYSICS、DISPLAY、MORPHS（可多选）
- **骨骼转换**: PMX 骨骼 → Blender Armature bones，保持层级关系
- **刚体转换**: PMX 刚体（491 个 for Xiaye1）→ Blender Rigid Body Objects（Sphere/Box/Capsule 形状）
- **约束转换**: PMX 约束（Joint）→ Blender Generic Spring Constraints
- **Morph 转换**: PMX morph → Blender Shape Keys
- **导出**: 支持从 Blender Armature + Mesh 导出 PMX

### 1.3 VMD 导入/导出 ✅

- **导入**: VMD 骨骼动画 → Blender Action（bone keyframes）；morph → Shape Key 动画；camera/light 动画
- **坐标系处理**: 内置 BoneConverter 处理 MMD（右手系 Y-up）↔ Blender（右手系 Z-up）坐标转换
- **NLA 支持**: 可导入到 NLA Track 或 Action Editor
- **导出**: 从 Armature Action + Mesh Shape Key 数据导出 VMD

### 1.4 物理相关功能 ⚠️

这是本报告的关键部分。blender_mmd_tools 提供以下物理功能：

| 功能 | 对应代码 | 状态 |
|------|----------|------|
| PMX 刚体 → Blender rigid body | `mmd_tools/core/rigid_body.py` `FnRigidBody` | ✅ 完整 |
| PMX 约束 → Generic Spring 约束 | `mmd_tools/core/rigid_body.py` joint 处理 | ✅ 基本完整 |
| 物理缓存烘焙 | `mmd_tools/operators/rigid_body.py` `RigidBodyBake` | ✅ 有（Blender native bake） |
| 刚体→骨骼动画回写 | **不存在** | ❌ **缺失** |
| 物理模拟→VMD 导出 | **不存在** | ❌ **缺失** |
| 头部自动化（CLI） | 需要自写脚本 | ⚠️ 理论上可行 |

**插件自带的 `RigidBodyBake` 操作符**（`mmd_tools.ptcache_rigid_body_bake`）调用的是 Blender 原生的 `bpy.ops.ptcache.bake()`，仅缓存刚性体位置/旋转数据。**插件没有任何代码将缓存的刚性体动画转为骨骼动画并导出 VMD。**

### 1.5 官方文档对物理的限制说明 🚨

插件 README（[GitHub](https://github.com/UuuNyaa/blender_mmd_tools)）在 "Known Issues" 章节明确指出：

> **Rigid Body Physics Limitations**:
> - Blender 的 rigid body 系统容易崩溃，性能不如 MMD
> - Blender 缺少 collision mask 功能
> - **MMD 使用 Bullet 2.75 的 "软" 约束**（locked 状态下刚体仍有弹性移动），而 **Blender 使用新版 Bullet 的 "硬" 约束**（locked 状态下刚性体被严格固定）
> - **MMD Tools 无法完全复现 PMX 物理的原始行为**
> - **胸部物理（breast physics）模拟结果与 MMD 存在明显差异**
> - **推荐使用 MMDBridge 替代 Blender 的 Rigid Body World**

这是来自**插件作者本人**的正式声明，对"用 Blender 内置物理仿真 PMX 物理"这件事有根本性的否定。

---

## 2. Blender 物理烘焙链路评估

### 2.1 完整链路的理论路径

```
PMX+VMD 加载 → 刚性体世界构建 → 物理模拟 N 帧 → 刚性体位置逐帧读取 → 骨骼pose回写 → VMD导出
```

### 2.2 各环节实现状态

| 环节 | 现有 API/代码 | 状态 |
|------|--------------|------|
| ① PMX + VMD 加载 | `bpy.ops.mmd_tools.import_model()` + `import_vmd()` | ✅ 现成 |
| ② 刚性体世界构建 | `mmd_tools.core.rigid_body.FnRigidBody` | ✅ 现成 |
| ③ 物理模拟 N 帧 | `bpy.context.scene.frame_set(f)` + 逐帧 step | ⚠️ 需自写 |
| ④ 刚性体位置读取 | `obj.matrix_world` 逐帧读 | ⚠️ 需自写 |
| ⑤ 骨骼 pose 回写 | 刚性体→骨骼映射 + `pose_bone.rotation_quaternion` 写关键帧 | ❌ **完全需要自己写** |
| ⑥ VMD 导出 | `bpy.ops.mmd_tools.export_vmd()` | ✅ 现成 |

**关键缺失项是 ⑤**，这需要：
1. 理解 PMX 刚性体→骨骼的绑定关系（`bone.rigid_body_index`）
2. 理解关节→骨骼的约束链
3. 逐帧将刚性体世界变换转换为骨骼局部旋转四元数
4. 写回 Blender Action（F-Curves）

### 2.3 约束兼容性问题（硬伤）🚨

这是本路线最根本的限制。blender_mmd_tools 源码 `mmd_tools/core/rigid_body.py` 中有明确注释：

```python
# MMD uses Bullet 2.75 whose constraint uses "soft" limits.
# "Soft" limits allow rigid bodies to move elastically even when locked
# (joint rotations reach limit -> rigid body moves instead of stopping).
# Blender uses newer Bullet with "hard" constraints where locked rigid bodies
# are strictly fixed. This causes breast physics to behave differently.
```

**这意味着即使完成全链路，胸部物理的模拟结果也不会和 MMD 一致。** —— 这与现有 Ammo.js 方案的瓶颈是同一个维度的问题（都是 Bullet 不同版本行为差异）。

不过，和现有 Ammo.js 方案相比：
- Ammo.js 是 Bullet 2.82（也有约束差异）
- Blender 是较新的 Bullet 3.x（依然不同）
- **两者都不等于 MMD 的 Bullet 2.75**，但 Ammo.js 的三层手动模拟（spring → linear → angular）我们已经针对裙子调过了，而 Blender 需要重新摸索

### 2.4 社区方案检索

#### 明确找到的：

| 方案 | 描述 | 适用性 |
|------|------|--------|
| **MMDBridge** | `rintrint/mmdbridge` — MMD 插件，桥接 MMD 物理引擎到 Blender | ⚠️ 需要 MMD 运行（GUI），非 headless。输出 Alembic 动画缓存到 Blender |
| **blender_mmd_tools 自带的 RigidBodyBake** | 调 Blender 原生 `ptcache.bake()` | ❌ 只缓存刚性体，不走骨骼→VMD |

#### 未找到的：

| 搜索主题 | 结果 |
|----------|------|
| "blender mmd physics bake VMD" | 无现有工具/脚本 |
| "mmd physics bake blender headless" | 无公开方案 |
| "blender rigid body bake to armature" | 无 MMD 特化方案（有 Blender 通用方案但需自己适配） |
| 专用 bake 插件（mmd-blender-physics 等） | **不存在** |

**结论：社区没有现成的 "MMD 物理烘焙到 VMD" Blender 插件或脚本。这是一个需要从零开发的方案。**

### 2.5 Headless 模式可行性

Blender 的 headless 模式（`blender -b --python script.py`）理论上支持：
- 文件加载/保存 ✅
- 物理模拟 ✅（只需 scene 存在，不需要 UI）
- Python API 全功能 ✅

**已知坑：**
- 需要设置 `bpy.context.scene.frame_set()` 确保物理正确步进
- 物理模拟可能需要先 `bpy.ops.rigidbody.world_add()` 初始化场景
- MMD Tools 部分操作符需要 context 检查（`operator_context_override`），headless 可能报 context 错误——需实测

---

## 3. 本机环境检测

### 检测命令及结果

```powershell
where.exe blender       # 无输出 — 不在 PATH
Get-Command blender     # 命令不存在
Test-Path "C:\Program Files\Blender Foundation\Blender*\blender.exe"  # 无匹配
Get-ChildItem "C:\Program Files\Blender Foundation" -Recurse -Filter "blender.exe"  # 无输出
```

**结论：本机未安装 Blender。**

### 安装评估

| 项目 | 内容 |
|------|------|
| Blender 官方 | [blender.org/download](https://www.blender.org/download/) |
| 最新版本 | 4.2+ LTS（符合 blender_mmd_tools 要求） |
| Windows 安装包大小 | ~320MB |
| 绿色版（Portable） | 支持（解压即用，不写注册表） |
| 安装方式 | 官方安装包或 Steam 版或 Scoop（`scoop install blender`） |
| `blender -b --python` | 绿色版和安装版均支持 headless CLI |

---

## 4. 可行性结论

### 分级：**部分可行（Partially Feasible）**

| 维度 | 评估 |
|------|------|
| PMX/VMD 导入导出 | ✅ 现成（blender_mmd_tools 完整支持） |
| 刚性体构建 | ✅ 现成（`FnRigidBody` 从 PMX 构建 Blender rigid body world） |
| 头部自动化 | ✅ 可行（`blender -b --python script.py`） |
| 物理模拟 | ⚠️ 可工作但质量不匹配 MMD（硬约束 vs 软约束，README 明确声明） |
| 刚性体→骨骼回写 | ❌ **不存在**，需从零开发 Python 脚本（估计 200-400 行） |
| 骨骼→VMD 导出 | ✅ 现成（`bpy.ops.mmd_tools.export_vmd()`） |
| 社区方案 | ❌ 无现成的 Blender MMD 物理烘焙方案 |

### 若投入实施，需要开发的 Python 脚本

```python
# 伪代码骨架（headless Blender Python script）
import bpy
import mathutils

# 1. 清理场景
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# 2. 导入 PMX + VMD
bpy.ops.mmd_tools.import_model(filepath=pmx_path, types={'MESH','ARMATURE','PHYSICS','MORPHS'})
bpy.ops.mmd_tools.import_vmd(filepath=vmd_path)

# 3. 设刚性体世界
armature = bpy.data.objects['Armature']  # 假设名
# 刚性体由 import_model 自动创建，配 Generic Spring 约束
# scene.rigidbody_world 需已存在

# 4. 运行物理模拟逐帧
for frame in range(start_frame, end_frame + 1):
    bpy.context.scene.frame_set(frame)
    # 物理模拟自动推进（rigid body cache 逐帧 bake）

# 5. 刚性体→骨骼回写（核心缺失环节——需要自己写）
rigid_body_to_bone_map = {}  # 需从 PMX 数据中构建
for frame in range(start_frame, end_frame + 1):
    bpy.context.scene.frame_set(frame)
    for rb_name, bone_name in rigid_body_to_bone_map.items():
        rb_obj = bpy.data.objects[rb_name]
        bone = armature.pose.bones[bone_name]
        # 将 rigid body 的世界变换转为骨骼局部旋转
        # 需要考虑 parent bone 的变换链
        bone.rotation_quaternion = compute_local_rotation(rb_obj, bone)
        bone.keyframe_insert(data_path='rotation_quaternion', frame=frame)

# 6. 导出烘焙 VMD
bpy.ops.mmd_tools.export_vmd(filepath=output_path, model=armature)
```

**核心开发量估计：**
- PMX 刚性体→骨骼映射逻辑：~100 行（需理解 `FnRigidBody` 的创建逻辑）
- 骨骼局部旋转计算（考虑父子变换链）：~100 行
- 逐帧 bake + F-Curve 写回：~50 行
- 边界情况处理（非物理骨骼保留原动画、morph 保留等）：~100 行
- 测试调试验证：大量时间

### 与现有 verify-bake.mjs 的衔接

Blender 方案输出的 VMD 可以无缝接入现有验证体系：

```bash
# 现有流程
node bake-physics.mjs [--config bake-config.json]
node verify-bake.mjs [--output output/pickup_bake.vmd --vmd-raw ... --mmm ...]

# Blender 方案（输出同路径）
blender -b --python mmd_bake.py -- output/pickup_bake.vmd
node verify-bake.mjs --output output/pickup_bake.vmd --vmd-raw ... --mmm ...
```

VMD 格式相同，验证框架（V1-V6 断言 + MMM 对比）可直接复用。唯一需要确认的是 Blender 产出的 VMD 骨名编码（SJIS/UTF-8）与现有工具一致。

---

## 5. 三方案对比表

| 维度 | **现有 Ammo.js** | **blender_mmd_tools** | **MMM 手工/MMDBridge** |
|------|-----------------|----------------------|----------------------|
| **自动化程度** | ✅ 全自动（Node CLI） | ⚠️ 半自动→全自动（需开发 ~400 行 Python） | ❌ 手工 / 半自动（MMDBridge 需 GUI） |
| **物理质量** | ⚠️ 裙子 35.6° vs MMM 87-96° | ⚠️ README 声明无法复现，胸物理明显差异 | ✅ MMD 原生物理引擎（参考标准） |
| **约束兼容性** | Bullet 2.82，三层手动模拟 | Bullet 3.x，"硬"约束→软约束转换失败 | Bullet 2.75，"软"约束（原生） |
| **开发量** | 已完成（594 行 .mjs） | **需新开发**：刚性体→骨骼回写 (~400 行 Python) + 调参 | 0（已有流程） |
| **依赖** | Node + ammo.js（0 安装） | Blender 4.2+（~320MB 安装） | MMM 软件（仅 Windows） |
| **维护成本** | 低（自研代码） | 中（依赖 blender_mmd_tools 上游更新 + 自研代码） | 中（MMM 版本迁移） |
| **社区活跃度** | —（自研） | 高（516k 下载、持续更新） | 低（MMM 已停更，MMDBridge v0.7.1 有 bug） |
| **头部可自动化** | ✅ 天然 | ✅ `blender -b --python` | ❌ 不可（GUI 依赖） |
| **输出 VMD 验证** | ✅ verify-bake.mjs 完整覆盖 | ✅ VMD 格式相同，直接用现有验证 | ✅ 参考标准 |

---

## 6. 基于 "约束兼容性是最关键瓶颈" 的新视角

### 6.1 核心问题定义

现有 Ammo.js 方案的 **根本瓶颈不是模拟引擎不够好，而是 Bullet 版本差异导致约束行为不同**：
- MMD 用 Bullet 2.75 的 "软极限"（soft limit）—— 约束到达极限后刚性体弹性移动
- Ammo.js（Bullet 2.82）和 Blender（Bullet 3.x）都用了 "硬极限"（hard limit）—— 约束到达极限后刚性体刚性停止

这个差异直接影响裙子摆动幅度（35.6° vs 87-96°），且已在 5 轮 sweep 全参数被压在 34-38° 范围内，结论是 **Three.js MMDPhysics 弹簧约束模型的结构性限制**。

### 6.2 Blender 方案能否解决这个问题？

**大概率不能。** 同一 repo 的 README 明确写了约束兼容性差异，并给出了 workaround（但承认不完美）。这意味着：
- Blender 方案几乎肯定会遇到同样的约束行为差异
- 物理模拟质量可能和现有 Ammo.js 方案处于同一水平（甚至更差，因为没调过参）

**除非**能在 Blender 层面模拟 "软极限" 行为，但这需要对 Blender 约束设置进行深度 hack（可能改动 constraint 的 `use_limit` + 自定义 force field 等），这不在 blender_mmd_tools 的范围内。

### 6.3 这条路真正的价值在哪？

如果 Blender 方案投入开发，主要收益不是物理质量提升，而是：
1. **多一个工具链选项**：Baramz 场景 → Blender 中间层 → PMX/VMD 输出（目前项目用 Baramz→PMX 转换，Blender 可能是更好的中间层）
2. **更大的生态**：Blender 社区有大量动画/物理/渲染工具，可能找到新的约束调参思路
3. **可视化调试**：Blender 的 GUI 模式可以直观看到物理模拟过程，比 Ammo.js 的纯数值调试高效

---

## 7. 最终建议

### 一句话结论

**blender_mmd_tools 提供了 PMX/VMD IO + 刚性体构建的轮子，但"物理烘焙→骨骼 VMD"的核心链路缺失（需从零开发 ~400 行 Python），且 Blender 内置物理引擎的约束模型与 MMD 不兼容（与现有 Ammo.js 方案同源瓶颈），不推荐作为解决裙子摆动幅度的方向。**

### 关键证据（3 条）

1. **blender_mmd_tools README 官方声明**：Blender rigid body physics "can't reproduce PMX physics exactly as they behave in MMD" + 约束兼容性差异 + "breast physics simulation doesn't closely match MMD behavior" + 推荐 MMDBridge 替代（[GitHub 原文](https://github.com/UuuNyaa/blender_mmd_tools)）
2. **源码确认无刚性体→骨骼回写代码**：`mmd_tools/operators/rigid_body.py` 只有 `RigidBodyBake`（缓存刚性体），没有骨骼动画回写操作符；`mmd_tools/operators/fileio.py` 中 `ExportVmd` 从 Action 读数据，与刚性体无关
3. **社区无现有方案**：搜索 "blender mmd physics bake VMD" 无找到任何工具/脚本；`MMDBridge` 是唯一边界方案但依赖 MMD GUI

### 推荐下一步

**优先级 1：深挖 Ammo.js 约束底层，尝试将 "硬极限" 改为 "软极限" 或模拟软约束行为。**
这是从 root cause 解决问题的唯一途径：
- 如果是 Ammo.js/Bullet 的 constraint 里 `NNCONTACT/FM_ACCELERATION` 相关参数不对，可以 patch
- 如果是 SpringConstraint 内部 `limitSoftness` 参数没有暴露，可以从 Ammo.js 源码层面补充绑定
- 三周前 fix-5 的结果已经显示 solerIterations/gravity 调参无效，说明问题不在参数而在约束模型本身

**优先级 2（如果优先级 1 走不通）：直接用 MMM 的 Bullet 2.75 DLL，绕过 Ammo.js。**
- MMM 安装目录的 `BulletPhysics*.dll` 包含原生 Bullet 2.75 引擎
- 通过 Node FFI（`ffi-napi` / `koffi`）直接调用原生 DLL 的物理模拟
- 这会完全解决约束兼容性问题，因为使用了和 MMM 完全相同的物理引擎
- 开发量比 Blender 方案小得多（复用现有的 PMX 解析 + VMD 写入，只替换模拟引擎部分）

**优先级 3（备用）：Blender 方案**——如果前两条都走不通且项目未来确实需要 Blender 中间层，再考虑投入。

---

## 参考资料

- [blender_mmd_tools GitHub](https://github.com/UuuNyaa/blender_mmd_tools)
- [blender_mmd_tools Blender Extensions](https://extensions.blender.org/add-ons/mmd-tools/)
- [MMDBridge GitHub](https://github.com/rintrint/mmdbridge)
- 本项目现有 `bake-physics.mjs`（594 行，Ammo.js 离线烘焙）
- 本项目 `research.md`（VMD 物理烘焙研究与可行性验证）
- 本项目 `mmm-plugin-automation-feasibility.md`（MMM 插件自动化路线已证伪）
