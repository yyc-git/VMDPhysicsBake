#!/usr/bin/env node
// bake-game.mjs — VMD 物理烘焙（游戏同款链路：完全复刻运行时 MMDAnimationHelper 默认驱动）
// 输入：PMX 模型 + 原始动作 VMD（pickup.vmd）
// 输出：物理骨逐帧烘焙 VMD（pickup_bake_game.vmd），动作骨关键帧原样保留，morph 原样复制
//
// 与 bake-physics.mjs（patch 版）的关系：
//   bake-physics.mjs 手写循环 + 大量人为 patch（springStiffnessScale÷1000、solverIterations=50、
//   damping、ERP/CFM、zone rules、temporal kinematic init、kinematic smoothing）。
//   游戏运行时（MMD.ts）是 `new MMDAnimationHelper()` 零参数 + `helper.add(mesh,{animation,physics:true})`
//   + `helper.configuration.pmxAnimation=true`（PMX）+ 每帧 `helper.update(delta)`，
//   内部 MMDPhysics 全部用默认参数（unitStep=1/65, maxStepNum=3, gravity=(0,-98,0), warmup=60）。
//
//   本脚本 100% 复刻游戏链路：零参数 helper、内部自动 warmup、零 patch。
import * as THREE from 'three';
import { Skeleton, SkinnedMesh, Bone, BufferGeometry } from 'three';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// ---- Node ESM hook：lib/ 内 webpack 风格 import + pako 命名导出（见 resolve-ext.mjs / pako-esm-hook.mjs）----
await import('./register-hooks.mjs');

// ---- 路径基准：以本文件所在目录为根，不依赖 cwd ----
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../../');
const resolveFrom = (base, p) => (path.isAbsolute(p) ? p : path.resolve(base, p));

// ---- CLI 解析（--config / --pmx / --vmd / --output / --frame-rate / --self-check）----
function parseCli(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--pmx') args.pmx = argv[++i];
    else if (a === '--vmd') args.vmd = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--frame-rate') args.frameRate = Number(argv[++i]);
    else if (a === '--self-check') args.selfCheck = true;
  }
  return args;
}

const cli = parseCli(process.argv);
const configPath = resolveFrom(SCRIPT_DIR, cli.config || 'bake-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const PMX_PATH = cli.pmx ? resolveFrom(SCRIPT_DIR, cli.pmx) : resolveFrom(SCRIPT_DIR, config.pmx);
const VMD_RAW_PATH = cli.vmd ? resolveFrom(SCRIPT_DIR, cli.vmd) : resolveFrom(SCRIPT_DIR, config.vmdRaw);
// 输出默认与 config.output 同目录，文件名 pickup_bake_game.vmd（不覆盖现有 pickup_bake.vmd）
const DEFAULT_OUT = path.join(path.dirname(resolveFrom(SCRIPT_DIR, config.output)), 'pickup_bake_game.vmd');
const VMD_OUT_PATH = cli.output ? resolveFrom(SCRIPT_DIR, cli.output) : DEFAULT_OUT;
// 帧率：默认 30（与 bake-physics 一致，纯采样步长；不注入任何物理参数）
const frameRate = cli.frameRate ?? (config.physicsParams?.frameRate ?? 30);

// ---- Ammo 全局注入（MMDPhysics 构造依赖 globalThis.Ammo）----
// 2026-08-07：换用与浏览器一致 ammo.wasm.js（wasm 版），替代 npm ammojs-typed/ammo/ammo.js（非 wasm 构建）。
// 仓库内 lib/ammo/ammo.wasm.js 是 emscripten UMD 构建（尾部 CJS 导出 module.exports = Ammo），
// Node 下用 createRequire 拿工厂函数；wasm 二进制用 { wasmBinary } 注入，
// 跳过 emscripten 的 fetch 本地路径（Node 24 fetch 对文件路径失败）。
import { createRequire } from 'module';
const AMMO_JS = resolveFrom(PROJECT_ROOT, 'lib/ammo/ammo.wasm.js');
const AMMO_WASM = AMMO_JS.replace(/\.js$/, '.wasm');
const ammoFactory = createRequire(import.meta.url)(AMMO_JS);
globalThis.Ammo = await ammoFactory({ wasmBinary: fs.readFileSync(AMMO_WASM) });
console.log('Ammo source: ammo.wasm.js (wasm 版) @', AMMO_JS, '| wasm bytes:', fs.statSync(AMMO_WASM).size);

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

// ---- 1. MMDLoader 风格 bone 数据（与 mesh.geometry.userData.MMD.bones 完全一致）----
// 参照 lib/MMDLoader.js GeometryBuilder.build：
//   boneTypeTable：从 rigidBodies 计算（boneTypeTable[boneIndex] = max(type)）
//   bones[i] = { index, transformationClass, parent, name, pos(相对父骨), rotq, scl, rigidBodyType }
//   bones[i].ik / .grant 挂载（_animatePMXMesh → updateOne 依赖 boneData.grant / boneData.ik）
const boneData = pmx.bones;
const boneTypeTable = [];
for (const body of pmx.rigidBodies) {
  const value = boneTypeTable[body.boneIndex];
  boneTypeTable[body.boneIndex] = value === undefined ? body.type : Math.max(body.type, value);
}
const mmdBones = boneData.map((bd, i) => ({
  index: i,
  transformationClass: bd.transformationClass,
  parent: bd.parentIndex,
  name: bd.name,
  pos: bd.position.slice(0, 3),
  rotq: [0, 0, 0, 1],
  scl: [1, 1, 1],
  rigidBodyType: boneTypeTable[i] !== undefined ? boneTypeTable[i] : -1
}));
// pos 转相对父骨（MMDLoader L1080-1083）
for (let i = 0; i < mmdBones.length; i++) {
  const parent = mmdBones[i].parent;
  if (parent !== -1 && parent < mmdBones.length) {
    for (let k = 0; k < 3; k++) mmdBones[i].pos[k] -= mmdBones[parent].pos[k];
  }
}

// ---- 2. iks / grants（构造逻辑与 bake-physics.mjs 相同，另挂到 mmdBones 供 updateOne 使用）----
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
  mmdBones[i].ik = param; // MMDLoader L1180
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
    if (entry.param) {
      grants.push(entry.param);
      mmdBones[entry.param.index].grant = entry.param; // MMDLoader L1240
    }
    entry.visited = true;
    for (const child of entry.children) if (!child.visited) traverse(child);
  }
  traverse(rootEntry);
}
console.log(`iks=${iks.length} grants=${grants.length}`);

