// 诊断5：验证 constraint spring 的 setEquilibriumPoint/setDamping 是否影响摆动幅度
// 复刻 bake-physics.mjs 的物理设置，但对 constraint 额外调 setEquilibriumPoint + setDamping
import * as THREE from 'three';
import { Skeleton, SkinnedMesh, Bone, BufferGeometry } from 'three';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
globalThis.Ammo = await (await import('ammojs-typed/ammo/ammo.js')).default();

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../../../../../../');
const resolveFrom = (base, p) => (path.isAbsolute(p) ? p : path.resolve(base, p));

const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();
const readBuf = (p) => { const buf = fs.readFileSync(p); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); };

const PMX_PATH = resolveFrom(PROJECT_ROOT, 'mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx');
const VMD_RAW_PATH = resolveFrom(PROJECT_ROOT, 'packages/frontend/src/resource_girl/city/vmd_160/pickup.vmd');

const pmx = parser.parsePmx(readBuf(PMX_PATH), true);
const vmdRaw = parser.parseVmd(readBuf(VMD_RAW_PATH), true);
const maxFrame = vmdRaw.motions.length ? Math.max(...vmdRaw.motions.map((m) => m.frameNum)) : 0;

// ---- 构建骨骼层级（同 bake-physics.mjs）----
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
const geo = new BufferGeometry();
const mesh = new SkinnedMesh(geo);
mesh.morphTargetDictionary = {};
const skeleton = new Skeleton(bones);
mesh.add(bones[0]);
mesh.bind(skeleton);

// AnimationBuilder
const loaderMod = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'packages/meta3d-jiehuo-abstract/src/three/MMDLoader.js')).href);
const loader = new loaderMod.MMDLoader();
const clip = loader.animationBuilder.build(vmdRaw, mesh);
const mixer = new THREE.AnimationMixer(mesh);
const action = mixer.clipAction(clip);
action.play();
const { CCDIKSolver } = await import('three/examples/jsm/animation/CCDIKSolver.js');
const iks = [];
for (let i = 0; i < boneData.length; i++) {
  const ik = boneData[i].ik;
  if (ik === undefined) continue;
  const param = { target: i, effector: ik.effector, iteration: ik.iteration, maxAngle: ik.maxAngle, links: [] };
  for (let j = 0, jl = ik.links.length; j < jl; j++) {
    const link = ik.links[j];
    param.links.push({ index: link.index, enabled: link.enabled !== undefined ? link.enabled : true });
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
const ikSolver = new CCDIKSolver(mesh, iks);
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

const { MMDPhysics } = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'packages/meta3d-jiehuo-abstract/src/three/MMDPhysics.js')).href);
const rigidBodyParams = pmx.rigidBodies.map((rb, i) => {
  const p = { ...rb };
  if (p.boneIndex !== -1 && p.boneIndex < boneData.length) {
    p.position = [rb.position[0] - boneData[rb.boneIndex].position[0], rb.position[1] - boneData[rb.boneIndex].position[1], rb.position[2] - boneData[rb.boneIndex].position[2]];
  }
  return p;
});
const physicsParams = { unitStep: 1 / 65, gravity: [0, -98, 0], maxStepNum: 3 };
const physics = new MMDPhysics(mesh, rigidBodyParams, pmx.constraints, physicsParams);

// 检查 constraint 实例能力
console.log('=== constraint 能力检查 ===');
const c0 = physics.constraints[0];
console.log('has setParam:', typeof c0.constraint.setParam);
console.log('has setDamping:', typeof c0.constraint.setDamping);
console.log('has setEquilibriumPoint:', typeof c0.constraint.setEquilibriumPoint);
console.log('springPosition[0]:', c0.params.springPosition, 'springRotation[0]:', c0.params.springRotation);
// 统计有多少 constraint 有 spring
let springCount = 0;
for (const c of physics.constraints) {
  const sp = c.params.springPosition, sr = c.params.springRotation;
  if ((sp && sp.some(v => v !== 0)) || (sr && sr.some(v => v !== 0))) springCount++;
}
console.log('spring constraints:', springCount, '/', physics.constraints.length);

