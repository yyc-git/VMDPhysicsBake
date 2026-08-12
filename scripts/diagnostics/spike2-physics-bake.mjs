// Spike 2: 完整烘焙闭环验证
// VMD 动作驱动骨骼 + MMDPhysics 模拟 + 逐帧记录物理骨骼变换
// 对比烘焙版 vmd 的物理骨数值（粗验证）
import * as THREE from 'three';
import { Skeleton, SkinnedMesh, Bone, BufferGeometry } from 'three';
import fs from 'fs';

// Ammo 全局注入
const AmmoMod = await import('ammojs-typed/ammo/ammo.js');
globalThis.Ammo = await AmmoMod.default();

const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();

const BASE = 'D:/Github/GTS-Play';
const PMX_PATH = `${BASE}/mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx`;
const VMD_RAW = `${BASE}/packages/frontend/src/resource_girl/city/vmd_160/pickup.vmd`;
const VMD_BAKED = `${BASE}/mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd`;

const readBuf = (p) => {
  const buf = fs.readFileSync(p);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const pmx = parser.parsePmx(readBuf(PMX_PATH), true);
const vmdRaw = parser.parseVmd(readBuf(VMD_RAW), true);
const vmdBaked = parser.parseVmd(readBuf(VMD_BAKED), true);
console.log(`PMX bones=${pmx.bones.length} rigidBodies=${pmx.rigidBodies.length} constraints=${pmx.constraints.length}`);
console.log(`VMD raw motions=${vmdRaw.motions.length} maxFrame=${Math.max(...vmdRaw.motions.map(m => m.frameNum))}`);
console.log(`VMD baked motions=${vmdBaked.motions.length} maxFrame=${Math.max(...vmdBaked.motions.map(m => m.frameNum))}`);

// ---- 1. 构建 Bone 层级 ----
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

// ---- 2. 构建 iks / grants（提取自 MMDLoader GeometryBuilder）----
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

const geo = new BufferGeometry();
geo.userData.MMD = {
  bones: boneData.map((bd, i) => ({ index: i, transformationClass: bd.transformationClass, parent: bd.parentIndex, name: bd.name, pos: bd.position.slice(0, 3), rotq: [0, 0, 0, 1], scl: [1, 1, 1], rigidBodyType: -1 })),
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
// 直接复用 meta3d MMDLoader 的 animationBuilder
const loaderMod = await import('file:///D:/Github/GTS-Play/packages/meta3d-jiehuo-abstract/src/three/MMDLoader.js');
const loader = new loaderMod.MMDLoader();
const clip = loader.animationBuilder.build(vmdRaw, mesh);
console.log('clip tracks:', clip.tracks.length, 'duration:', clip.duration);

// ---- 5. 自组装动画循环（Node 无法解析 MMDAnimationHelper 的 bare import）----
const { AnimationMixer } = THREE;
const mixer = new AnimationMixer(mesh);
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

const physics = new (await import('file:///D:/Github/GTS-Play/packages/meta3d-jiehuo-abstract/src/three/MMDPhysics.js')).MMDPhysics(
  mesh, rigidBodyParams, pmx.constraints,
  { unitStep: 1 / 65, maxStepNum: 3, gravity: new THREE.Vector3(0, -98, 0) }
);

// warmup 60 帧（游戏同款 helper._setupMeshPhysics）
for (let f = 0; f < 60; f++) {
  mixer.update(1 / 65);
  physics.update(1 / 65);
}

// ---- 6. 逐帧模拟 + 记录物理骨骼 ----
const physicsBoneIndices = new Set();
for (const rb of pmx.rigidBodies) {
  if (rb.type === 1 || rb.type === 2) physicsBoneIndices.add(rb.boneIndex);
}
const physBones = [...physicsBoneIndices].filter(i => i !== -1);
console.log('physics-driven bones:', physBones.length);

// 烘焙版中物理骨名称集合
const bakedByName = new Map();
for (const m of vmdBaked.motions) {
  if (!bakedByName.has(m.boneName)) bakedByName.set(m.boneName, []);
  bakedByName.get(m.boneName).push(m);
}

// 逐帧推进 + 记录（记录每帧物理骨骼局部 rotation/position）
const maxFrame = Math.max(...vmdRaw.motions.map(m => m.frameNum));
const records = new Map(); // boneName -> [{frame, position, rotation}]
for (let frame = 0; frame <= maxFrame; frame++) {
  mixer.update(1 / 30);
  mesh.updateMatrixWorld(true);
  ikSolver.update();
  grantSolver.update();
  physics.update(1 / 30);
  // 记录物理骨
  for (const bi of physBones) {
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

// ---- 7. 粗对比：与烘焙版 vmd 的前 3 个物理骨对照 ----
let compared = 0;
for (const [name, recs] of records) {
  const bakedFrames = bakedByName.get(name);
  if (!bakedFrames) continue;
  // 取中间帧对比 rotation
  const mid = recs[Math.floor(recs.length / 2)];
  const bf = bakedFrames.find(f => f.frameNum === mid.frame);
  if (!bf) continue;
  const q = mid.rotation;
  const bq = bf.rotation;
  const dot = Math.abs(q[0]*bq[0] + q[1]*bq[1] + q[2]*bq[2] + q[3]*bq[3]);
  const angle = 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
  console.log(`${name}: ourQuat=[${q.map(v=>v.toFixed(3)).join(',')}] bakedQuat=[${bq.map(v=>v.toFixed(3)).join(',')}] angleDiff=${angle.toFixed(1)}deg`);
  if (++compared >= 5) break;
}
console.log('SPIKE2 OK');
physics.dispose();
