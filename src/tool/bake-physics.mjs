#!/usr/bin/env node
// bake-physics.mjs — VMD 物理烘焙工具（单机版，离线）
// 输入：PMX 模型 + 原始动作 VMD（pickup.vmd）
// 输出：物理骨逐帧烘焙 VMD（pickup_bake.vmd），动作骨关键帧原样保留，morph 原样复制
// 基于 spike2-physics-bake.mjs 重构，见 solution.md §3/§4
import * as THREE from 'three';
import { Skeleton, SkinnedMesh, Bone, BufferGeometry } from 'three';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

// ---- Node ESM hook：lib/ 内 webpack 风格 import + pako 命名导出（见 resolve-ext.mjs / pako-esm-hook.mjs）----
await import('./register-hooks.mjs');

// ---- 路径基准：以本文件所在目录为根，不依赖 cwd ----
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../../');
const resolveFrom = (base, p) => (path.isAbsolute(p) ? p : path.resolve(base, p));

// ---- CLI 解析（--config / --pmx / --vmd / --output 可选覆盖）----
function parseCli(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--pmx') args.pmx = argv[++i];
    else if (a === '--vmd') args.vmd = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--self-check') args.selfCheck = true;
  }
  return args;
}

const cli = parseCli(process.argv);
const configPath = resolveFrom(SCRIPT_DIR, cli.config || 'bake-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const PMX_PATH = cli.pmx ? resolveFrom(SCRIPT_DIR, cli.pmx) : resolveFrom(SCRIPT_DIR, config.pmx);
const VMD_RAW_PATH = cli.vmd ? resolveFrom(SCRIPT_DIR, cli.vmd) : resolveFrom(SCRIPT_DIR, config.vmdRaw);
const VMD_OUT_PATH = cli.output ? resolveFrom(SCRIPT_DIR, cli.output) : resolveFrom(SCRIPT_DIR, config.output);

// ★ helper 驱动模式（方向15）：bake 改用游戏侧 MMDAnimationHelper 完整驱动
// 游戏实时 = MMDAnimationHelper.update(delta) → _animateMesh 完整调用链（mixer.update→IK→grant→physics.update→骨骼矩阵写回）。
// bake 手写循环缺：_restoreBones/_saveBones + pmxAnimation PMX 路径 + _optimizeIK。config.helperDriver=true 切换。
const helperDriver = config.helperDriver === true;

const pp = config.physicsParams || {};
const physicsParams = {
  unitStep: pp.unitStep ?? 1 / 65,
  maxStepNum: pp.maxStepNum ?? 3,
  gravity: new THREE.Vector3(...(pp.gravity ?? [0, -98, 0])),
  warmupFrames: pp.warmupFrames ?? 60,
  frameRate: pp.frameRate ?? 30,
  springDamping: pp.springDamping ?? 0.05,
  solverIterations: pp.solverIterations ?? 50,
  physicsUpdateInterval: pp.physicsUpdateInterval ?? 1,
  springStiffnessScale: pp.springStiffnessScale ?? 2000,
  equilibriumPoint: pp.equilibriumPoint ?? 'all',
  // ★ frame0 修复（2026-08-07）：MMD 用「绑定姿态 + VMD 偏移」重建物理骨姿态，
  // frame0 必须 ≈ 绑定姿态（0°），否则在绑定姿态上重复叠加偏移 → 裙子乱动。
  // 两种修复模式（可同时开）：
  //  - warmupFrames=0：物理从绑定姿态直接开始（复现 MMM 的瞬态上升，最接近 MMM）
  //  - frame0Normalize=true：记录后把所有物理骨 rotation 相对 frame0 归零（frame0 强制=绑定姿态）
  frame0Normalize: pp.frame0Normalize ?? false
};

// ---- fix5 轮3：temporal kinematic init + kinematic smoothing（config 段）----
const tki = config.temporalKinematicInit || {};
const kinSm = config.kinematicSmoothing || {};
const kinematicSmoothing = {
  enabled: kinSm.enabled === true,
  steps: kinSm.steps ?? 12,
  move: kinSm.move ?? 0.03,
  angle: (kinSm.useDegrees === false ? kinSm.angle ?? 8 : (kinSm.angle ?? 8) * Math.PI / 180)
};

// ---- Ammo 全局注入 ----
// 决定性实验（vmd-physics-bake）：bake 改用游戏版 ammo.wasm.js（浏览器构建，独立 .wasm 文件）。
// 仓库内 lib/ammo/ammo.wasm.js 是 CJS 工厂函数（module.exports = factory），Node 里用 createRequire 加载，
// 必须注入 wasmBinary（否则走 fetch streaming 分支 → Node 相对路径 fetch 失败）。
// 默认走 npm 版：config.ammoSource = 'npm'（ammojs-typed/ammo/ammo.js，非 wasm 构建，Node 直接可用）。
const ammoSource = config.ammoSource || 'npm';
let AmmoModule;
if (ammoSource === 'game') {
  const GAME_AMMO_DIR = path.resolve(PROJECT_ROOT, 'lib/ammo');
  const ammoRequire = createRequire(pathToFileURL(GAME_AMMO_DIR).href);
  const ammoFactory = ammoRequire(path.join(GAME_AMMO_DIR, 'ammo.wasm.js'));
  const wasmBin = new Uint8Array(fs.readFileSync(path.join(GAME_AMMO_DIR, 'ammo.wasm.wasm')));
  AmmoModule = await ammoFactory({ wasmBinary: wasmBin });
} else {
  const AmmoMod = await import('ammojs-typed/ammo/ammo.js');
  AmmoModule = await AmmoMod.default();
}
globalThis.Ammo = AmmoModule;

const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();
const { writeVmd, sanitizeSjis } = await import(pathToFileURL(resolveFrom(SCRIPT_DIR, './vmd-writer.mjs')).href);

const readBuf = (p) => {
  const buf = fs.readFileSync(p);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const pmx = parser.parsePmx(readBuf(PMX_PATH), true);
const vmdRaw = parser.parseVmd(readBuf(VMD_RAW_PATH), true);
const maxFrame = vmdRaw.motions.length ? Math.max(...vmdRaw.motions.map((m) => m.frameNum)) : 0;
console.log(`PMX bones=${pmx.bones.length} rigidBodies=${pmx.rigidBodies.length} constraints=${pmx.constraints.length}`);
console.log(`VMD raw motions=${vmdRaw.motions.length} morphs=${vmdRaw.morphs.length} maxFrame=${maxFrame}`);

// ---- 1. 构建 Bone 层级（spike2 同款）----
const boneData = pmx.bones;
const bones = [];
for (let i = 0; i < boneData.length; i++) {
  const b = new Bone();
  b.name = boneData[i].name;
  b.position.set(boneData[i].position[0], boneData[i].position[1], boneData[i].position[2]);
  bones.push(b);
}
for (let i = 0; i < boneData.length; i++) {
  const p = boneData[i].parentIndex;
  if (p !== -1 && p < bones.length) bones[p].add(bones[i]);
}

// 注意：物理骨 VMD 关键帧 position 一律写 [0,0,0]（只写 rotation）。
// MMD 约定：物理骨（スカート/前髪/胸上 等）位置由 PMX 骨骼绑定 + 父骨骼链决定，VMD 写 position 反而叠加错误位移。
// 曾误写 bone.position - basePosition 偏移（实测 148 骨 >10 单位、最大 433.7），游戏内裙子被撑飞巨大变形；
// MMM 烘焙版 309 骨仅 5 骨 position 非零（≤3.64）。见 changes/2026-08-06-vmd-physics-bake。

// ---- 2. 构建 iks / grants（spike2 同款）----
const iks = [];
for (let i = 0; i < boneData.length; i++) {
  const ik = boneData[i].ik;
  if (ik === undefined) continue;
  const param = { target: i, effector: ik.effector, iteration: ik.iteration, maxAngle: ik.maxAngle, links: [] };
  for (let j = 0, jl = ik.links.length; j < jl; j++) {
    const link = { index: ik.links[j].index, enabled: true };
    if (ik.links[j].angleLimitation === 1) {
      const rotationMin = ik.links[j].lowerLimitationAngle;
      const rotationMax = ik.links[j].upperLimitationAngle;
      const tmp1 = -rotationMax[0];
      const tmp2 = -rotationMax[1];
      rotationMax[0] = -rotationMin[0];
      rotationMax[1] = -rotationMin[1];
      rotationMin[0] = tmp1;
      rotationMin[1] = tmp2;
      link.rotationMin = new THREE.Vector3().fromArray(rotationMin);
      link.rotationMax = new THREE.Vector3().fromArray(rotationMax);
    }
    param.links.push(link);
  }
  iks.push(param);
}

const grants = [];
{
  const grantEntryMap = {};
  for (let i = 0; i < boneData.length; i++) {
    const grant = boneData[i].grant;
    if (grant === undefined) continue;
    const param = { index: i, parentIndex: grant.parentIndex, ratio: grant.ratio, isLocal: grant.isLocal, affectRotation: grant.affectRotation, affectPosition: grant.affectPosition, transformationClass: boneData[i].transformationClass };
    grantEntryMap[i] = { parent: null, children: [], param, visited: false };
  }
  const rootEntry = { parent: null, children: [], param: null, visited: false };
  for (const boneIndex in grantEntryMap) {
    const grantEntry = grantEntryMap[boneIndex];
    const parentGrantEntry = grantEntryMap[grantEntry.param.parentIndex] || rootEntry;
    grantEntry.parent = parentGrantEntry;
    parentGrantEntry.children.push(grantEntry);
  }
  function traverse(entry) {
    if (entry.param) grants.push(entry.param);
    entry.visited = true;
    for (const child of entry.children) if (!child.visited) traverse(child);
  }
  traverse(rootEntry);
}
console.log(`iks=${iks.length} grants=${grants.length}`);

// ---- 3. userData.MMD + mesh ----
const rigidBodyParams = pmx.rigidBodies.map((rb, i) => {
  const p = { ...rb };
  if (p.boneIndex !== -1 && p.boneIndex < boneData.length) {
    p.position = [rb.position[0] - boneData[rb.boneIndex].position[0], rb.position[1] - boneData[rb.boneIndex].position[1], rb.position[2] - boneData[rb.boneIndex].position[2]];
  }
  return p;
});

// ★ MMDLoader 约束 type 规则复刻（对齐 MMDLoader.js L1448-1461，2026-08-09）
// 游戏对每个约束做后处理：bodyA.type!==0 && bodyB.type===2 && 双方 boneIndex!==-1
// && bones[bodyB.boneIndex].parentIndex === bodyA.boneIndex → bodyB.type = 1。
// 规则通用（非硬编码呆毛1），换模型同样适用；在 Ammo 刚体构造之前生效。
for (const c of pmx.constraints) {
  const bodyA = rigidBodyParams[c.rigidBodyIndex1];
  const bodyB = rigidBodyParams[c.rigidBodyIndex2];
  if (!bodyA || !bodyB) continue;
  if (bodyA.type !== 0 && bodyB.type === 2) {
    if (bodyA.boneIndex !== -1 && bodyB.boneIndex !== -1 &&
        boneData[bodyB.boneIndex].parentIndex === bodyA.boneIndex) {
      bodyB.type = 1;
    }
  }
}

// ---- zone rules 匹配基础（fix5 轮2 Step 4）----
// 匹配依据：约束取关联刚体（bodyA/bodyB）的刚体名 + 骨名；刚体取自身名 + 骨名。
// 任一候选名包含 zone 任一 needle 即命中；按 zoneRules 声明顺序取第一个命中的 zone。
const zoneRules = config.zoneRules || [];
const boneNameAt = (bi) => (bi >= 0 && bi < bones.length) ? bones[bi].name : null;
const namesHitZone = (names, zone) => {
  const needles = [];
  const m = zone.match || {};
  if (m.rigidNameContains) needles.push(...m.rigidNameContains);
  if (m.boneNameContains) needles.push(...m.boneNameContains);
  if (!needles.length) return false;
  return names.some((n) => n && needles.some((nd) => n.includes(nd)));
};
const zoneForNames = (names) => {
  for (const z of zoneRules) if (namesHitZone(names, z)) return z;
  return null;
};
// 刚体名称 = 自身名 + 骨名（用于构造前 patch rigidBodyParams 的碰撞 mask）
const rigidParamZone = (rb) => zoneForNames([rb.name, boneNameAt(rb.boneIndex)]);

// ---- 构造前：zone 刚体级覆盖（质量 + 碰撞 mask）----
// MMDPhysics 用 addRigidBody(body, 1<<groupIndex, groupTarget) 做碰撞过滤。
// 裙子目标 mask 含腿 group（bit1）→ 裙子与腿碰撞 → 裙摆摆动被腿挡住（MMM 靠 mask 分离摆动）。
// zone 的 rigidBody.collisionMask 直接覆盖 groupTarget；noCollisionGroups 将指定 group 位清零。
// massScale 缩放刚体质量（构造时 RigidBody 用 params.weight 建 btRigidBodyConstructionInfo）。
for (const rb of rigidBodyParams) {
  const zb = (rigidParamZone(rb) || {}).rigidBody || {};
  if (zb.collisionMask !== undefined) rb.groupTarget = zb.collisionMask;
  if (Array.isArray(zb.noCollisionGroups)) {
    let mask = rb.groupTarget ?? 0xffff;
    for (const g of zb.noCollisionGroups) mask &= ~(1 << g);
    rb.groupTarget = mask;
  }
  if (zb.massScale !== undefined && typeof rb.weight === 'number') rb.weight = rb.weight * zb.massScale;
}

// rigidBodyType 对齐 MMDLoader（boneTypeTable = 该骨关联刚体的最大 type），helper 模式 _optimizeIK 依赖它
const boneTypeTable = {};
for (const rb of pmx.rigidBodies) {
  if (rb.boneIndex === -1) continue;
  boneTypeTable[rb.boneIndex] = boneTypeTable[rb.boneIndex] === undefined ? rb.type : Math.max(boneTypeTable[rb.boneIndex], rb.type);
}
const mmdBones = boneData.map((bd, i) => ({ index: i, transformationClass: bd.transformationClass, parent: bd.parentIndex, name: bd.name, pos: bd.position.slice(0, 3), rotq: [0, 0, 0, 1], scl: [1, 1, 1], rigidBodyType: boneTypeTable[i] !== undefined ? boneTypeTable[i] : -1 }));
// helper 模式：PMX 动画路径（updateOne）按骨读 boneData.ik/.grant，需像 MMDLoader 一样挂到骨数据
if (helperDriver) {
  for (const ikParam of iks) if (mmdBones[ikParam.target]) mmdBones[ikParam.target].ik = ikParam;
  for (const gParam of grants) if (mmdBones[gParam.index]) mmdBones[gParam.index].grant = gParam;
}
const geo = new BufferGeometry();
geo.userData.MMD = {
  bones: mmdBones,
  iks, grants,
  rigidBodies: rigidBodyParams,
  constraints: pmx.constraints,
  format: 'pmx'
};
const mesh = new SkinnedMesh(geo);
mesh.morphTargetDictionary = {}; // 空 morph，buildMorphAnimation 跳过
const skeleton = new Skeleton(bones);
mesh.add(bones[0]);
mesh.bind(skeleton);

// ---- 4. AnimationBuilder.build(vmd) → clip ----
const loaderMod = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'lib/MMDLoader.js')).href);
const loader = new loaderMod.MMDLoader();
const clip = loader.animationBuilder.build(vmdRaw, mesh);
console.log('clip tracks:', clip.tracks.length, 'duration:', clip.duration);

