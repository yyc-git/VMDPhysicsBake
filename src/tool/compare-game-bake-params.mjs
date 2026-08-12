// 用 constraints.rigidBodyIndex 归零点分割角色段 → 定位 PlayerGoddess → 与离线精确对比
import fs from 'fs';
const GAME = JSON.parse(fs.readFileSync('output/captures/mmdbake-diag.json', 'utf8'));
const BAKE = JSON.parse(fs.readFileSync('output/bake-params-dump.json', 'utf8'));

// 1. 分割 constraints：rigidBodyIndex1 突降 = 新角色
const cs = GAME.constraints;
const boundaries = [0];
for (let i = 1; i < cs.length; i++) {
  const prev = cs[i - 1].rigidBodyIndex1 ?? 0;
  const cur = cs[i].rigidBodyIndex1 ?? 0;
  if (cur < prev - 100) boundaries.push(i);
}
boundaries.push(cs.length);
console.log('约束段边界:', JSON.stringify(boundaries.map((b, i) => i < boundaries.length - 1 ? [b, boundaries[i + 1]] : [b])).slice(0, 300));
// 每段约束数 + 推断刚体数（max rigidBodyIndex + 1）
const segs = [];
for (let i = 0; i < boundaries.length - 1; i++) {
  const seg = cs.slice(boundaries[i], boundaries[i + 1]);
  const maxIdx = Math.max(...seg.map(c => Math.max(c.rigidBodyIndex1 ?? 0, c.rigidBodyIndex2 ?? 0)));
  segs.push({ cStart: boundaries[i], cEnd: boundaries[i + 1], cCount: seg.length, rbCount: maxIdx + 1 });
}
console.log('角色段（按构造顺序）:', JSON.stringify(segs));
// params 的 meshName 对应顺序
console.log('params mesh 顺序:', GAME.params.map(p => p.meshName).join(' | '));

// 2. 取 Player 段（params[2] 对应的第 3 段，rbCount=491 匹配离线）
const pSeg = segs[2]; // params #2 = 第一个 PlayerGoddess
console.log('\nPlayer 段: c', pSeg.cStart, '..', pSeg.cEnd, `(约束 ${pSeg.cCount})`, '刚体数:', pSeg.rbCount, '| 离线: rb', BAKE.rigidBodies.length, 'c', BAKE.constraints.length);

// rigidBodies 段：累计前面角色的 rbCount
let rbStart = 0;
for (let i = 0; i < 2; i++) rbStart += segs[i].rbCount;
const gameRb = GAME.rigidBodies.slice(rbStart, rbStart + pSeg.rbCount);
console.log('游戏 Player rb 段:', rbStart, '..', rbStart + pSeg.rbCount - 1, '=', gameRb.length);