// ---- 3. rigidBodyParams（position 相对骨 offset，MMDPhysics RigidBody 语义）----
const rigidBodyParams = pmx.rigidBodies.map((rb, i) => {
  const p = { ...rb };
  if (p.boneIndex !== -1 && p.boneIndex < boneData.length) {
    p.position = [rb.position[0] - boneData[rb.boneIndex].position[0], rb.position[1] - boneData[rb.boneIndex].position[1], rb.position[2] - boneData[rb.boneIndex].position[2]];
  }
  return p;
});

// ---- 4. userData.MMD + mesh（MMDLoader initBones 风格：骨 local 位置 = 相对父骨 pos）----
const geo = new BufferGeometry();
geo.userData.MMD = {
  bones: mmdBones,
  iks,
  grants,
  rigidBodies: rigidBodyParams,
  constraints: pmx.constraints,
  format: 'pmx'
};
const mesh = new SkinnedMesh(geo);
mesh.morphTargetDictionary = {}; // 空 morph，animationBuilder 跳过 morph tracks（morph 由本脚本原样复制）

// THREE Bone 层级：bone.position = 相对父骨 pos（与 MMDLoader initBones 一致）
const bones = [];
for (let i = 0; i < mmdBones.length; i++) {
  const b = new Bone();
  b.name = mmdBones[i].name;
  b.position.fromArray(mmdBones[i].pos);
  bones.push(b);
}
for (let i = 0; i < mmdBones.length; i++) {
  const parent = mmdBones[i].parent;
  if (parent !== -1 && parent < bones.length) bones[parent].add(bones[i]);
  else mesh.add(bones[i]);
}
const skeleton = new Skeleton(bones);
mesh.bind(skeleton);
mesh.updateMatrixWorld(true);

// ---- 5. 构建 clip（与 bake-physics 相同的 animationBuilder.build）----
const loaderMod = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'lib/MMDLoader.js')).href);
const loader = new loaderMod.MMDLoader();
const clip = loader.animationBuilder.build(vmdRaw, mesh);
console.log('clip tracks:', clip.tracks.length, 'duration:', clip.duration);

