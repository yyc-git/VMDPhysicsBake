// 诊断21：约束 frame 每帧跟随 type=0 刚体（对齐 MMD 原生 Bullet kinematic 行为）
import * as THREE from 'three';
import { Skeleton, SkinnedMesh, Bone, BufferGeometry } from 'three';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
globalThis.Ammo = await (await import('ammojs-typed/ammo/ammo.js')).default();

const reframe = process.argv[2] === 'on';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../../../../../../');
const resolveFrom = (base, p) => (path.isAbsolute(p) ? p : path.resolve(base, p));
const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();
const readBuf = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const pmx = parser.parsePmx(readBuf(resolveFrom(PROJECT_ROOT, 'mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx')), true);
const vmdRaw = parser.parseVmd(readBuf(resolveFrom(PROJECT_ROOT, 'packages/frontend/src/resource_girl/city/vmd_160/pickup.vmd')), true);
const mmmVmd = parser.parseVmd(readBuf(resolveFrom(PROJECT_ROOT, 'mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd')), true);
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
const _orig = Ammo.btGeneric6DofSpringConstraint.prototype.setStiffness;
Ammo.btGeneric6DofSpringConstraint.prototype.setStiffness = function (idx, val) {
  return _orig.call(this, idx, val / 2000);
};
const pp = { unitStep: 1 / 65, gravity: [0, -98, 0], maxStepNum: 3 };
const ph = new MMDPhysics(mesh, rigidBodyParams, pmx.constraints, pp);
try { ph.world.getSolverInfo().set_m_numIterations(50); } catch (e) {}
for (const c of ph.constraints) {
  const cst = c.constraint;
  const sp = c.params.springPosition, sr = c.params.springRotation;
  const hasSpring = (sp && sp.some(v => v !== 0)) || (sr && sr.some(v => v !== 0));
  if (!hasSpring) continue;
  if (typeof cst.setEquilibriumPoint === 'function') { try { cst.setEquilibriumPoint(); } catch (e) {} }
  if (typeof cst.setDamping === 'function') { try { for (let i = 0; i < 6; i++) cst.setDamping(i, 0.05); } catch (e) {} }
}
mixer.setTime(0); mixer.update(0);
mesh.updateMatrixWorld(true);
ikSolver.update(); grantSolver.update();
ph.update(0); ph.reset();
for (let f = 0; f < 60; f++) ph.update(pp.unitStep);
const dt = 1 / 30;
const physBoneNames = new Set();
for (const rb of pmx.rigidBodies) {
  if (rb.type !== 0 && rb.boneIndex !== -1) physBoneNames.add(pmx.bones[rb.boneIndex].name);
}
const recorded = {};
for (const nm of physBoneNames) recorded[nm] = [];
const ang = (q) => 2 * Math.acos(Math.min(1, Math.max(-1, q[3]))) * 180 / Math.PI;
for (let frame = 0; frame <= maxFrame; frame++) {
  mesh.updateMatrixWorld(true);
  ikSolver.update(); grantSolver.update();
  ph.update(dt);
  for (const nm of physBoneNames) {
    const idx = boneData.findIndex(b => b.name === nm);
    if (idx === -1) continue;
    const q = bones[idx].quaternion;
    recorded[nm].push({ frame, angle: Number.isFinite(q.w) ? ang(q) : NaN });
  }
  mixer.update(dt);
}
ph.dispose();
const mmmByBone = {};
for (const m of mmmVmd.motions) {
  if (!mmmByBone[m.boneName]) mmmByBone[m.boneName] = [];
  mmmByBone[m.boneName].push(m);
}
const angDiff = [];
const flips = [];
let flipTotal = 0;
for (const [nm, frames] of Object.entries(recorded)) {
  const mmm = mmmByBone[nm];
  if (!mmm) continue;
  let boneFlip = 0;
  let diffSum = 0, diffCount = 0;
  for (const rec of frames) {
    if (rec.angle > 150) boneFlip++;
    const mb = mmm.find(m => m.frameNum === rec.frame);
    if (mb) {
      const ma = ang(mb.rotation);
      diffSum += Math.abs(rec.angle - ma);
      diffCount++;
    }
  }
  if (boneFlip > 0) flips.push(`${nm}=${boneFlip}`);
  flipTotal += boneFlip;
  if (diffCount && Number.isFinite(diffSum / diffCount)) angDiff.push(diffSum / diffCount);
}
angDiff.sort((a, b) => a - b);
const median = angDiff.length ? angDiff[Math.floor(angDiff.length / 2)] : NaN;
const avg = angDiff.length ? angDiff.reduce((s, v) => s + v, 0) / angDiff.length : NaN;
console.log(`reframe=${reframe ? 'on' : 'off'} 对比骨=${angDiff.length} 平均角差=${avg.toFixed(1)}° 中位数=${median.toFixed(1)}° 翻转骨=${flips.length} 翻转总帧=${flipTotal}`);
console.log(' 翻转骨:', flips.slice(0, 15).join(', '));