// ---- 5. 自组装动画循环 ----
const mixer = new THREE.AnimationMixer(mesh);
const action = mixer.clipAction(clip);
action.play();

const { CCDIKSolver } = await import('three/examples/jsm/animation/CCDIKSolver.js');
const ikSolver = new CCDIKSolver(mesh, iks);

// GrantSolver 简易版（提取自 MMDAnimationHelper）
const _q = new THREE.Quaternion();
const grantSolver = {
  grants,
  update() {
    for (const g of this.grants) {
      const bone = bones[g.index];
      const parentBone = bones[g.parentIndex];
      if (!g.isLocal && g.affectRotation) {
        _q.set(0, 0, 0, 1);
        _q.slerp(parentBone.quaternion, g.ratio);
        bone.quaternion.multiply(_q);
      }
    }
    return this;
  }
};

const { MMDPhysics } = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'lib/MMDPhysics.js')).href);

// spring stiffness 单位换算：PMX spring 值（0-1000，MMD 单位）→ Bullet 单位（÷2000）
// three.js MMDPhysics 直接传原值（漏换算）→ 弹簧过刚 → 抖动。
// 实验（diag-solver*.mjs + 真实 bake 扫描 sweep-bake-scale.mjs）：÷50 起身段 err 537（62-140°），
// ÷2000 起身段最优（30 13 15 17 18 27 36，err 53，全部 < 40°）。
// fix5 扫出胸部维度：真实 bake sweep（fix5-sweep-scale.mjs，左/右胸上 f45/f75 vs MMM）：
// ÷500 errSum 404.9、÷1000 errSum 317.2（最优，左胸上 f75 267→30.7）、÷2000 errSum 517.6、÷5000 errSum 587.5。
// 起身段偏向前发，胸部偏胸骨 —— 两者最优 scale 不同；fix5 以胸部 errSum 为准取 ÷1000，
// 起身段/zone 分区域调参留待 Step 4（zone rules）。
// 注意：diag-solver4 报的「÷50 err 110」是 bug —— 它各 run 间未还原 setStiffness 原型，
// 实际累积为 ÷50000（弹簧近乎关闭）且缺 angleLimitation IK；以真实 bake 扫描为准。
// 必须在 new MMDPhysics(...) 之前 patch（MMDPhysics 构造时创建 constraint 并调用 setStiffness）。
const springStiffnessScale = physicsParams.springStiffnessScale;
const _origSetStiffness = Ammo.btGeneric6DofSpringConstraint.prototype.setStiffness;
if (springStiffnessScale !== 1) {
  Ammo.btGeneric6DofSpringConstraint.prototype.setStiffness = function (idx, val) {
    return _origSetStiffness.call(this, idx, val / springStiffnessScale);
  };
}