// 前置 idle 动画（对齐游戏链路：角色先 idle 稳定物理，再切 pickup；demo/assets 无 idle.vmd 时跳过）
const IDLE_VMD_PATH = resolveFrom(PROJECT_ROOT, 'demo/assets/idle.vmd');
let idleClip = null;
if (fs.existsSync(IDLE_VMD_PATH)) {
  const idleVmd = parser.parseVmd(readBuf(IDLE_VMD_PATH), true);
  idleClip = loader.animationBuilder.build(idleVmd, mesh);
  console.log('idle clip tracks:', idleClip.tracks.length, 'duration:', idleClip.duration);
}

// ---- 6. MMDAnimationHelper 零参数驱动（完全复刻游戏运行时链路）----
const { MMDAnimationHelper } = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'lib/MMDAnimationHelper.js')).href);
const helper = new MMDAnimationHelper(); // 零参数全默认：unitStep/maxStepNum/gravity/warmup 均走 MMDPhysics 默认
// 顺序与游戏完全一致（InitWhenImportScene.ts L261-270）：
//   1. helper.add（内部 _setupMeshPhysics 自动 warmup：此时 pmxAnimation 仍 false → 走非 PMX 的 IK+Grant 路径）
//   2. 之后才设 pmxAnimation=true（仅影响后续 helper.update 的 PMX 路径）
//   3. Girl.ts L466-468 helper.enabled.physics = true
//   4. play 启动 clipAction（mixer.update 需要 action 播放）
helper.add(mesh, { animation: [['bake', clip], ...(idleClip ? [['idle', idleClip]] : [])], physics: true, warmup: 0 }); // warmup:0 → 我们自己控制物理 warmup（先 setEquilibriumPoint 再 idle 热身）
helper.configuration.pmxAnimation = true;
helper.enabled.physics = true;
helper.play(mesh, 'bake');

// ---- 6.4 setEquilibriumPoint patch（对齐 MMM/Bullet 原生：弹簧约束设平衡点）----
// three.js MMDPhysics 原版不调 setEquilibriumPoint → 弹簧平衡点 = 创建时姿态（物理未稳定）
// → 物理稳定后裙子骨偏离绑定姿态 25-70°（悬空根因）。MMM/Bullet 原生调用 → 稳定后 = 绑定姿态。
// 必须在物理 warmup 前调用（骨骼处于绑定/动画 t0 姿态）。
{
  const physObj = helper.objects.get(mesh);
  if (physObj && physObj.physics) {
    try {
      let eqCount = 0;
      for (const c of physObj.physics.constraints) {
        if (c.constraint && typeof c.constraint.setEquilibriumPoint === 'function') {
          c.constraint.setEquilibriumPoint();
          eqCount++;
        }
      }
      console.log('setEquilibriumPoint patch:', eqCount, 'constraints');
    } catch (e) { console.warn('equilibrium patch failed:', e.message); }
  } else {
    console.warn('physics object not found for equilibrium patch');
  }
}

// ---- 6.5 可选阻尼 patch（对齐 MMM/Bullet 原生的弹簧阻尼，默认 0 保持游戏同款；config 可调）----
// 游戏 MMDPhysics 无 setDamping（欠阻尼振荡）；MMM BulletSharp 可能有。
// 实验：bake 摆动不衰减（45-75 帧持续 120°+），加小阻尼让摆动收敛。
const springDamping = config.physicsParams?.springDamping ?? 0;
if (springDamping > 0 && helper.objects && helper.objects.get) {
  const physObj = helper.objects.get(mesh);
  if (physObj && physObj.physics) {
    try {
      for (const c of physObj.physics.constraints) {
        if (typeof c.constraint.setDamping === 'function') {
          for (let i = 0; i < 6; i++) c.constraint.setDamping(i, springDamping);
        }
      }
      console.log('spring damping patch:', springDamping);
    } catch (e) { console.warn('damping patch failed:', e.message); }
  } else {
    console.warn('physics object not found for damping patch');
  }
}

// ---- 7. 物理骨集合（rigidBody type 1/2 && boneIndex !== -1，与 bake-physics 一致）----
const physicsBoneIndices = new Set();
for (const rb of pmx.rigidBodies) {
  if (rb.type === 1 || rb.type === 2) physicsBoneIndices.add(rb.boneIndex);
}
const physBoneIndices = [...physicsBoneIndices].filter((i) => i !== -1);
const physicsBoneNames = new Set(physBoneIndices.map((i) => bones[i].name));
console.log('physics-driven bones:', physicsBoneNames.size);