// ---- 模拟函数（可配置 extraSpring）----
async function simulate({ applyEquilibrium, applyDamping }) {
  // 重新创建 physics（每次独立）
  const ph = new MMDPhysics(mesh, rigidBodyParams, pmx.constraints, physicsParams);
  if (applyEquilibrium || applyDamping) {
    for (const c of ph.constraints) {
      const cst = c.constraint;
      if (applyEquilibrium && typeof cst.setEquilibriumPoint === 'function') {
        try { cst.setEquilibriumPoint(); } catch (e) {}
      }
      if (applyDamping && typeof cst.setDamping === 'function') {
        try { for (let i = 0; i < 6; i++) cst.setDamping(i, 0.5); } catch (e) {}
      }
    }
  }
  // warmup 对齐官方
  mixer.setTime(0);
  mixer.update(0);
  mesh.updateMatrixWorld(true);
  ikSolver.update();
  grantSolver.update();
  ph.update(0);
  ph.reset();
  for (let f = 0; f < 60; f++) ph.update(physicsParams.unitStep);
  // 记录前髪１ 摆动
  const dt = 1 / 30;
  const records = new Map();
  for (let frame = 0; frame <= maxFrame; frame++) {
    mesh.updateMatrixWorld(true);
    ikSolver.update();
    grantSolver.update();
    ph.update(dt);
    for (const bi of [/* 前髪１ index 需查 */]) {}
    mixer.update(dt);
  }
  ph.dispose();
  return records;
}

// 找前髪１ bone index
const maeIdx = pmx.bones.findIndex(b => b.name === '前髪１');
const physBoneIndices = new Set();
for (const rb of pmx.rigidBodies) {
  if (rb.type === 1 || rb.type === 2) physBoneIndices.add(rb.boneIndex);
}
console.log('前髪１ index:', maeIdx, 'is physics bone:', physBoneIndices.has(maeIdx));

async function measure(label, opts) {
  const ph = new MMDPhysics(mesh, rigidBodyParams, pmx.constraints, physicsParams);
  if (opts.applyEquilibrium || opts.applyDamping) {
    for (const c of ph.constraints) {
      const cst = c.constraint;
      if (opts.applyEquilibrium && typeof cst.setEquilibriumPoint === 'function') { try { cst.setEquilibriumPoint(); } catch (e) {} }
      if (opts.applyDamping && typeof cst.setDamping === 'function') { try { for (let i = 0; i < 6; i++) cst.setDamping(i, 0.5); } catch (e) {} }
    }
  }
  mixer.setTime(0); mixer.update(0);
  mesh.updateMatrixWorld(true);
  ikSolver.update(); grantSolver.update();
  ph.update(0); ph.reset();
  for (let f = 0; f < 60; f++) ph.update(physicsParams.unitStep);
  const dt = 1 / 30;
  const angs = [];
  for (let frame = 0; frame <= maxFrame; frame++) {
    mesh.updateMatrixWorld(true);
    ikSolver.update(); grantSolver.update();
    ph.update(dt);
    if (maeIdx !== -1) {
      const q = bones[maeIdx].quaternion;
      const ang = 2 * Math.acos(Math.min(1, Math.max(-1, q.w))) * 180 / Math.PI;
      angs.push(ang);
    }
    mixer.update(dt);
  }
  ph.dispose();
  const frames = [0, 15, 30, 45, 60, 75, 90];
  console.log(label.padEnd(30), '前髪１ 角:', frames.map(f => angs[f]?.toFixed(0) || '--').join(' '));
  return angs;
}

console.log('\n=== 前髪１ 摆动幅度对比 ===');
await measure('baseline (current fix2)', {});
await measure('+ setEquilibriumPoint', { applyEquilibrium: true });
await measure('+ setDamping(0.5)', { applyDamping: true });
await measure('+ eq + damping', { applyEquilibrium: true, applyDamping: true });
console.log('\nMMM 参考: 前髪１ f15:18 f30:15 f45:14 f60:19 f75:19 f90:17');

