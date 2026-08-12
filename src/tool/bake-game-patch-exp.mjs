// 判别实验：bake-game + spring 单位换算 patch（÷2000 + solver50）跑 Vanilla
// 目的：验证「spring 刚度大 2000 倍 → 约束超硬 → 数值发散」假设
// 用法：node src/tool/bake-game-patch-exp.mjs --config <config json>
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// ---- Node ESM hook：lib/ 内 webpack 风格 import + pako 命名导出 ----
await import('./register-hooks.mjs');

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../../');
const resolveFrom = (base, p) => (path.isAbsolute(p) ? p : path.resolve(base, p));

function parseCli(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--pmx') args.pmx = argv[++i];
    else if (a === '--vmd') args.vmd = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--frame-rate') args.frameRate = Number(argv[++i]);
  }
  return args;
}

const cli = parseCli(process.argv);
const configPath = resolveFrom(SCRIPT_DIR, cli.config || 'bake-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const PMX_PATH = cli.pmx ? resolveFrom(SCRIPT_DIR, cli.pmx) : resolveFrom(SCRIPT_DIR, config.pmx);
const VMD_RAW_PATH = cli.vmd ? resolveFrom(SCRIPT_DIR, cli.vmd) : resolveFrom(SCRIPT_DIR, config.vmdRaw);
const VMD_OUT_PATH = cli.output ? resolveFrom(SCRIPT_DIR, cli.output) : path.join(path.dirname(resolveFrom(SCRIPT_DIR, config.output)), 'pickup_bake_game_patch_exp.vmd');
const frameRate = cli.frameRate ?? 30;

console.log(`PMX: ${PMX_PATH}`);
console.log(`VMD: ${VMD_RAW_PATH}`);
console.log(`OUT: ${VMD_OUT_PATH}`);

// ---- Ammo（仓库内 lib/ammo 的 wasm 版）----
const wasmBinary = fs.readFileSync(resolveFrom(PROJECT_ROOT, 'lib/ammo/ammo.wasm.wasm'));
const AmmoModule = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'lib/ammo/ammo.wasm.js')).href);
const Ammo = await AmmoModule.default({ wasmBinary });
globalThis.Ammo = Ammo;

// ---- 加载 PMX ----
const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();
const pmxBuf = fs.readFileSync(PMX_PATH);
const pmxAb = pmxBuf.buffer.slice(pmxBuf.byteOffset, pmxBuf.byteOffset + pmxBuf.byteLength);
const pmx = parser.parsePmx(pmxAb, true);
const boneData = pmx.bones;

// ---- VMD ----
const vmdBuf = fs.readFileSync(VMD_RAW_PATH);
const vmdAb = vmdBuf.buffer.slice(vmdBuf.byteOffset, vmdBuf.byteOffset + vmdBuf.byteLength);
const vmdRaw = parser.parseVmd(vmdAb, true);
const maxFrame = vmdRaw.motions.length ? Math.max(...vmdRaw.motions.map((m) => m.frameNum)) : 0;

// ---- THREE + MMDBones（与 bake-game 相同构造）----
const THREE = await import('three');
const { SkinnedMesh, BufferGeometry, Bone, Skeleton } = THREE;
// boneTypeTable（rigidBody type 优先级，MMDLoader L1050-1060）
const boneTypeTable = {};
for (const rb of pmx.rigidBodies) {
  const value = boneTypeTable[rb.boneIndex] === undefined ? rb.type : Math.max(boneTypeTable[rb.boneIndex], rb.type);
  boneTypeTable[rb.boneIndex] = value;
}
const mmdBones = [];
for (let i = 0; i < boneData.length; i++) {
  const b = {
    index: i,
    transformationClass: boneData[i].transformationClass,
    parent: boneData[i].parentIndex,
    name: boneData[i].name,
    pos: [...boneData[i].position],
    rotq: [0, 0, 0, 1],
    scl: [1, 1, 1],
    rigidBodyType: boneTypeTable[i] !== undefined ? boneTypeTable[i] : -1
  };
  mmdBones.push(b);
}
// pos 转相对父骨（MMDLoader L1080-1083）
for (let i = 0; i < mmdBones.length; i++) {
  const parent = mmdBones[i].parent;
  if (parent !== -1 && parent < mmdBones.length) {
    for (let k = 0; k < 3; k++) mmdBones[i].pos[k] -= mmdBones[parent].pos[k];
  }
}