// ---- 根因修复（脚本层）：构造约束前先把刚体 snap 到骨骼世界 transform ----
// MMDPhysics.js RigidBody 构造时 boneForm 只取骨骼世界位置（basis=identity，L1044-1046），
// 缺骨骼世界旋转；reset()/updateFromBone() 用的 _getBoneTransform() 才包含完整骨骼世界旋转。
// 约束 frame（formA2/formB2）在构造时用 bodyA/bodyB 初始 world transform 计算（MMDPhysics.js L1242-1344），
// 若刚体初始旋转与骨骼不一致 → 约束局部轴错位。修复：_initConstraints 前对全部刚体调 reset()
// （= _setTransformFromBone，完整含骨骼世界旋转），使 formA/formB 基于正确 frame。
// 诊断（diag-init-transform.mjs）：本模型骨骼 bind-pose 世界旋转全为 identity（rotq=[0,0,0,1]），
// 因此该修复对本模型输出为零影响（防御性对齐，不改游戏侧 MMDPhysics.js）。
const _origInitConstraints = MMDPhysics.prototype._initConstraints;
if (typeof _origInitConstraints === 'function') {
  MMDPhysics.prototype._initConstraints = function (constraintParams) {
    for (const b of this.bodies) {
      try { b.reset(); } catch (e) {}
    }
    return _origInitConstraints.call(this, constraintParams);
  };
}

