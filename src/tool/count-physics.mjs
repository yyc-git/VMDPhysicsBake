// 统计 PMX 物理部件数量：rigidBody / joint（约束）
// 用法: node count-physics.mjs <pmx路径>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mmdParserMod = require('three/examples/jsm/libs/mmdparser.module.js');
import fs from 'fs';

const Parser = mmdParserMod.MMDParser.Parser;
const parser = new Parser();

function loadPmx(path) {
  const buf = fs.readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return parser.parsePmx(ab, true);
}

const path = process.argv[2];
const model = loadPmx(path);
console.log(`== ${path.split(/[\\/]/).pop()} ==`);
console.log(`vertices=${model.vertices.length} bones=${model.bones.length} morphs=${model.morphs.length} materials=${model.materials.length}`);
const joints = model.constraints || model.joints || [];
console.log(`rigidBodies=${model.rigidBodies.length} joints=${joints.length}`);

// 按 rigidBody 类型统计: 0=follow bone(动态), 1=physics(动态), 2=physics(静态)
const byType = { 0: 0, 1: 0, 2: 0 };
model.rigidBodies.forEach(r => { byType[r.type] = (byType[r.type] || 0) + 1; });
console.log(`rigidBody type: 0(follow)=${byType[0]} 1(physics dyn)=${byType[1]} 2(physics stat)=${byType[2]}`);

// 按关节类型统计: 0=spring6DOF, 1=6DOF, 2=p2p(point), 3=coneTwist, 4=slider
const byJointType = {};
joints.forEach(j => { byJointType[j.type] = (byJointType[j.type] || 0) + 1; });
console.log(`joint type: ${JSON.stringify(byJointType)}`);

// 统计连接动态 rigidbody 的 joint 数（真正需要 solver 的）
const dynSet = new Set();
model.rigidBodies.forEach((r, i) => { if (r.type === 0 || r.type === 1) dynSet.add(i); });
let dynJoints = 0;
joints.forEach(j => {
  if (dynSet.has(j.rigidBodyIndex1) || dynSet.has(j.rigidBodyIndex2)) dynJoints++;
});
console.log(`joints touching dynamic bodies: ${dynJoints}/${joints.length}`);