// IK 构造（复用 bake-game 逻辑）
const iks = [];
for (let i = 0; i < boneData.length; i++) {
  const ik = boneData[i].ik;
  if (ik === undefined) continue;
  const param = { target: i, effector: ik.effector, iteration: ik.iteration, maxAngle: ik.maxAngle, links: [] };
  for (let j = 0; j < ik.links.length; j++) {
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
  mmdBones[i].ik = param;
}

// Grant 构造
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
      mmdBones[entry.param.index].grant = entry.param;
    }
    entry.visited = true;
    for (const child of entry.children) if (!child.visited) traverse(child);
  }
  traverse(rootEntry);
}
console.log(`iks=${iks.length} grants=${grants.length}`);

// rigidBodyParams（相对骨 offset，与 bake-game 相同）
const rigidBodyParams = pmx.rigidBodies.map((rb, i) => {
  const p = { ...rb };
  if (p.boneIndex !== -1 && p.boneIndex < boneData.length) {
    p.position = [rb.position[0] - boneData[rb.boneIndex].position[0], rb.position[1] - boneData[rb.boneIndex].position[1], rb.position[2] - boneData[rb.boneIndex].position[2]];
  }
  return p;
});

const geo = new BufferGeometry();
geo.userData.MMD = { bones: mmdBones, iks, grants, rigidBodies: rigidBodyParams, constraints: pmx.constraints, format: 'pmx' };
const mesh = new SkinnedMesh(geo);
mesh.morphTargetDictionary = {};

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

// ---- clip ----
const loaderMod = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'lib/MMDLoader.js')).href);
const loader = new loaderMod.MMDLoader();
const clip = loader.animationBuilder.build(vmdRaw, mesh);

// ---- MMDAnimationHelper（零参数）+ PATCH 注入 ----
const { MMDAnimationHelper } = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'lib/MMDAnimationHelper.js')).href);

// 🔬 判别实验 2：去掉 spring patch（验证零参数 + dt=1/60 是否对齐游戏）
// const _origSetStiffness = Ammo.btGeneric6DofSpringConstraint.prototype.setStiffness;
// Ammo.btGeneric6DofSpringConstraint.prototype.setStiffness = function (idx, val) {
//   return _origSetStiffness.call(this, idx, val / 2000);
// };

const helper = new MMDAnimationHelper();
helper.add(mesh, { animation: [['bake', clip]], physics: true });
// solver 迭代（bake-physics 实锤 50）
try {
  const solverInfo = helper.objects ? null : null;
} catch (e) {}
// helper 内部 MMDPhysics 在 add 时创建，先取出来设置 solver
// MMDAnimationHelper._setupMeshPhysics → _createMMDPhysics → new MMDPhysics(mesh, ...)
// 通过 mesh 上引用拿 physics？没有直接引用，改为在 add 后遍历 helper.objects
const physObj = helper.objects[mesh.uuid];
if (physObj && physObj.physics) {
  try {
    const solverInfo = physObj.physics.world.getSolverInfo();
    solverInfo.set_m_numIterations(50);
    console.log('solver iterations set: 50');
  } catch (e) { console.warn('solver set failed:', e.message); }
} else {
  console.warn('physics object not found for mesh, solver not set');
}

helper.configuration.pmxAnimation = true;
helper.enabled.physics = true;
helper.play(mesh, 'bake');

// ---- 物理骨集合 ----
const physicsBoneIndices = new Set();
for (const rb of pmx.rigidBodies) {
  if (rb.type === 1 || rb.type === 2) physicsBoneIndices.add(rb.boneIndex);
}
const physBoneIndices = [...physicsBoneIndices].filter((i) => i !== -1);