// ★ helper 驱动模式：用游戏侧 MMDAnimationHelper 完整驱动（_animateMesh 全链路：mixer→IK→grant→physics→骨骼写回）
// 游戏实时 helper.add(mesh,{animation,physics:true,...}) → helper.play() → 每帧 helper.update(delta)。
// bake 手写循环缺 _restoreBones/_saveBones + pmxAnimation PMX 路径 + _optimizeIK，本分支对齐游戏。
let physics = null;
let helper = null;
if (helperDriver) {
  const { MMDAnimationHelper } = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'lib/MMDAnimationHelper.js')).href);
  helper = new MMDAnimationHelper();
  helper.add(mesh, {
    animation: [['pickup', clip]],          // meta3d 版 _setupMeshAnimation 存 [name,clip] 元组数组
    physics: true,
    unitStep: physicsParams.unitStep,
    maxStepNum: physicsParams.maxStepNum,
    gravity: physicsParams.gravity,
    solverIterations: physicsParams.solverIterations,
    // 2026-08-10 兄弟拍板：warmup 暂时注释掉不使用（实验证明 warmup=0 vs 60 产物几乎无差；不影响生产代码）
    warmup: 0,  // physicsParams.warmupFrames  ← 注释掉，不使用 warmup
    ...(pp.physicsUpdateInterval !== undefined ? { physicsUpdateInterval: pp.physicsUpdateInterval } : {}),
  });
  helper.configuration.pmxAnimation = true;  // 游戏对 PMX 模型设置（HMS 是 PMX）
  helper.play(mesh, 'pickup', true);         // 启动动画（meta3d 版 _setupMeshAnimation 不自动 play）
  physics = helper.objects.get(mesh).physics;
  if (!physics) throw new Error('[helperDriver] helper.add 未创建 physics');
  console.log('[helperDriver] MMDAnimationHelper 创建完成, physics=', !!physics, 'pmxAnimation=', helper.configuration.pmxAnimation);
} else {
  physics = new MMDPhysics(mesh, rigidBodyParams, pmx.constraints, physicsParams);
}

/*! diag 2026-08-09: 离线装配参数 dump（供与游戏 __mmdPhysicsDiag 对比） */
try {
  const toArr = (v) => (v && typeof v.toArray === 'function') ? v.toArray() : v;
  const dump = {
    params: { unitStep: physicsParams.unitStep, maxStepNum: physicsParams.maxStepNum, gravity: toArr(physicsParams.gravity), physicsUpdateInterval: pp.physicsUpdateInterval ?? 1, solverIterations: physicsParams.solverIterations, warmup: physicsParams.warmupFrames, meshScale: null },
    rigidBodies: rigidBodyParams.map(rb => ({ name: rb.name, type: rb.type, boneIndex: rb.boneIndex, weight: rb.weight, position: toArr(rb.position), rotation: toArr(rb.rotation), shapeType: rb.shapeType, size: toArr(rb.size), groupIndex: rb.groupIndex, groupTarget: rb.groupTarget, friction: rb.friction, restitution: rb.restitution, positionDamping: rb.positionDamping, rotationDamping: rb.rotationDamping })),
    constraints: pmx.constraints.map(c => ({ name: c.name, rigidBodyIndex1: c.rigidBodyIndex1, rigidBodyIndex2: c.rigidBodyIndex2, position: toArr(c.position), rotation: toArr(c.rotation), springPosition: toArr(c.springPosition), springRotation: toArr(c.springRotation), translationLimitation1: toArr(c.translationLimitation1), translationLimitation2: toArr(c.translationLimitation2), rotationLimitation1: toArr(c.rotationLimitation1), rotationLimitation2: toArr(c.rotationLimitation2) })),
    warmupEndBones: null
  };
  if (physics && physics.bodies) {
    const warmupBones = {};
    for (const b of physics.bodies) { const bn = b.bone && b.bone.name; if (bn) warmupBones[bn] = b.bone.quaternion.toArray(); }
    dump.warmupEndBones = warmupBones;
  }
  fs.mkdirSync(resolveFrom(PROJECT_ROOT, 'output'), { recursive: true });
  fs.writeFileSync(resolveFrom(PROJECT_ROOT, 'output/bake-params-dump.json'), JSON.stringify(dump, null, 1), 'utf8');
  console.log('[bake-diag] params dump written: output/bake-params-dump.json (' + dump.rigidBodies.length + ' rb, ' + dump.constraints.length + ' c)');
} catch (e) { console.warn('[bake-diag] dump failed:', e.message); }

// solver 迭代：MMDPhysics 默认未设（Bullet 默认低 → 求解不收敛 → 抖动）
// 实验：50 最优（err 375→114）
try {
  const solverInfo = physics.world.getSolverInfo();
  solverInfo.set_m_numIterations(physicsParams.solverIterations);
} catch (e) { console.warn('set solver iterations failed:', e.message); }

// spring 约束补齐平衡点 + 阻尼 + 锁定轴 ERP/CFM（对齐 MikuMikuPhysics 参考参数）
// three.js MMDPhysics 只设置了 stiffness（enableSpring+setStiffness），
// 未设 equilibrium point 与 damping → 弹簧振荡不收敛 → 头发/裙子乱动。
// 实验（diag-damping.mjs）：eq + damping=0.05 为最优（err 153→70）。
// fix5：MMDPhysics 里 damping 缺失维度 → 0.05 = 无阻尼振荡 → 胸部 f75 267°（MMM 6°）。
//   damping 0.05 → 0.85（MikuMikuPhysics 全局参考值），锁定轴补 STOP_ERP/STOP_CFM（极硬锁定）。
// 参数编号经 fix5-ammo-api-check.mjs 运行时验证（ammo.d.ts L534 有 setParam/getParam）：
//   BT_CONSTRAINT_STOP_ERP=2（默认 0.2，MMDPhysics 已对所有轴设 0.475）、BT_CONSTRAINT_CFM=3、
//   BT_CONSTRAINT_STOP_CFM=4（默认 0）。方案文档假设 STOP_ERP=3/CFM=6 是错的，以实测为准。

// ---- 约束级 + 刚体级 zone 覆盖（构造后）----
// 约束关联名称 = bodyA/bodyB 刚体名 + 各自骨名
const constraintZone = (c) => {
  const names = [];
  for (const b of [c.bodyA, c.bodyB]) {
    if (!b || !b.params) continue;
    names.push(b.params.name);
    if (b.params.boneIndex !== undefined) names.push(boneNameAt(b.params.boneIndex));
  }
  return zoneForNames(names);
};
// 刚体名称 = 自身名 + 骨名
const bodyZone = (b) => zoneForNames([b.params.name, boneNameAt(b.params.boneIndex)]);

