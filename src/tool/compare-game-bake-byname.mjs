// 按名字匹配对比：游戏 vs 离线刚体/约束（值与顺序无关）
import fs from 'fs';
const GAME = JSON.parse(fs.readFileSync('output/captures/mmdbake-diag.json', 'utf8'));
const BAKE = JSON.parse(fs.readFileSync('output/bake-params-dump.json', 'utf8'));

const eq = (a, c, tol = 1e-4) => {
  if (a === undefined || c === undefined) return a === c;
  if (Array.isArray(a) && Array.isArray(c)) return a.length === c.length && a.every((v, k) => Math.abs(v - c[k]) < tol);
  return Math.abs(a - c) < 1e-6;
};
const fmt = (v) => Array.isArray(v) ? v.map(x => +x.toFixed(4)) : v;

// 1. 刚体按名字对比（游戏全量中取第一个匹配——3 次构造同模型）
console.log('=== 刚体按名字对比 ===');
const bakeByName = new Map();
for (const b of BAKE.rigidBodies) bakeByName.set(b.name, b);
const seen = new Set();
const diff = { weight: 0, groupTarget: 0, friction: 0, restitution: 0, posDamp: 0, rotDamp: 0, position: 0, rotation: 0, shapeType: 0, size: 0, type: 0, boneIndex: 0 };
const ex = { weight: [], groupTarget: [], position: [], friction: [], rotDamp: [], rotation: [] };
let matched = 0;
for (const g of GAME.rigidBodies) {
  if (!g.name || seen.has(g.name)) continue;
  const b = bakeByName.get(g.name);
  if (!b) continue;
  seen.add(g.name); matched++;
  if (!eq(g.weight, b.weight)) { diff.weight++; if (ex.weight.length < 3) ex.weight.push({ name: g.name, game: fmt(g.weight), bake: fmt(b.weight) }); }
  if (!eq(g.groupTarget, b.groupTarget)) { diff.groupTarget++; if (ex.groupTarget.length < 3) ex.groupTarget.push({ name: g.name, game: g.groupTarget, bake: b.groupTarget }); }
  if (!eq(g.friction, b.friction)) { diff.friction++; if (ex.friction.length < 3) ex.friction.push({ name: g.name, game: g.friction, bake: b.friction }); }
  if (!eq(g.restitution, b.restitution)) diff.restitution++;
  if (!eq(g.positionDamping, b.positionDamping)) diff.posDamp++;
  if (!eq(g.rotationDamping, b.rotationDamping)) { diff.rotDamp++; if (ex.rotDamp.length < 3) ex.rotDamp.push({ name: g.name, game: g.rotationDamping, bake: b.rotationDamping }); }
  if (!eq(g.position, b.position)) { diff.position++; if (ex.position.length < 3) ex.position.push({ name: g.name, game: fmt(g.position), bake: fmt(b.position) }); }
  if (!eq(g.rotation, b.rotation)) { diff.rotation++; if (ex.rotation.length < 3) ex.rotation.push({ name: g.name, game: fmt(g.rotation), bake: fmt(b.rotation) }); }
  if (!eq(g.shapeType, b.shapeType)) diff.shapeType++;
  if (!eq(g.size, b.size)) diff.size++;
  if (!eq(g.type, b.type)) diff.type++;
  if (!eq(g.boneIndex, b.boneIndex)) diff.boneIndex++;
}
console.log('匹配刚体数:', matched, '(离线共', BAKE.rigidBodies.length, ')');
console.log('字段差异:', JSON.stringify(diff));
console.log('weight 示例:', JSON.stringify(ex.weight));
console.log('groupTarget 示例:', JSON.stringify(ex.groupTarget));
console.log('position 示例:', JSON.stringify(ex.position));
console.log('rotation 示例:', JSON.stringify(ex.rotation));
console.log('friction 示例:', JSON.stringify(ex.friction));
console.log('rotDamp 示例:', JSON.stringify(ex.rotDamp));

// 2. 约束按名字对比
console.log('\n=== 约束按名字对比 ===');
const bakeCByName = new Map();
for (const c of BAKE.constraints) bakeCByName.set(c.name, c);
const seenC = new Set();
const diffC = { springPos: 0, springRot: 0, tLimit1: 0, tLimit2: 0, rLimit1: 0, rLimit2: 0, position: 0, rotation: 0 };
const exC = { springPos: [], springRot: [], rLimit1: [], position: [] };
let matchedC = 0;
for (const g of GAME.constraints) {
  if (!g.name || seenC.has(g.name)) continue;
  const b = bakeCByName.get(g.name);
  if (!b) continue;
  seenC.add(g.name); matchedC++;
  if (!eq(g.springPosition, b.springPosition)) { diffC.springPos++; if (exC.springPos.length < 2) exC.springPos.push({ name: g.name, game: fmt(g.springPosition), bake: fmt(b.springPosition) }); }
  if (!eq(g.springRotation, b.springRotation)) { diffC.springRot++; if (exC.springRot.length < 2) exC.springRot.push({ name: g.name, game: fmt(g.springRotation), bake: fmt(b.springRotation) }); }
  if (!eq(g.translationLimitation1, b.translationLimitation1)) diffC.tLimit1++;
  if (!eq(g.translationLimitation2, b.translationLimitation2)) diffC.tLimit2++;
  if (!eq(g.rotationLimitation1, b.rotationLimitation1)) { diffC.rLimit1++; if (exC.rLimit1.length < 2) exC.rLimit1.push({ name: g.name, game: fmt(g.rotationLimitation1), bake: fmt(b.rotationLimitation1) }); }
  if (!eq(g.rotationLimitation2, b.rotationLimitation2)) diffC.rLimit2++;
  if (!eq(g.position, b.position)) { diffC.position++; if (exC.position.length < 2) exC.position.push({ name: g.name, game: fmt(g.position), bake: fmt(b.position) }); }
  if (!eq(g.rotation, b.rotation)) diffC.rotation++;
}
console.log('匹配约束数:', matchedC, '(离线共', BAKE.constraints.length, ')');
console.log('字段差异:', JSON.stringify(diffC));
console.log('springPos 示例:', JSON.stringify(exC.springPos));
console.log('springRot 示例:', JSON.stringify(exC.springRot));
console.log('rLimit1 示例:', JSON.stringify(exC.rLimit1));
console.log('position 示例:', JSON.stringify(exC.position));