// ---- 逐帧记录 ----
// 判别实验 2：物理 update 用 dt=1/60（游戏 Device.getDelta 同款），记录仍按 30fps 采样
const physDt = 1 / 60; // 游戏 60fps 同款
const recordEvery = Math.round((1 / frameRate) / physDt); // 30fps → 每 2 个物理步记 1 次
const records = new Map();
helper.update(0);
for (let frame = 0; frame <= maxFrame; frame++) {
  for (const bi of physBoneIndices) {
    const bone = bones[bi];
    const name = bone.name;
    if (!records.has(name)) records.set(name, []);
    records.get(name).push({ frame, position: bone.position.toArray(), rotation: bone.quaternion.toArray() });
  }
  if (frame < maxFrame) {
    for (let s = 0; s < recordEvery; s++) helper.update(physDt);
  }
}
console.log('recorded physics bones:', records.size, '(physDt=1/60, recordEvery=' + recordEvery + ')');

// ---- 分析记录：相对首帧最大摆角（归一化翻转）----
const angOf = (q) => 2 * Math.acos(Math.min(1, Math.max(-1, q[3]))) * 180 / Math.PI;
const results = [];
for (const [name, arr] of records) {
  const sorted = [...arr].sort((a, b) => a.frame - b.frame);
  const norm = sorted.map(m => ({ f: m.frame, q: [...m.rotation] }));
  if (norm.length && norm[0].q[3] < 0) norm[0].q = norm[0].q.map(v => -v);
  for (let i = 1; i < norm.length; i++) {
    const q0 = norm[i-1].q, q1 = norm[i].q;
    const dot = q0[0]*q1[0] + q0[1]*q1[1] + q0[2]*q1[2] + q0[3]*q1[3];
    if (dot < 0) norm[i].q = q1.map(v => -v);
  }
  let maxAng = 0, maxF = -1;
  const q0 = norm[0] ? norm[0].q : null;
  if (q0) {
    for (const { f, q } of norm) {
      const dot = q0[0]*q[0] + q0[1]*q[1] + q0[2]*q[2] + q0[3]*q[3];
      const relAng = 2 * Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
      if (relAng > maxAng) { maxAng = relAng; maxF = f; }
    }
  }
  if (/スカート|Skirt|skirt|_yure_|髪|hair/i.test(name)) {
    results.push({ name, maxAng, maxF, frames: norm.length });
  }
}
results.sort((a, b) => b.maxAng - a.maxAng);
console.log('=== PATCH(÷2000+solver50) 后物理骨最大摆角 top 20 ===');
for (const { name, maxAng, maxF, frames } of results.slice(0, 20)) {
  console.log(`${name}: ${maxAng.toFixed(1)}° @f${maxF} (${frames}帧)`);
}

// ---- 写 VMD 产物（供后续对比）----
const { writeVmd } = await import(pathToFileURL(resolveFrom(SCRIPT_DIR, './vmd-writer.mjs')).href);
const outMotions = [];
for (const m of vmdRaw.motions) outMotions.push({ boneName: m.boneName, frameNum: m.frameNum, position: [...m.position], rotation: [...m.rotation], interpolation: [...m.interpolation] });
const physNames = new Set(physBoneIndices.map((i) => bones[i].name));
for (const name of [...physNames].sort()) {
  const recs = records.get(name);
  if (!recs) continue;
  for (const r of recs) {
    outMotions.push({ boneName: name, frameNum: r.frame, position: [0, 0, 0], rotation: [...r.rotation], interpolation: new Array(64).fill(0) });
  }
}
const morphs = vmdRaw.morphs.map((m) => ({ morphName: m.morphName, frameNum: m.frameNum, weight: m.weight }));
const toFilePosition = (p) => [p[0], p[1], -p[2]];
const toFileRotation = (q) => [-q[0], -q[1], q[2], q[3]];
for (const m of outMotions) {
  m.position = toFilePosition(m.position);
  m.rotation = toFileRotation(m.rotation);
}
const outBytes = writeVmd('pickup_bake_game_patch_exp', outMotions, morphs);
fs.mkdirSync(path.dirname(VMD_OUT_PATH), { recursive: true });
fs.writeFileSync(VMD_OUT_PATH, outBytes);
console.log(`written: ${VMD_OUT_PATH} (${outBytes.length} bytes) motions=${outMotions.length}`);
process.exit(0);