const SPRING_DAMPING = physicsParams.springDamping;
// ★ fix(2026-08-07): LOCKED_STOP_ERP/CFM 移除硬编码全局默认值，锁定轴保留 MMDPhysics 默认 0.475/0。
//   zone 级 lockedStopErp/lockedStopCfm 仅在明确配置时覆盖。
for (const c of physics.constraints) {
  const cst = c.constraint;
  const p = c.params;
  const zc = (constraintZone(c) || {}).constraint || {};
  const sp = p.springPosition, sr = p.springRotation;
  const hasSpring = (sp && sp.some(v => v !== 0)) || (sr && sr.some(v => v !== 0));

  // 锁定轴判定：linear lower==upper（i<3）或 angular lower==upper（i>=3）
  // ★ fix(2026-08-07): 锁定轴 STOP_ERP 不再覆盖 MMDPhysics 默认值 0.475。
  //   旧行为设 0.2（MikuMikuPhysics 参考值），比 0.475 弱 2.4x，导致锁定轴旋转泄漏→Y轴主导。
  //   游戏侧无此覆盖→X轴主导（正确）。STOP_CFM 同理，游戏侧 CFM=0（默认）。
  //   非锁定轴若 zone 指定 jointStopErp 则覆盖（如裙子 0.5 防穿腿），否则保持 MMDPhysics 默认。
  if (typeof cst.setParam === 'function') {
    try {
      for (let i = 0; i < 6; i++) {
        const isLinear = i < 3;
        const lo = isLinear ? p.translationLimitation1[i] : p.rotationLimitation1[i - 3];
        const hi = isLinear ? p.translationLimitation2[i] : p.rotationLimitation2[i - 3];
        if (lo === hi) {
          // 锁定轴：保留 MMDPhysics 默认 STOP_ERP=0.475（不覆盖），CFM=默认 0（不覆盖）。
          // zone 级 lockedStopErp/lockedStopCfm 仅在明确配置时覆盖。
          if (zc.lockedStopErp !== undefined) {
            cst.setParam(2, zc.lockedStopErp, i);
          }
          if (zc.lockedStopCfm !== undefined) {
            cst.setParam(4, zc.lockedStopCfm, i);
          }
        } else if (zc.jointStopErp !== undefined) {
          cst.setParam(2, zc.jointStopErp, i);   // 非锁定轴 STOP_ERP（zone 级）
        }
      }
    } catch (e) {}
  }
  // zone 级旋转限位覆盖：rotationLimitScale 将角度限位放大（MMM 对裙子不严格限位）
  // 支持逐轴缩放：数字 → 统一缩放；数组 [x,y,z] → 逐轴缩放
  // ★ fix: 仅对含 spring 的约束放宽限位（垂直链约束有 spring，水平环约束无 spring，后者保持原 PMX 限位以维持环形状）
  const hasAngularSpring = sr && sr.some(v => v !== 0);
  if (zc.rotationLimitScale !== undefined && hasAngularSpring) {
    try {
      const scaleArr = Array.isArray(zc.rotationLimitScale) ? zc.rotationLimitScale : [zc.rotationLimitScale, zc.rotationLimitScale, zc.rotationLimitScale];
      const unlockRangeArr = zc.unlockAngularRange;
      const lo = [0, 0, 0], hi = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        const s = scaleArr[i] ?? 1.0;
        if (zc.unlockLockedAxes === true && p.rotationLimitation1[i] === p.rotationLimitation2[i]) {
          // 解锁锁定轴：优先使用 unlockAngularRange 逐轴指定（null=不修改），否则用 rotationLimitScale 作为范围
          if (unlockRangeArr && unlockRangeArr[i] !== undefined && unlockRangeArr[i] !== null) {
            lo[i] = -unlockRangeArr[i]; hi[i] = unlockRangeArr[i];
          } else {
            lo[i] = -1.0 * s; hi[i] = 1.0 * s;
          }
        } else {
          lo[i] = p.rotationLimitation1[i] * s;
          hi[i] = p.rotationLimitation2[i] * s;
        }
      }
      // 直接覆盖：rotationLimitOverride 在缩放/解锁后逐轴覆写（null=保留计算值）
      if (zc.rotationLimitOverride) {
        if (zc.rotationLimitOverride.lower) {
          for (let i = 0; i < 3; i++) {
            if (zc.rotationLimitOverride.lower[i] !== undefined && zc.rotationLimitOverride.lower[i] !== null) lo[i] = zc.rotationLimitOverride.lower[i];
          }
        }
        if (zc.rotationLimitOverride.upper) {
          for (let i = 0; i < 3; i++) {
            if (zc.rotationLimitOverride.upper[i] !== undefined && zc.rotationLimitOverride.upper[i] !== null) hi[i] = zc.rotationLimitOverride.upper[i];
          }
        }
      }
      cst.setAngularLowerLimit(new Ammo.btVector3(lo[0], lo[1], lo[2]));
      cst.setAngularUpperLimit(new Ammo.btVector3(hi[0], hi[1], hi[2]));
    } catch (e) {}
  }
  // zone 级平动限位覆盖：translationLimitScale（配合 unlock 测试用）
  if (zc.translationLimitScale !== undefined && zc.translationLimitScale > 0) {
    try {
      const s = zc.translationLimitScale;
      const lo = [0, 0, 0], hi = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        if (zc.unlockLockedAxes === true && p.translationLimitation1[i] === p.translationLimitation2[i]) {
          lo[i] = -1.0 * s; hi[i] = 1.0 * s;  // 解锁锁定轴
        } else {
          lo[i] = p.translationLimitation1[i] * s;
          hi[i] = p.translationLimitation2[i] * s;
        }
      }
      cst.setLinearLowerLimit(new Ammo.btVector3(lo[0], lo[1], lo[2]));
      cst.setLinearUpperLimit(new Ammo.btVector3(hi[0], hi[1], hi[2]));
    } catch (e) {}
  }

  if (!hasSpring) continue;
  // equilibriumPoint 模式（诊断 setEquilibriumPoint 语义用）：
  //   'all'    无参调用 → 6 DOF 全设平衡点=当前相对位姿（原行为）
  //   'spring' 逐轴调用 → 只对 springPosition/springRotation 非零的轴设平衡点
  //   'none'   不调用    → 平衡点保持默认 0（对齐 MMDPhysics.js 游戏侧行为）
  if (typeof cst.setEquilibriumPoint === 'function') {
    const eqMode = physicsParams.equilibriumPoint ?? 'all';
    try {
      if (eqMode === 'spring') {
        for (let i = 0; i < 3; i++) {
          if (sp[i] !== 0) cst.setEquilibriumPoint(i);
          if (sr[i] !== 0) cst.setEquilibriumPoint(i + 3);
        }
      } else if (eqMode !== 'none') {
        cst.setEquilibriumPoint();
      }
    } catch (e) {}
  }
  if (typeof cst.setDamping === 'function') {
    try { for (let i = 0; i < 6; i++) cst.setDamping(i, zc.springDamping ?? SPRING_DAMPING); } catch (e) {}
  }
  // zone 级 spring stiffness 覆盖：global springStiffnessScale 已通过 setStiffness patch（÷1000）生效，
  // 此处用 _origSetStiffness 直接写（raw ÷ zone 分频），避免被 patch 二次除以 global scale。
  if (zc.springStiffnessScale !== undefined) {
    try {
      for (let i = 0; i < 3; i++) {
        if (p.springPosition[i] !== 0) _origSetStiffness.call(cst, i, p.springPosition[i] / zc.springStiffnessScale);
        if (p.springRotation[i] !== 0) _origSetStiffness.call(cst, i + 3, p.springRotation[i] / zc.springStiffnessScale);
      }
    } catch (e) {}
  }
}

