// Spike: Node 环境验证 MMDPhysics 物理烘焙可行性
// 1) MMDParser 解析 PMX → 构建 three Bone 层级
// 2) MMDPhysics 创建（491 刚体 + 847 约束）
// 3) 模拟数帧，观察物理骨骼变换是否更新
import * as THREE from 'three';
import { Skeleton, SkinnedMesh, Bone, BufferGeometry } from 'three';
import fs from 'fs';

// Ammo 全局注入（MMDPhysics 检查 typeof Ammo === 'undefined'）
const AmmoMod = await import('ammojs-typed/ammo/ammo.js');
globalThis.Ammo = await AmmoMod.default();

const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();

const PMX_PATH = 'D:/Github/GTS-Play/mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx';
const buf = fs.readFileSync(PMX_PATH);
const pmx = parser.parsePmx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), true);

console.log(`PMX: bones=${pmx.bones.length} rigidBodies=${pmx.rigidBodies.length} constraints=${pmx.constraints.length}`);

// ---- 构建 three Bone 层级 ----
const bones = [];
const boneData = pmx.bones;
for (let i = 0; i < boneData.length; i++) {
  const b = new Bone();
  b.name = boneData[i].name;
  b.position.set(boneData[i].position[0], boneData[i].position[1], boneData[i].position[2]);
  bones.push(b);
}
// 父子挂接
for (let i = 0; i < boneData.length; i++) {
  const p = boneData[i].parentIndex;
  if (p !== -1 && p < bones.length) {
    bones[p].add(bones[i]);
  }
}
console.log('Bone hierarchy built:', bones.length);

// ---- 构建 mesh ----
const geo = new BufferGeometry();
geo.userData.MMD = {
  bones: boneData.map((bd, i) => ({ index: i, transformationClass: bd.transformationClass, parent: bd.parentIndex, name: bd.name, pos: bd.position.slice(0,3), rotq: [0,0,0,1], scl: [1,1,1], rigidBodyType: -1 })),
  iks: [],
  grants: [],
  rigidBodies: pmx.rigidBodies,
  constraints: pmx.constraints,
  format: 'pmx'
};
const mesh = new SkinnedMesh(geo);
const skeleton = new Skeleton(bones);
mesh.add(bones[0]);
mesh.bind(skeleton);
console.log('SkinnedMesh bound, skeleton bones:', mesh.skeleton.bones.length);

// ---- rigidBodyParams 转换（PMX 刚体 position 是全局 → 转骨骼局部偏移）----
const rigidBodyParams = pmx.rigidBodies.map((rb, i) => {
  const p = { ...rb };
  if (p.boneIndex !== -1 && p.boneIndex < boneData.length) {
    p.position = [
      rb.position[0] - boneData[rb.boneIndex].position[0],
      rb.position[1] - boneData[rb.boneIndex].position[1],
      rb.position[2] - boneData[rb.boneIndex].position[2]
    ];
  }
  return p;
});

// ---- MMDPhysics ----
const { MMDPhysics } = await import('file:///D:/Github/GTS-Play/packages/meta3d-jiehuo-abstract/src/three/MMDPhysics.js');
console.log('creating MMDPhysics...');
const physics = new MMDPhysics(mesh, rigidBodyParams, pmx.constraints, {
  unitStep: 1 / 65,
  maxStepNum: 3,
  gravity: new THREE.Vector3(0, -98, 0)
});
console.log('MMDPhysics created. bodies=', physics.bodies.length, 'constraints=', physics.constraints.length);

// ---- 模拟 10 帧，检查物理骨骼（type 1/2）变换 ----
mesh.updateMatrixWorld(true);
const physicsBoneIndices = new Set();
for (const rb of pmx.rigidBodies) {
  if (rb.type === 1 || rb.type === 2) physicsBoneIndices.add(rb.boneIndex);
}
const physicsBones = [...physicsBoneIndices].filter(i => i !== -1);
console.log('physics-driven bones:', physicsBones.length);

const sample = physicsBones.slice(0, 5);
const before = sample.map(i => bones[i].quaternion.toArray().map(v => v.toFixed(4)).join(','));
for (let f = 0; f < 30; f++) {
  physics.update(1 / 65);
}
const after = sample.map(i => bones[i].quaternion.toArray().map(v => v.toFixed(4)).join(','));
console.log('sample physics bones BEFORE:', before);
console.log('sample physics bones AFTER :', after);
const moved = physicsBones.filter(i => {
  const q = bones[i].quaternion;
  return Math.abs(q.x) > 1e-3 || Math.abs(q.y) > 1e-3 || Math.abs(q.z) > 1e-3;
}).length;
console.log(`bones with non-trivial rotation after 30 steps: ${moved}/${physicsBones.length}`);

physics.dispose();
console.log('SPIKE OK');