// ★ 诊断：物理 warmup 前（绑定姿态）裙子骨角度
const diagAngOf = (q) => 2 * Math.acos(Math.min(1, Math.max(-1, q[3]))) * 180 / Math.PI;
const diagSkirts = physBoneIndices.map(i => bones[i]).filter(b => b.name.startsWith('スカート')).slice(0, 5);
console.log('DIAG bind pose skirt bones (before update):');
for (const b of diagSkirts) console.log('  bone#' + b.name.charCodeAt(0) + ' ang=' + diagAngOf(b.quaternion).toFixed(1) + ' deg');

// ---- 7.5 前置 idle 热身（对齐游戏：idle 稳定物理后再切 pickup）----
// 游戏：角色常驻 idle，物理 warmup 后稳定；玩家操作才切 pickup。
// ★ 2026-08-07 再改：MMM 烘焙 frame0 = 绑定姿态（0°），物理从绑定姿态开始响应 pickup。
//   idle warmup 会把物理稳定到「非绑定姿态」（three.js 物理固有偏移 25-70°）→ MMD 里悬空。
//   改为：setEquilibriumPoint（平衡点=绑定姿态）+ 少量 warmup 让物理稳定在绑定附近，再播 pickup。
const physDt = 1 / 60; // 游戏同款物理步长
const idleSnapshot = new Map(); // boneName -> {position, quaternion}（绑定姿态，frame0）
if (idleClip) {
  helper.stop(mesh, 'bake');
  helper.play(mesh, 'idle');
  // 跑少量 warmup（60 物理帧）让物理从绑定姿态稳定（equilibrium 已设 → 稳定在绑定附近）
  for (let i = 0; i < 60; i++) helper.update(physDt);
  // ★ 记录当前姿态作为 frame0 基准（应为绑定姿态≈0°，equilibrium 已把物理拉回绑定）
  for (const bi of physBoneIndices) {
    const bone = bones[bi];
    idleSnapshot.set(bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
  }
  helper.stop(mesh, 'idle');
  helper.play(mesh, 'bake');
  console.log('warmup60 done (with equilibrium, frame0 ≈ 绑定姿态)');
}

// ---- 8. 逐帧 helper.update(dt) + 记录物理骨（frame N = 动画 t=N/30 的物理响应）----
// helper.update(delta) 内部：_restoreBones → mixer.update(delta) → _saveBones → PMX 路径(IK+Grant) → physics.update(delta)
// 对齐 bake-physics 语义：先记录当前帧（t=N*dt）再推进动画（t=(N+1)*dt）
// 2026-08-07 修复：物理步进用 1/60（游戏 Device.getDelta 同款步长），每 2 物理步记 1 动画帧（30fps 采样）
// 游戏每帧 helper.update(0.0167)：maxStepNum=2, stepTime=0.0167；bake 原用 0.0333 → 步长不同 → 弹簧响应差 → 摆动不足
const recordEvery = Math.max(1, Math.round((1 / frameRate) / physDt)); // 30fps → 每 2 步记 1 次
const records = new Map(); // boneName -> [{frame, position, rotation}]
helper.update(0); // 先应用 t=0 姿态（add 时 action 尚未播放，mixer.update(0) 不生效，需补一次）
// ★ 记录「绝对局部旋转」（对齐 MMM：物理骨 rotation = 相对父骨的最终旋转，含父骨补偿）
// setEquilibriumPoint 后物理稳定姿态 = 绑定姿态（frame0 ≈ 0°），后续帧 = 物理响应的绝对局部旋转。
// 用绝对记录，MMD 播放时：父骨（pickup 动画）+ 物理骨局部旋转 = 正确下垂姿态。
// （relbase 相对 idle 基准的 delta 会含父骨补偿差 → MMD 叠加后外翻 → 不要用）
for (let frame = 0; frame <= maxFrame; frame++) {
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
  if (frame < maxFrame) {
    for (let s = 0; s < recordEvery; s++) helper.update(physDt);
  }
}
console.log('recorded physics bones:', records.size, '(physDt=1/60, recordEvery=' + recordEvery + ')');

// ---- 9. 合并写出（SJIS 宽容名 / 动作骨保留 / 物理骨逐帧 / morph 复制 / LEFT 空间）----
const sjisSafeName = (name) =>
  [...name]
    .map((ch) => {
      const bytes = sanitizeSjis(ch);
      return bytes.length === 1 && bytes[0] === 0x3f ? '?' : ch;
    })
    .join('');

const outMotions = [];
// ★ 2026-08-07 兄弟确认：MMM 烘焙 = 原 VMD 动画骨 transform 原样保留 + 追加物理骨 transform。
//   动画骨从 pickup.vmd 原样复制（不修改），物理骨在后面追加。
for (const m of vmdRaw.motions) {
  if (physicsBoneNames.has(m.boneName)) continue;
  outMotions.push({ boneName: m.boneName, frameNum: m.frameNum, position: [...m.position], rotation: [...m.rotation], interpolation: [...m.interpolation] });
}

const sortedPhysNames = [...physicsBoneNames].sort();
const outPhysNameOf = new Map();
for (const name of sortedPhysNames) outPhysNameOf.set(name, sjisSafeName(name));
for (const name of sortedPhysNames) {
  const recs = records.get(name);
  if (!recs) continue;
  const outName = outPhysNameOf.get(name);
  for (const r of recs) {
    outMotions.push({
      boneName: outName,
      frameNum: r.frame,
      position: [0, 0, 0], // MMD 物理骨约定：position 不写（位置由 PMX 绑定+父骨链决定），只写 rotation
      rotation: [...r.rotation],
      interpolation: new Array(64).fill(0)
    });
  }
}

const morphs = vmdRaw.morphs.map((m) => ({ morphName: m.morphName, frameNum: m.frameNum, weight: m.weight }));

// 坐标空间转换（LEFT 空间存储，与 bake-physics 一致）
const toFilePosition = (p) => [p[0], p[1], -p[2]];
const toFileRotation = (q) => [-q[0], -q[1], q[2], q[3]];
for (const m of outMotions) {
  m.position = toFilePosition(m.position);
  m.rotation = toFileRotation(m.rotation);
}

const outBytes = writeVmd('pickup_bake_game', outMotions, morphs);
helper.dispose && helper.dispose();
if (!cli.selfCheck) {
  fs.mkdirSync(path.dirname(VMD_OUT_PATH), { recursive: true });
  fs.writeFileSync(VMD_OUT_PATH, outBytes);
  console.log(`written: ${VMD_OUT_PATH} (${outBytes.length} bytes) motions=${outMotions.length} morphs=${morphs.length}`);
}

// ---- 10. 自检：MMDParser 回读断言 ----
if (cli.selfCheck) {
  const back = parser.parseVmd(outBytes.buffer.slice(outBytes.byteOffset, outBytes.byteOffset + outBytes.byteLength), true);
  const byName = new Map();
  for (const m of back.motions) {
    if (!byName.has(m.boneName)) byName.set(m.boneName, []);
    byName.get(m.boneName).push(m);
  }
  const outNames = [...new Set(outPhysNameOf.values())];
  const physNamesPresent = outNames.filter((n) => byName.has(n));
  const assertPhysCount = physNamesPresent.length >= sortedPhysNames.length;
  const frameOk = physNamesPresent.every((n) => byName.get(n).length === maxFrame + 1);
  const frameRangeOk = physNamesPresent.every((n) => {
    const fs_ = byName.get(n).map((m) => m.frameNum);
    return Math.min(...fs_) === 0 && Math.max(...fs_) === maxFrame;
  });
  const morphCountOk = back.morphs.length === vmdRaw.morphs.length;
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
  let posRelOk = true;
  for (const name of physNamesPresent) {
    for (const m of byName.get(name)) {
      if (!Number.isFinite(m.position[0]) || Math.abs(m.position[0]) > 1e-6 ||
          !Number.isFinite(m.position[1]) || Math.abs(m.position[1]) > 1e-6 ||
          !Number.isFinite(m.position[2]) || Math.abs(m.position[2]) > 1e-6) { posRelOk = false; break; }
    }
  }
  console.log('--- self-check ---');
  console.log(`physics bones present: ${physNamesPresent.length}/${sortedPhysNames.length} (${assertPhysCount ? 'OK' : 'FAIL'})`);
  console.log(`each physics bone frames: ${frameOk ? `OK (${maxFrame + 1})` : 'FAIL'}`);
  console.log(`frame range 0..${maxFrame}: ${frameRangeOk ? 'OK' : 'FAIL'}`);
  console.log(`morph count: ${back.morphs.length} (${morphCountOk ? 'OK' : 'FAIL'})`);
  console.log(`action bone preserved: ${actionBoneTotal} frames ${actionBoneOk ? 'OK' : 'FAIL'}`);
  console.log(`physics pos all-zero: ${posRelOk ? 'OK' : 'FAIL'}`);
  const allOk = assertPhysCount && frameOk && frameRangeOk && morphCountOk && actionBoneOk && posRelOk;
  console.log(allOk ? 'SELF-CHECK PASS' : 'SELF-CHECK FAIL');
  if (!allOk) process.exitCode = 1;
}
