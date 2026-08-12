# MMM 插件自动化物理烘焙可行性研究报告

**日期**: 2026-08-07  
**研究者**: OpenCode (deepseek-v4-pro)  
**状态**: 研究完成  
**结论**: **不可行**（插件 API 缺少文件 I/O 和物理烘焙触发能力；无 headless 模式；SendKeys 自动化可行但脆弱且不可靠）

---

## 1. MMM 环境概览

| 项目 | 信息 |
|------|------|
| 软件版本 | MikuMikuMoving v1.2.9.2 (2018/06/03) |
| 运行时 | .NET Framework 4.6.1 (exe.config 声明 4.0) |
| 安装方式 | Green software (portable, no install) |
| 物理引擎 | BulletSharp.dll (.NET wrapper around Bullet Physics) |
| 插件系统 | C# DLL, 接口定义于 `MikuMikuPlugin.dll` |
| API 文档 | `D:\MMM\System\MikuMikuPlugin.xml` (3234 行 C# XML doc) |

---

## 2. MMM 插件 API 能力盘点

### 2.1 插件类型与生命周期

API 定义了 6 种插件接口（`MikuMikuPlugin.xml` L3095–L3211）：

| 接口 | 说明 | 生命周期方法 |
|------|------|------------|
| `IBasePlugin` (L3095) | 基础接口 | `GUID`, `Description`, **`ApplicationForm`**(获取主窗口 Form) |
| `IButtonPlugin` (L3115) | 按钮显示 | `Text`, `EnglishText`, `Image` |
| `IHaveScenePlugin` (L3140) | 场景访问 | `Scene` 属性 (get/set) |
| `ICommandPlugin` (L3177) | 命令执行 | `Run(CommandArgs, ref bool Cancel)` — 用户点击触发 |
| `IResidentPlugin` (L3187) | 常驻插件 | `Initialize(IPluginHost)`, `Enabled`, `Disabled`, **`Update(float Frame, float ElapsedTime)`** |
| `ICanSavePlugin` (L3150) | 存档钩子 | `OnSaveProject() → Stream`, `OnLoadProject(Stream)` |

**关键发现**：
- ✅ `IResidentPlugin.Update()` 每帧回调，可实时读写 bone motion（证据：SampleResidentPlugin.cs L85–L147）
- ✅ `IHaveScenePlugin` 提供 `Scene` 访问（场景模型/骨骼/相机/灯光集合）
- ✅ `IBasePlugin.ApplicationForm` 暴露主窗口 Form 句柄 — **SendKeys 自动化入口点**

### 2.2 文件 I/O 能力

**❌ 无 PMX 加载 API。**
全量搜索 `MikuMikuPlugin.xml` 无任何 `LoadFile`, `ImportFile`, `OpenFile`, `FileDialog`, `AddModel`, `FileName`, `FilePath` 接口。

**❌ 无 VMD 加载 API。**
全量搜索无 `LoadMotion`, `ImportMotion`。

**❌ 无 VMD 导出 API。**
全量搜索无 `SaveMotion`, `SaveVMD`, `ExportMotion`, `ExportFile`。

**唯一文件操作**：`ICanSavePlugin.OnSaveProject()` / `OnLoadProject()` — 仅读写 `.pmm` 项目文件中插件自定制的二进制数据（证据：SampleSavePlugin.cs），**不是** VMD 或 PMX。

### 2.3 物理烘焙 API

**❌ 无物理烘焙触发 API。**
`SceneState.PhysicsBaking` (L554) 仅是**枚举值** — 表示当前场景状态，不是方法。

| 枚举值 | 值 | 含义 |
|--------|-----|------|
| `Editing` | 0 | 编辑模式 |
| `Playing` | 1 | 播放模式 |
| `KinectCapturing` | 2 | Kinect 捕捉 |
| **`PhysicsBaking`** | **3** | 物理烘焙模式 |
| `AVI_Rendering` | 4 | AVI 渲染 |

全量搜索 `StartBaking`, `StopBaking`, `RecordPhysics`, `StartRecord`, `StopRecord` — **零结果**。插件无法程序化进入/退出物理烘焙模式。

**MMM Readme** (`D:\MMM\Readme_ENG.txt`) 多次提及 "Record Physics" 作为 UI 功能（L354: selected bones only option with Physics Recording; L599: Adjust about Physics and Recording physics functions; L712: Start frame is current frame / Add Record Physics between bookmarks），但这些是 **MMM GUI 内置功能**（菜单 → Play → Record Physics），不是插件 API。

### 2.4 场景 & 模型读取能力

#### Scene API (L2883–L3017)
```
Scene.Models          → ModelCollection (只读)
Scene.Accessories     → AccessoryCollection
Scene.Cameras         → CameraCollection
Scene.Lights          → LightCollection
Scene.Effects         → EffectCollection
Scene.Captions        → CaptionCollection
Scene.State           → SceneState (get/set?)
Scene.Mode            → ScenePlayMode
Scene.ActiveModel     → Model
Scene.MarkerPosition  → float (当前帧位置)
Scene.ScreenSize      → Vector2
Scene.KeyFramePerSec  → int (关键帧/秒, 默认 30)
Scene.AudioTracks     → AudioTrackCollection
Scene.Bookmarks       → BookmarkCollection
Scene.PropertyFrames  → SceneFrameCollection (场景属性帧)
```

**关键**：`Scene.Models` 只读 — 即插件只能**枚举已加载**的模型，不能**添加新模型**。

#### Model API (L2413–L2528)
```
Model.Bones                    → BoneCollection (只读)
Model.Morphs                   → MorphCollection (只读)
Model.Materials                → MaterialCollection (只读)
Model.DisplayFrame             → DisplayFrame (只读)
Model.PropertyFrames           → ModelPropertyFrameCollection (可读写)
Model.Name / EnglishName       → string (只读)
Model.GUID / ID                → Guid (只读)
Model.InsertColumn(ColumnType) → IColumn
Model.RemoveColumn(IColumn)
```
**只有属性/列操作，无文件 I/O。**

#### Bone API (L1542–L1670)
```
Bone.CurrentLocalMotion(out MotionData)  → 当前帧骨骼运动
Bone.BoneID / Name / EnglishName        → 标识
Bone.ParentBoneID / LinkBoneID          → 层级
Bone.InitialPosition                    → 初始位置
Bone.BoneFlags                          → 骨骼标志
Bone.Layers / SelectedLayers            → MotionLayerCollection
Bone.AddLayer(IBoneLayer) / RemoveLayer(IBoneLayer)
```

#### MotionLayer API (L2848–L2882)
```
MotionLayer.CurrentLocalMotion  → MotionData (当前帧)
MotionLayer.Frames              → MotionFrameCollection (可读写)
MotionLayer.LayerID / Name      → 标识
MotionLayer.Selected            → bool
```

**MotionFrameCollection 可写**：
```
AddKeyFrame(MotionFrameData)      → void  (添加关键帧)
GetFrame(float Frame)             → MotionFrameData
GetKeyFrames()                    → MotionFrameData[]
ReplaceAllKeyFrames(...)          → void  (批量替换)
RemoveKeyFrame(float Frame)       → void
```

**MotionFrameData** (L809–L860)：
```
FrameNumber : float
Position    : Vector3
Quaternion  : Quaternion
InterpolXA-XB / YA-YB / ZA-ZB / RA-RB : byte[] (插值曲线)
Clone()     → MotionFrameData
```

### 2.5 模型属性帧 (Physics 标志)

#### ModelPropertyFrameData (L1030–L1064)
```
FrameNumber       : float
Selected          : bool
Visible           : bool
AddBlending       : bool
Shadow            : bool
Physics           : bool      ← 物理开关 (L1046)
PhysicsStillMode  : bool      ← 物理静止模式 (L1049)
```

#### ModelPropertyFrameCollection (L2487–L2545)
```
AddKeyFrame(ModelPropertyFrameData) → void
GetFrame(float Frame)               → ModelPropertyFrameData
RemoveKeyFrame(float Frame)         → void
GetKeyFrames()                      → ModelPropertyFrameData[]
```

**结论**：插件可以**读写**每个模型的逐帧 Physics/PhysicsStillMode 标志。

### 2.6 BoneType.TransformAfterPhysics (L618)

```xml
<member name="F:MikuMikuPlugin.BoneType.TransformAfterPhysics">
  <summary>物理後変形</summary>
</member>
```
`Bone.BoneType = TransformAfterPhysics` 时该骨骼的 `CurrentLocalMotion` 返回物理计算后的值。这个标志存在于数据层，但**没有插件 API 可以设置或触发它** — 它由 MMM 内部物理引擎在生产时自动处理。

---

## 3. Sample 插件源码骨架分析

### 3.1 项目结构

从 `D:\MMM\Plugins\Sample\SampleCommandPlugin_20180525.zip` 提取（5 个完整示例）：

| 插件 | 接口 | 行数 | 核心功能 |
|------|------|------|---------|
| `SampleCommandPlugin.cs` | `ICommandPlugin` | 117 | 读取 ActiveModel.Bones.CurrentLocalMotion，修改 morph 权重 |
| `SampleResidentPlugin.cs` | `IResidentPlugin` | 230 | 每帧 Update() 枚举模型/骨骼/相机，读写 bone rotation |
| `SampleSavePlugin.cs` | `ICommandPlugin` + `ICanSavePlugin` | 164 | 保存/加载自定义数据到 .pmm |
| `SampleScenObjPlugin.cs` | `IScenObjPlugin` | 116 | 自定义 2D 屏幕对象 |

### 3.2 编译模板

所有 `.csproj` 使用相同模板：

```xml
<TargetFrameworkVersion>v4.0</TargetFrameworkVersion>
<OutputType>Library</OutputType>
<OutputPath>..\bin\</OutputPath>
<Reference Include="MikuMikuPlugin">
  <HintPath>..\..\System\MikuMikuPlugin.dll</HintPath>
</Reference>
<Reference Include="DxMath">
  <HintPath>..\..\System\DxMath.dll</HintPath>
</Reference>
<Reference Include="System.Drawing" />
<Reference Include="System.Windows.Forms" />
```

**编译需求**：
- `.NET Framework 4.0` 运行时（本机有 — `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` ✅）
- `MikuMikuPlugin.dll` + `DxMath.dll`（MMM 自带）
- `System.Drawing`, `System.Windows.Forms`（.NET Framework 自带）

**没有 MSBuild/Visual Studio Build Tools**，但可以用 `csc.exe` 命令行编译。

### 3.3 关键代码模式

**读取骨骼运动**（SampleCommandPlugin.cs L58–L67）：
```csharp
model.Bones.RootBone.Layers[0].CurrentLocalMotion(out Quaternion rotation, out Vector3 position);
```

**修改骨骼运动**（SampleResidentPlugin.cs L115–L149）：
```csharp
// 注意：ResidentPlugin 修改后下次 Update 会还原，因为读的是 motion data
// Camera/Light 的修改才会持久化（源码注释说明）
Bone bone = model.Bones[index];
MotionData mdata = bone.CurrentLocalMotion;
mdata.Rotation = Quaternion.RotationYawPitchRoll(mdata.Rotation + offset);
// ... 修改后存储在内部，被 MMM 下次播放覆盖
```

**骨骼关键帧写入**需通过 `MotionLayer.Frames.AddKeyFrame(new MotionFrameData(frame, pos, quaternion))`。

**访问主窗体**：
```csharp
Form mainForm = base.ApplicationForm;  // IBasePlugin 属性
```

---

## 4. 自动化链路评估

### 4.1 命令行 / Headless 支持

**❌ 无 headless 模式。**

- `MikuMikuMoving.exe.config` — 仅声明运行时绑定
- `Readme_ENG.txt` + `Readme_JPN.txt` — 无 CLI 参数章节
- 全 Readme 搜索 `Batch`, `Headless`, `Silent`, `NoGUI`, `CommandLine`, `Argument` — 零 CLI 文档
- Readme 历史记录 v1.2.1.6 (L424)：「Open a Model and accessory file as CommandLine Argument」— 仅支持文件关联打开，不是批量模式

**结论**：MMM **必须 GUI 启动**，无 `--batch` 或 `--script` 参数。

### 4.2 SendKeys / Win32 自动化

`IBasePlugin.ApplicationForm` 暴露主窗口 `System.Windows.Forms.Form` 句柄，这意味着：

1. **C# 插件内**可以 `ApplicationForm.BeginInvoke()` 发送 UI 操作
2. **C# 插件**可以使用 `SendKeys.SendWait()` 模拟键盘快捷键
3. **外部脚本**（如 Node.js ffmpeg 风格）可以通过 `FindWindow` + `PostMessage` 控制 MMM

但这面临严重限制：
- MMM UI 无菜单命令 ID 文档 — 需要用 OCR/像素定位确认菜单位置
- 文件对话框交互不稳定（windows 版本/DPI 差异）
- 物理烘焙持续时间不确定 — 需要挂起等待 + 轮询 `Scene.State` 变化

**理论可行，实际脆弱** — 不适合生产环境自动化。

### 4.3 完整自动化流程评估

| 步骤 | 能否自动化 | 方式 | 风险 |
|------|-----------|------|------|
| 1. 启动 MMM | ✅ | `Process.Start()` | 低 |
| 2. 加载 PMX 模型 | ❌ 无 API | SendKeys `Ctrl+O` → 输入路径 → Enter | 高：文件对话框不稳定 |
| 3. 加载 VMD 动画 | ❌ 无 API | SendKeys 菜单操作 | 高：无快捷键文档 |
| 4. 设置 Physics flag | ✅ | 插件 `PropertyFrames.AddKeyFrame()` | 低 |
| 5. 设置 PhysicsStillMode | ✅ | 插件 `PropertyFrames.AddKeyFrame()` | 低 |
| 6. 进入 PhysicsBaking 模式 | ❌ 无 API | SendKeys 菜单 → Play → Record Physics | 高：需定位菜单 |
| 7. 等待烘焙完成 | ⚠️ 半自动 | 插件 `Update()` 轮询 `Scene.State` | 中：需超时机制 |
| 8. 每帧读取物理结果 | ✅ | 插件 `Bone.CurrentLocalMotion` | 低 |
| 9. 写入骨骼关键帧 | ✅ | 插件 `MotionLayer.Frames.AddKeyFrame()` | 低 |
| 10. 导出 VMD | ❌ 无 API | SendKeys 菜单 → File → Export Motion | 高：无 API |
| 11. 退出 MMM | ⚠️ 半自动 | `Process.Kill()` 或 SendKeys `Alt+F4` | 中：可能残留进程 |

**漏斗效应**：10 个步骤中 3 个阻塞点（PMX 加载、VMD 加载、VMD 导出）、1 个高风险步骤（进入烘焙）、2 个 SendKeys 依赖（步骤 2、3、10）。即使写完整插件，仍需要用户手动："加载 PMX → 加载 VMD → 点击 Record Physics → 等完成 → 手动导出 VMD"。

### 4.4 本机编译环境实测

```
dotnet --version      → ✗ dotnet not found (.NET Core SDK 未安装)
csc.exe (Framework64) → ✓ C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
csc.exe (Framework)   → ✓ C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe
MSBuild.exe           → ✗ 未找到 (无 VS Build Tools)
```

**编译命令**（理论，未实测）：
```cmd
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe ^
  /target:library ^
  /out:BakePhysicsPlugin.dll ^
  /reference:D:\MMM\System\MikuMikuPlugin.dll ^
  /reference:D:\MMM\System\DxMath.dll ^
  /reference:System.Drawing.dll ^
  /reference:System.Windows.Forms.dll ^
  BakePhysicsPlugin.cs
```

**评估**：csc.exe 可直接编译 .NET Framework 4.0 DLL，无需 Visual Studio 或 MSBuild。环境可行但只经过静态确认，未实测编译。

---

## 5. 现有 Bake 工具链对比

### 5.1 `bake-physics.mjs` 现状

```
文件：packages/mmd_tool/src/tool/bake-physics.mjs
流程：PMX + VMD → Ammo.js 物理模拟 → VMD 输出
验证：verify-bake.mjs 逐帧比较骨骼角度
```

| 维度 | Ammo.js (现有) | MMM 插件自动化 |
|------|---------------|---------------|
| **物理引擎** | Ammo.js (Emscripten Bullet 2.82) | BulletSharp (C# Bullet, MMM 内建) |
| **自动化程度** | ✅ 完全 CLI 自动化 | ❌ 半自动化 (需 GUI + 手动操作) |
| **输出质量** | ❌ 裙子 35.6° (目标 ≥60°) | ✅ 可达 MMM 质量 (87-96°) |
| **开发成本** | 已完成 (fix1-fix5) | 从零写 C# 插件 + SendKeys 框架 |
| **维护成本** | 低 (纯 JS/Node) | 高 (.NET Framework 4.0 已 EOL, Windows 绑定) |
| **扩展性** | ✅ Node.js 生态，可 CI 集成 | ❌ 绑定 GUI，不可 CI |
| **批量烘焙** | ✅ 脚本批量 | ❌ 逐个手动操作 |
| **可控性** | ✅ 全部参数可控 | ❌ MMM 内部黑盒 |

### 5.2 为什么 Ammo.js 达不到 MMM 质量

`mmd-physics-alignment-plan.md` (路线 C) 已分析：
- three.js `MMDPhysics` 使用**弹簧约束** (`btGeneric6DofSpringConstraint`) 模拟物理
- MMM 的 BulletSharp 直接使用 **Bullet 原生约束**（铰链 + 圆锥 + 滑动）
- 弹簧约束的参数空间被压在 34-38°，参数调优无法弥补结构性差异

**直接调用 MMM** 理论上完美解决物理质量 — 但**自动化门槛太高**。

---

## 6. 可行性结论

### 结论：**部分可行（半自动）** — 不可用于生产自动化

**解释**：
- ✅ C# 插件**可以**读取/写入骨骼关键帧和物理标志
- ✅ C# 插件**可以**每帧回调读取物理计算结果
- ✅ 本机**可以**用 csc.exe 编译 .NET Framework 4.0 DLL
- ❌ MMM API **不支持**程序化 PMX 加载
- ❌ MMM API **不支持**程序化 VMD 加载/导出
- ❌ MMM API **不支持**触发物理烘焙
- ❌ MMM **无** headless/CLI 模式
- ⚠️ SendKeys 自动化理论可行但脆弱（文件对话框跨版本不稳定、菜单位置无文档）

### 关键证据（3 条）

1. **API 文档全量搜索**：`MikuMikuPlugin.xml` (3234 行) 中 `LoadModel`/`LoadMotion`/`SaveMotion`/`StartBaking` 搜索结果全部为空 — 插件系统仅设计用于 UI 编辑辅助，不是批处理流水线
2. **Readme 确认无 CLI**：`Readme_ENG.txt` 唯一相关记录是 v1.2.1.6 "Open a Model and accessory file as CommandLine Argument" — 文件关联打开，不是批量参数
3. **编译环境可行但 EOL**：csc.exe 存在（.NET Framework 4.0），但整个技术栈 2018 年停止维护，无 CI 集成基础

### 建议下一步

1. **接受「部分可行」结论，放弃 MMM 插件自动化路线** — 投入产出比太低，SendKeys 自动化不可维护
2. **回到 Ammo.js 路线并换引擎**：将物理引擎从 `three.js MMDPhysics` 的弹簧约束改为直接用 **Ammo.js 原生约束**（`btHingeConstraint` + `btConeTwistConstraint` + `btSliderConstraint`），模仿 BulletSharp 的工作方式 — 这是路线 C 建议过但未执行的方案
3. **或者**：考虑用 **IKinema**（开源的 MMD IK 工具，已有 CLI）或 **blender_mmd_tools** 作为备选方案

---

## 7. 附录

### A. 搜索方法

| 搜索词 | 工具 | 范围 | 结果 |
|--------|------|------|------|
| `LoadModel\|ImportModel\|AddModel\|OpenFile\|FileOpen\|FileDialog` | grep | MikuMikuPlugin.xml | 0 hits |
| `LoadMotion\|ImportMotion` | grep | MikuMikuPlugin.xml | 0 hits |
| `SaveMotion\|SaveVMD\|ExportMotion\|ExportFile` | grep | MikuMikuPlugin.xml | 0 hits |
| `StartBaking\|StopBaking\|RecordPhysics\|BakePhysics` | grep | MikuMikuPlugin.xml | 0 hits (仅 SceneState.PhysicsBaking 枚举值) |
| `Batch\|Headless\|Silent\|NoGUI\|CommandLine` | grep | MikuMikuPlugin.xml | 0 hits |
| `class Model \|T:MikuMikuPlugin.Model` | grep | MikuMikuPlugin.xml | 1 hit (class 定义 L2413) |
| `.txt` 文件搜索 Physics/bake/record | grep | D:\MMM\ | Readme 历史多次提及 UI 功能 |

### B. 参考文件清单

| 文件 | 路径 |
|------|------|
| API 文档 | `D:\MMM\System\MikuMikuPlugin.xml` |
| MMM 本体 | `D:\MMM\MikuMikuMoving.exe` |
| 配置文件 | `D:\MMM\MikuMikuMoving.exe.config` |
| 英文说明 | `D:\MMM\Readme_ENG.txt` |
| 日文说明 | `D:\MMM\Readme_JPN.txt` |
| 物理引擎 | `D:\MMM\System\BulletSharp.dll` |
| 插件 SDK | `D:\MMM\System\MikuMikuPlugin.dll` |
| 数学库 | `D:\MMM\System\DxMath.dll` |
| 示例插件 ZIP | `D:\MMM\Plugins\Sample\SampleCommandPlugin_20180525.zip` |
| 现有烘焙 | `packages/mmd_tool/src/tool/bake-physics.mjs` |
| 对齐方案 | `笔记/项目文档/changes/2026-08-05-mmd-vmd-unify/analysis/vmd-physics-bake/mmm-physics-alignment-plan.md` |