// 刚体级 zone 覆盖：线性/角阻尼缩放（setDamping） + 关闭去激活（setActivationState(4)）
// MMDPhysics 构造时已按 PMX positionDamping/rotationDamping setDamping，此处按 zone 覆盖。
for (const b of physics.bodies) {
  const zb = (bodyZone(b) || {}).rigidBody || {};
  if (!Object.keys(zb).length) continue;
  const baseLin = b.params.positionDamping, baseAng = b.params.rotationDamping;
  const lin = zb.linearDampingScale !== undefined ? baseLin * zb.linearDampingScale : baseLin;
  const ang = zb.angularDampingScale !== undefined ? baseAng * zb.angularDampingScale : baseAng;
  try { b.body.setDamping(Math.min(1, Math.max(0, lin)), Math.min(1, Math.max(0, ang))); } catch (e) {}
  if (zb.disableDeactivation) {
    try { b.body.setActivationState(4); } catch (e) {}   // 4 = DISABLE_DEACTIVATION
  }
}

// ---- fix5 轮3：temporal kinematic init + kinematic smoothing ----
// 拦截点：MMDPhysics.update() 内部每次都会 _updateRigidBodies()，把 type-0（kinematic）刚体
// 无条件对齐骨骼姿态（updateFromBone → _setTransformFromBone）。无法在外部预置插值姿态
// （会被覆盖），因此在此 wrap 实例的 _updateRigidBodies（bake 脚本层，不改 MMDPhysics.js）：
//   先原样 snap 到骨骼目标姿态，再对 kinematic 刚体做位移/角度阈值限制的分段插值。
//   限制后的姿态在 _stepSimulation 期间保持（kinematic 刚体不被物理积分移动）。
const _manager = physics.manager;
const _kinBodies = physics.bodies.filter((b) => b.params.boneIndex !== -1 && b.params.type === 0);
console.log('kinematic bodies (type0+bone):', _kinBodies.length);

const _qv = new THREE.Quaternion();
const _vv = new THREE.Vector3();
const _kinPrev = new Map(); // body -> { pos: Vector3, quat: Quaternion }
const _readKinPose = (b) => {
  const tr = b.body.getCenterOfMassTransform();   // btTransform 引用（勿 destroy）
  const o = tr.getOrigin();
  const q = _manager.getBasis(tr);                // Ammo quaternion（池）
  _vv.set(o.x(), o.y(), o.z());
  _qv.set(q.x(), q.y(), q.z(), q.w());
  _manager.freeQuaternion(q);
  return { pos: _vv.clone(), quat: _qv.clone() };
};
const _writeKinPose = (b, pos, quat) => {
  const form = _manager.allocTransform();
  _manager.setIdentity(form);
  _manager.setOriginFromThreeVector3(form, pos);
  _manager.setBasisFromThreeQuaternion(form, quat);
  b.body.setCenterOfMassTransform(form);
  b.body.getMotionState().setWorldTransform(form);
  _manager.freeTransform(form);
};

if (kinematicSmoothing.enabled) {
  const _origUpdateRigidBodies = physics._updateRigidBodies.bind(physics);
  const { steps, move, angle } = kinematicSmoothing;
  physics._updateRigidBodies = function () {
    _origUpdateRigidBodies();   // snap 到骨骼目标姿态
    for (const b of _kinBodies) {
      const target = _readKinPose(b);   // 当前 = 骨骼目标姿态
      const prev = _kinPrev.get(b);
      if (!prev) { _kinPrev.set(b, target); continue; }
      const dPos = target.pos.distanceTo(prev.pos);
      const dAng = 2 * Math.acos(Math.min(1, Math.max(-1, Math.abs(prev.quat.dot(target.quat)))));
      if (dPos > move || dAng > angle) {
        const t = 1 / steps;   // 每次 update 只走 1/steps 距离
        const pos = prev.pos.clone().lerp(target.pos, t);
        const quat = prev.quat.clone().slerp(target.quat, t);
        _writeKinPose(b, pos, quat);
        _kinPrev.set(b, { pos, quat });
      } else {
        _kinPrev.set(b, target);
      }
    }
  };
}

// temporal kinematic init：首帧前把 kinematic 刚体对齐到骨骼姿态并清零速度
// （避免「第一帧骨骼已动、刚体还在 bind pose」的瞬态冲击；reset() 已对齐 transform，
//   此处补充清零线性/角速度，消除首帧瞬态冲击）
if (tki.enabled === true) {
  const _zero = new Ammo.btVector3(0, 0, 0);
  for (const b of _kinBodies) {
    b.reset();
    b.body.setLinearVelocity(_zero);
    b.body.setAngularVelocity(_zero);
  }
}

if (!helperDriver) {
  // 手写循环 warmup（对齐 MMDAnimationHelper._setupMeshPhysics，L759-766）
  // 官方语义：_animateMesh(mesh, 0) 应用首帧姿态（mixer.update(0) + IK/Grant + physics.update(0)）
  // → physics.reset() 刚体重置到当前骨骼 → physics.warmup() 只跑物理自稳定，不推进动画。
  // 之前的错误：warmup 期间 mixer.update() 推进动画（60 步 ≈ 0.92s），物理骨时间轴与动作骨错位 → 乱动幅度大。
  mixer.setTime(0);        // 动画归零（首帧）
  mixer.update(0);         // 应用首帧姿态（setTime 只改时间不应用值，必须 update）
  mesh.updateMatrixWorld(true);
  ikSolver.update();
  grantSolver.update();
  physics.update(0);       // 骨骼姿态就位（同官方 _animateMesh(mesh,0)，delta=0 时内部仍走 1 步 unitStep）
  physics.reset();         // 物理刚体重置到当前骨骼姿态（MMDPhysics.reset() L200-210 存在）
  // 2026-08-10 兄弟拍板：warmup 暂时注释掉不使用（warmup=0 vs 60 产物几乎无差；不影响生产代码）
  // for (let f = 0; f < physicsParams.warmupFrames; f++) {
  //   physics.update(physicsParams.unitStep);   // 只跑物理，不推进动画
  // }
} else {
  // helper 驱动：warmup 已在 helper.add() 内部完成（_setupMeshPhysics：_animateMesh(0)+reset+warmup(warmup)）
  console.log('[helperDriver] warmup 由 helper.add 内部完成');
}

// ---- 6. 物理骨集合（rigidBody type 1/2 && boneIndex!==-1）----
const physicsBoneIndices = new Set();
for (const rb of pmx.rigidBodies) {
  if (rb.type === 1 || rb.type === 2) physicsBoneIndices.add(rb.boneIndex);
}
const physBoneIndices = [...physicsBoneIndices].filter((i) => i !== -1);
const physicsBoneNames = new Set(physBoneIndices.map((i) => bones[i].name));
console.log('physics-driven bones:', physicsBoneNames.size);