// 3. 刚体逐字段对比（按索引对齐——同一模型同一顺序）
const eq = (a, c) => {
  if (a === undefined || c === undefined) return a === c;
  if (Array.isArray(a) && Array.isArray(c)) return a.length === c.length && a.every((v, k) => Math.abs(v - c[k]) < 1e-4);
  return Math.abs(a - c) < 1e-6;
};
console.log('\n=== 刚体对比（', gameRb.length, 'vs', BAKE.rigidBodies.length, '）===');
let nameMismatch = 0;
const diff = { weight: 0, groupTarget: 0, groupIndex: 0, friction: 0, restitution: 0, posDamp: 0, rotDamp: 0, position: 0, rotation: 0, shapeType: 0, size: 0, type: 0, boneIndex: 0 };
const ex = { weight: [], groupTarget: [], position: [], size: [], friction: [], rotDamp: [] };
const n = Math.min(gameRb.length, BAKE.rigidBodies.length);
for (let i = 0; i < n; i++) {
  const g = gameRb[i], b = BAKE.rigidBodies[i];
  if (g.name !== b.name) { nameMismatch++; if (nameMismatch <= 5) console.log('  ⚠️ 名称不一致 @', i, ':', g.name, 'vs', b.name); }
  if (!eq(g.weight, b.weight)) { diff.weight++; if (ex.weight.length < 3) ex.weight.push({ i, name: g.name, game: g.weight, bake: b.weight }); }
  if (!eq(g.groupTarget, b.groupTarget)) { diff.groupTarget++; if (ex.groupTarget.length < 3) ex.groupTarget.push({ i, name: g.name, game: g.groupTarget, bake: b.groupTarget }); }
  if (!eq(g.groupIndex, b.groupIndex)) diff.groupIndex++;
  if (!eq(g.friction, b.friction)) { diff.friction++; if (ex.friction.length < 3) ex.friction.push({ i, name: g.name, game: g.friction, bake: b.friction }); }
  if (!eq(g.restitution, b.restitution)) diff.restitution++;
  if (!eq(g.positionDamping, b.positionDamping)) diff.posDamp++;
  if (!eq(g.rotationDamping, b.rotationDamping)) { diff.rotDamp++; if (ex.rotDamp.length < 3) ex.rotDamp.push({ i, name: g.name, game: g.rotationDamping, bake: b.rotationDamping }); }
  if (!eq(g.position, b.position)) { diff.position++; if (ex.position.length < 3) ex.position.push({ i, name: g.name, game: g.position, bake: b.position }); }
  if (!eq(g.rotation, b.rotation)) diff.rotation++;
  if (!eq(g.shapeType, b.shapeType)) diff.shapeType++;
  if (!eq(g.size, b.size)) { diff.size++; if (ex.size.length < 3) ex.size.push({ i, name: g.name, game: g.size, bake: b.size }); }
  if (!eq(g.type, b.type)) diff.type++;
  if (!eq(g.boneIndex, b.boneIndex)) diff.boneIndex++;
}
console.log('名称不一致:', nameMismatch, '/', n);
console.log('字段差异:', JSON.stringify(diff));
console.log('\n差异示例:');
console.log('weight:', JSON.stringify(ex.weight));
console.log('groupTarget:', JSON.stringify(ex.groupTarget));
console.log('position:', JSON.stringify(ex.position));
console.log('size:', JSON.stringify(ex.size));
console.log('friction:', JSON.stringify(ex.friction));
console.log('rotDamp:', JSON.stringify(ex.rotDamp));

// 4. 约束对比（Player 段 vs 离线，按索引）
console.log('\n=== 约束对比（', pSeg.cCount, 'vs', BAKE.constraints.length, '）===');
const gc = GAME.constraints.slice(pSeg.cStart, pSeg.cEnd);
const diffC = { springPos: 0, springRot: 0, tLimit1: 0, tLimit2: 0, rLimit1: 0, rLimit2: 0, position: 0, rotation: 0, name: 0 };
const exC = { springPos: [], springRot: [], rLimit1: [], position: [] };
const cn = Math.min(gc.length, BAKE.constraints.length);
for (let i = 0; i < cn; i++) {
  const g = gc[i], b = BAKE.constraints[i];
  if (g.name !== b.name) diffC.name++;
  if (!eq(g.springPosition, b.springPosition)) { diffC.springPos++; if (exC.springPos.length < 2) exC.springPos.push({ i, name: g.name, game: g.springPosition, bake: b.springPosition }); }
  if (!eq(g.springRotation, b.springRotation)) { diffC.springRot++; if (exC.springRot.length < 2) exC.springRot.push({ i, name: g.name, game: g.springRotation, bake: b.springRotation }); }
  if (!eq(g.translationLimitation1, b.translationLimitation1)) diffC.tLimit1++;
  if (!eq(g.translationLimitation2, b.translationLimitation2)) diffC.tLimit2++;
  if (!eq(g.rotationLimitation1, b.rotationLimitation1)) { diffC.rLimit1++; if (exC.rLimit1.length < 2) exC.rLimit1.push({ i, name: g.name, game: g.rotationLimitation1, bake: b.rotationLimitation1 }); }
  if (!eq(g.rotationLimitation2, b.rotationLimitation2)) diffC.rLimit2++;
  if (!eq(g.position, b.position)) { diffC.position++; if (exC.position.length < 2) exC.position.push({ i, name: g.name, game: g.position, bake: b.position }); }
  if (!eq(g.rotation, b.rotation)) diffC.rotation++;
}
console.log('名称不一致:', diffC.name, '/', cn);
console.log('字段差异:', JSON.stringify(diffC));
console.log('springPos 示例:', JSON.stringify(exC.springPos));
console.log('springRot 示例:', JSON.stringify(exC.springRot));
console.log('rLimit1 示例:', JSON.stringify(exC.rLimit1));
console.log('position 示例:', JSON.stringify(exC.position));
