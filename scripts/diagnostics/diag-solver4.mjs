// 诊断9：solver 迭代 + gravity + 帧内子步 对起身段（f38-50）前髪抖动的影响
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
const readBuf = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const pmx = parser.parsePmx(readBuf(resolveFrom(PROJECT_ROOT, 'mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx')), true);
const vmdRaw = parser.parseVmd(readBuf(resolveFrom(PROJECT_ROOT, 'packages/frontend/src/resource_girl/city/vmd_160/pickup.vmd')), true);
const maxFrame = vmdRaw.motions.length ? Math.max(...vmdRaw.motions.map((m) => m.frameNum)) : 0;
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
const loaderMod = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'packages/meta3d-jiehuo-abstract/src/three/MMDLoader.js')).href);
const loader = new loaderMod.MMDLoader();
const clip = loader.animationBuilder.build(vmdRaw, mesh);
const mixer = new THREE.AnimationMixer(mesh);
const action = mixer.clipAction(clip);
action.play();
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
const { CCDIKSolver } = await import('three/examples/jsm/animation/CCDIKSolver.js');
const ikSolver = new CCDIKSolver(mesh, iks);
const _q = new THREE.Quaternion();
const grantSolver = { grants, update() {
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
}};
const { MMDPhysics } = await import(pathToFileURL(resolveFrom(PROJECT_ROOT, 'packages/meta3d-jiehuo-abstract/src/three/MMDPhysics.js')).href);
const rigidBodyParams = pmx.rigidBodies.map((rb, i) => {
  const p = { ...rb };
  if (p.boneIndex !== -1 && p.boneIndex < boneData.length) {
    p.position = [rb.position[0] - boneData[rb.boneIndex].position[0], rb.position[1] - boneData[rb.boneIndex].position[1], rb.position[2] - boneData[rb.boneIndex].position[2]];
  }
  return p;
});
const maeIdx = boneData.findIndex(b => b.name === '前髪１');
const MMM = { 38: 17, 39: 17, 40: 17, 41: 16, 42: 16, 43: 16, 44: 15, 45: 14, 46: 15, 47: 15, 48: 16, 49: 16, 50: 16 };

async function run(label, opts) {
  // stiffness 换算：PMX spring 值(0-1000) → Bullet 单位（试 /100 /10 /1）
  const stiffScale = opts.stiffScale ?? 1;
  const origSetStiffness = Ammo.btGeneric6DofSpringConstraint.prototype.setStiffness;
  if (stiffScale !== 1) {
    Ammo.btGeneric6DofSpringConstraint.prototype.setStiffness = function(idx, val) { origSetStiffness.call(this, idx, val / stiffScale); };
  }
  // IK 优化：禁用物理骨(rigidBodyType>0)的 IK link（对齐 _optimizeIK）
  if (opts.disablePhysIK) {
    for (const ik of iks) {
      for (const link of ik.links) {
        const rbType = boneData[link.index]?.rigidBodyType ?? 0;
        if (rbType > 0) link.enabled = false;
      }
    }
  }
  const pp = { unitStep: opts.unitStep ?? 1 / 65, gravity: opts.gravity ?? [0, -98, 0], maxStepNum: opts.maxStepNum ?? 3 };
  const ph = new MMDPhysics(mesh, rigidBodyParams, pmx.constraints, pp);
  // solver 迭代
  if (opts.solverIterations) {
    const info = ph.world.getSolverInfo();
    info.set_m_numIterations(opts.solverIterations);
  }
  // spring eq+damping
  for (const c of ph.constraints) {
    const cst = c.constraint;
    const sp = c.params.springPosition, sr = c.params.springRotation;
    const hasSpring = (sp && sp.some(v => v !== 0)) || (sr && sr.some(v => v !== 0));
    if (!hasSpring) continue;
    if (typeof cst.setEquilibriumPoint === 'function') { try { cst.setEquilibriumPoint(); } catch (e) {} }
    if (typeof cst.setDamping === 'function') { try { for (let i = 0; i < 6; i++) cst.setDamping(i, opts.damping ?? 0.05); } catch (e) {} }
  }
  // warmup
  mixer.setTime(0); mixer.update(0);
  mesh.updateMatrixWorld(true);
  ikSolver.update(); grantSolver.update();
  ph.update(0); ph.reset();
  for (let f = 0; f < (opts.warmup ?? 60); f++) ph.update(pp.unitStep);
  const dt = 1 / 30;
  const angs = {};
  for (let frame = 0; frame <= maxFrame; frame++) {
    mesh.updateMatrixWorld(true);
    ikSolver.update(); grantSolver.update();
    ph.update(dt);
    if (maeIdx !== -1) {
      const q = bones[maeIdx].quaternion;
      const ang = 2 * Math.acos(Math.min(1, Math.max(-1, q.w))) * 180 / Math.PI;
      angs[frame] = Number.isFinite(ang) ? ang : NaN;
    }
    mixer.update(dt);
  }
  ph.dispose();
  const frames = [38, 40, 42, 44, 45, 46, 48, 50];
  const vals = frames.map(f => angs[f] !== undefined && Number.isFinite(angs[f]) ? angs[f].toFixed(0) : 'NaN');
  let err = 0;
  for (const f of frames) { const a = angs[f], t = MMM[f]; if (Number.isFinite(a)) err += Math.abs(a - t); else err += 999; }
  console.log(label.padEnd(42), vals.join(' '), ' err:', err.toFixed(0));
}

console.log('起身段(38-50)前髪角: f38 f40 f42 f44 f45 f46 f48 f50 (MMM: 17 17 16 15 14 15 16 16)');

await run('solver50+damp0.02+noPhysIK', { solverIterations: 50, damping: 0.02, disablePhysIK: true });
await run('solver50+noPhysIK', { solverIterations: 50, disablePhysIK: true });
await run('solver80+damp0.02+noPhysIK', { solverIterations: 80, damping: 0.02, disablePhysIK: true });
await run('solver50+stiff/100', { solverIterations: 50, stiffScale: 100 });
await run('solver50+stiff/10', { solverIterations: 50, stiffScale: 10 });
await run('solver50+stiff/50+damp0.05', { solverIterations: 50, stiffScale: 50, damping: 0.05 });
await run('solver50+stiff/100+damp0.05', { solverIterations: 50, stiffScale: 100, damping: 0.05 });