// ---- 7. 逐帧模拟 + 记录物理骨（frame 0..maxFrame）----
// ★ fix(2026-08-07): 对齐游戏 _animateMesh 流程 —
//   1. mixer.update(dt) 先推进动画（设置骨骼 transform 到当前帧）
//   2. mesh.updateMatrixWorld 刷新骨骼世界矩阵
//   3. IK/Grant 修改骨骼
//   4. mesh.updateMatrixWorld 再刷新（保证 physics 读到 IK/Grant 修改后的正确世界矩阵）
//   5. physics.update 在「当前帧姿态+IK/Grant 后」响应
//   6. 记录物理骨 → 推进到下一帧
// 之前：physics 在 IK/Grant 后立即执行，但 mesh.updateMatrixWorld 只在前面调用一次，
// IK/Grant 修改骨骼后 worldMatrix 变 stale → physics._getBoneTransform 读到的
// world rotation 是 IK/Grant 前的旧值 → 旋转轴错位。
const dt = 1 / physicsParams.frameRate;
const records = new Map(); // boneName -> [{frame, position, rotation}]
  const _DBG = process.env.BAKE_DBG || '';
  if (_DBG) {
    for (const c of physics.constraints) {
      const n = c.params.name || '';
      if (n === 'スカート_0_1' || n === 'スカート_0_10') {
        const bodyA = c.bodyA.params.name, bodyB = c.bodyB.params.name;
        const typeA = c.bodyA.body ? (c.bodyA.body.isKinematicObject ? 'kin' : 'dyn') : '?';
        const enabled = [];
        try { for (let i = 0; i < 6; i++) { const en = c.constraint.isSpringEnabled ? c.constraint.isSpringEnabled(i) : -1; const st = c.constraint.getStiffness ? c.constraint.getStiffness(i) : -1; const dm = c.constraint.getDamping ? c.constraint.getDamping(i) : -1; enabled.push(`[${i}]en=${en} st=${st.toFixed ? st.toFixed(4) : st} dm=${dm.toFixed ? dm.toFixed(3) : dm}`); } } catch (e) { enabled.push('err:' + e.message); }
        let lims = '';
        try {
          const isSpring = c.constraint instanceof Ammo.btGeneric6DofSpringConstraint;
          const hasEn = typeof c.constraint.enableSpring === 'function';
          lims = `isSpringInst=${isSpring} hasEnableSpring=${hasEn} proto=${Object.getOwnPropertyNames(Object.getPrototypeOf(c.constraint)).slice(0,20).join(',')}`;
        } catch (e) { lims = 'limerr:' + e.message; }
        console.log(`DBGC ${n}: bodyA=${bodyA}(${typeA}) bodyB=${bodyB} ${lims}`);
      }
    }
  }
const _dbgBodies = _DBG ? physics.bodies.filter((b) => b.params.name.includes('下半身') || b.params.name.includes('スカート_0_1')) : [];
const _dbgRead = (b) => {
  const tr = b.body.getCenterOfMassTransform();
  const q = physics.manager.getBasis(tr);
  const quat = new THREE.Quaternion(q.x(), q.y(), q.z(), q.w());
  physics.manager.freeQuaternion(q);
  return (2 * Math.acos(Math.min(1, Math.max(-1, Math.abs(quat.w)))) * 180 / Math.PI).toFixed(1);
};
// ★ 预热后 mixer.time=0，骨骼在 t=0 动画姿态。
//   frame0 无需 mixer.update（已在 warmup 应用 t=0 姿态），只做 IK/Grant/Physics/记录。
//   之后每轮先 mixer.update(dt) 推进 → IK/Grant → mesh.updateMatrixWorld → Physics → 记录。
for (let frame = 0; frame <= maxFrame; frame++) {
  if (helperDriver) {
    // 游戏侧完整驱动：helper.update(delta) → _animateMesh(mesh, delta)
    // = _restoreBones → mixer.update(delta) → _saveBones → [pmxAnimation PMX 路径 或 updateMatrixWorld+IK+grant]
    //   → physics.update(delta, isDisablePhysicsTranslation, isUpdatePhysics)
    // 注意：_animateMesh 内部自带 mesh.updateMatrixWorld 与骨骼矩阵写回（PMX 路径 _animatePMXMesh 结尾）。
    helper.update(frame === 0 ? 0 : dt);
  } else {
    if (frame > 0) {
      mixer.update(dt);   // 推进动画到当前帧（mixer.time: (frame-1)*dt → frame*dt）
    }
    mesh.updateMatrixWorld(true);  // 刷新所有骨骼 worldMatrix（动画推进后）
    ikSolver.update();
    grantSolver.update();
    mesh.updateMatrixWorld(true);  // ★ 再刷新：保证 physics._getBoneTransform 读到 IK/Grant 后的正确 world rotation
    physics.update(dt);
  }
  if (_DBG && frame % 10 === 0) {
    console.log(`DBG f${frame}: ` + _dbgBodies.map((b) => `${b.params.name}=${_dbgRead(b)}°`).join(' '));
    const bonq = mesh.skeleton.bones.find(x => x.name === '下半身');
    const wq = new THREE.Quaternion();
    if (bonq) { bonq.getWorldQuaternion(wq); console.log(`DBG f${frame} 下半身bone_world=${(2*Math.acos(Math.min(1,Math.max(-1,Math.abs(wq.w))))*180/Math.PI).toFixed(1)}°`); }
    const wq2 = new THREE.Quaternion();
    const skbon = mesh.skeleton.bones.find(x => x.name === 'スカート_0_1');
    if (skbon) { skbon.getWorldQuaternion(wq2); console.log(`DBG f${frame} スカート_0_1bone_world=${(2*Math.acos(Math.min(1,Math.max(-1,Math.abs(wq2.w))))*180/Math.PI).toFixed(1)}°`); }
  }
  for (const bi of physBoneIndices) {
    const bone = bones[bi];
    const name = bone.name;
    if (!records.has(name)) records.set(name, []);
    records.get(name).push({
      frame,
      position: bone.position.toArray(),
      rotation: bone.quaternion.toArray()
    });
  }
}
console.log('recorded physics bones:', records.size);

// ---- 7b. frame0Normalize：所有物理骨 rotation 相对 frame0 归零（frame0 强制 = 绑定姿态）----
// MMD 用「绑定姿态 + VMD 偏移」重建物理骨姿态；若 frame0 非 0°，MMD 会在绑定姿态上
// 重复叠加该偏移 → 裙子乱动。对每条物理骨：q_f' = q_f * q_frame0⁻¹，frame0 变单位四元数。
if (physicsParams.frame0Normalize) {
  for (const [name, recs] of records) {
    const f0 = recs.find((r) => r.frame === 0);
    if (!f0) continue;
    const q0 = new THREE.Quaternion(...f0.rotation);
    const q0Inv = q0.clone().invert();
    for (const r of recs) {
      const q = new THREE.Quaternion(...r.rotation);
      q.multiply(q0Inv);
      r.rotation = q.toArray();
    }
  }
  console.log(`frame0Normalize: ${records.size} 条物理骨 rotation 相对 frame0 归零`);
}

// ---- 8. 合并写出 ----
// SJIS 宽容名：简化汉字（发/饰/侧/头）无 JIS 映射 → '?'（0x3F，游戏既有约定）
// 原始动作骨名可编码则原样；冲突检测用原始名，输出用宽容名
const sjisSafeName = (name) =>
  [...name]
    .map((ch) => {
      const bytes = sanitizeSjis(ch);
      return bytes.length === 1 && bytes[0] === 0x3f ? '?' : ch;
    })
    .join('');

// 8a. 动作骨（非物理）关键帧原样保留；同名冲突 → 动作骨关键帧丢弃（物理逐帧覆盖）
const outMotions = [];
for (const m of vmdRaw.motions) {
  if (physicsBoneNames.has(m.boneName)) continue;
  outMotions.push({ boneName: m.boneName, frameNum: m.frameNum, position: [...m.position], rotation: [...m.rotation], interpolation: [...m.interpolation] });
}

// 8b. 物理骨逐帧：position 恒 [0,0,0]（MMD 物理骨约定：只写 rotation，位置由 PMX 绑定+父骨链决定），rotation=quaternion，interpolation=全0
const sortedPhysNames = [...physicsBoneNames].sort();
const outPhysNameOf = new Map(); // 原始名 → 输出名（宽容名）
for (const name of sortedPhysNames) outPhysNameOf.set(name, sjisSafeName(name));
for (const name of sortedPhysNames) {
  const recs = records.get(name);
  if (!recs) continue;
  const outName = outPhysNameOf.get(name);
  for (const r of recs) {
    outMotions.push({
      boneName: outName,
      frameNum: r.frame,
      position: [0, 0, 0], // MMD 物理骨约定：position 不写（位置由 PMX 绑定+父骨链决定），只写 rotation；曾误写 basePosition 偏移致裙子 400+ 单位撑飞，见 2026-08-06-vmd-physics-bake
      rotation: [...r.rotation],
      interpolation: new Array(64).fill(0)
    });
  }
}

// 8c. morph 原样复制（78 条，帧与权重逐条一致）
const morphs = vmdRaw.morphs.map((m) => ({ morphName: m.morphName, frameNum: m.frameNum, weight: m.weight }));

// ---- 8d. 坐标空间转换（雷区）----
// 游戏 loadVMD 用 parser.parseVmd(buffer, true)：把文件中的 LEFT 坐标转成 RIGHT
// （position 取反 Z，quaternion 取反 X/Y）。因此 VMD 文件里必须存 LEFT 空间值，
// 游戏回读才能还原成模拟得到的 RIGHT 空间值；若直接写 RIGHT 值会二次取反 → 头发/裙子镜像偏移。
// leftToRight 是自身逆变换，故 toFileSpace = 同样的取反规则。
const toFilePosition = (p) => [p[0], p[1], -p[2]];
const toFileRotation = (q) => [-q[0], -q[1], q[2], q[3]];

for (const m of outMotions) {
  m.position = toFilePosition(m.position);
  m.rotation = toFileRotation(m.rotation);
}

// ---- 9. 写出（self-check 模式不落盘，纯内存校验）----
const outBytes = writeVmd('pickup_bake', outMotions, morphs);
physics.dispose();
if (!cli.selfCheck) {
  fs.mkdirSync(path.dirname(VMD_OUT_PATH), { recursive: true });
  fs.writeFileSync(VMD_OUT_PATH, outBytes);
  console.log(`written: ${VMD_OUT_PATH} (${outBytes.length} bytes) motions=${outMotions.length} morphs=${morphs.length}`);
}

// ---- 10. 自检：MMDParser 回读断言（直接解析内存字节）----
function selfCheck(outBytes) {
  const back = parser.parseVmd(outBytes.buffer.slice(outBytes.byteOffset, outBytes.byteOffset + outBytes.byteLength), true); // 回读即为 RIGHT 空间
  const byName = new Map();
  for (const m of back.motions) {
    if (!byName.has(m.boneName)) byName.set(m.boneName, []);
    byName.get(m.boneName).push(m);
  }
  // 物理骨回读名 = 宽容名（outPhysNameOf）
  const outNames = [...new Set(outPhysNameOf.values())];
  const physNamesPresent = outNames.filter((n) => byName.has(n));
  const assertPhysCount = physNamesPresent.length >= sortedPhysNames.length;
  const frameOk = physNamesPresent.every((n) => byName.get(n).length === maxFrame + 1);
  const frameRangeOk = physNamesPresent.every((n) => {
    const fs_ = byName.get(n).map((m) => m.frameNum);
    return Math.min(...fs_) === 0 && Math.max(...fs_) === maxFrame;
  });
  const morphCountOk = back.morphs.length === vmdRaw.morphs.length;
  // 动作骨（非物理）：回读值(已转RIGHT) 与原始 vmdRaw(也已是RIGHT) 一致
  let actionBoneOk = true;
  let actionBoneTotal = 0;
  for (const m of vmdRaw.motions) {
    if (physicsBoneNames.has(m.boneName)) continue;
    actionBoneTotal++;
    const o = byName.get(m.boneName)?.find((x) => x.frameNum === m.frameNum);
    if (!o) { actionBoneOk = false; break; }
    for (let i = 0; i < 3; i++) {
      if (Math.abs(o.position[i] - m.position[i]) > 1e-6) { actionBoneOk = false; break; }
    }
    if (!actionBoneOk) break;
  }
  // 物理骨 position 抽查：MMD 物理骨约定 position 恒 0（只写 rotation），回读值（已转 RIGHT）应全部为 0 且数量正确
  let posRelOk = true;
  let posRelSample = 0;
  for (const name of physNamesPresent) {
    const list = byName.get(name);
    if (!list) continue;
    posRelSample++;
    for (const m of list) {
      if (!Number.isFinite(m.position[0]) || Math.abs(m.position[0]) > 1e-6 ||
          !Number.isFinite(m.position[1]) || Math.abs(m.position[1]) > 1e-6 ||
          !Number.isFinite(m.position[2]) || Math.abs(m.position[2]) > 1e-6) { posRelOk = false; break; }
    }
    if (!posRelOk) break;
  }
  console.log('--- self-check ---');
  console.log(`physics bones present: ${physNamesPresent.length}/${sortedPhysNames.length} (${assertPhysCount ? 'OK' : 'FAIL'})`);
  console.log(`each physics bone frames: ${frameOk ? `OK (${maxFrame + 1})` : 'FAIL'}`);
  console.log(`frame range 0..${maxFrame}: ${frameRangeOk ? 'OK' : 'FAIL'}`);
  console.log(`morph count: ${back.morphs.length} (${morphCountOk ? 'OK' : 'FAIL'})`);
  console.log(`action bone preserved (non-physics): ${actionBoneTotal} frames ${actionBoneOk ? 'OK' : 'FAIL'}`);
  console.log(`physics pos all-zero (sample ${posRelSample}): ${posRelOk ? 'OK' : 'FAIL'}`);
  const allOk = assertPhysCount && frameOk && frameRangeOk && morphCountOk && actionBoneOk && posRelOk;
  console.log(allOk ? 'SELF-CHECK PASS' : 'SELF-CHECK FAIL');
  if (!allOk) process.exitCode = 1;
}

if (cli.selfCheck) selfCheck(outBytes);
