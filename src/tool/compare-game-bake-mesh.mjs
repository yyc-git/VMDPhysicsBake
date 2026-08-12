#!/usr/bin/env node
// compare-game-bake-mesh.mjs
// 对比游戏侧 diag（mesh 过滤 PlayerGoddess）与离线 bake-params-dump 的装配参数 + warmup 状态
// 用法: node compare-game-bake-mesh.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const DIAG = path.join(ROOT, 'output', 'captures', 'mmdbake-diag.json');
const DUMP = path.join(ROOT, 'output', 'bake-params-dump.json');
const MESH = '$girl$_PlayerGoddess';
const EXPECT_RB = 491;
const EXPECT_C = 847;

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function arrDiff(a, b, eps = 1e-9) {
  if (!Array.isArray(a) || !Array.isArray(b)) return { diff: true, reason: 'not-array' };
  if (a.length !== b.length) return { diff: true, reason: 'len' };
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > eps) return { diff: true, at: i, ga: a[i], oa: b[i] };
  return { diff: false };
}
function quatAngleDeg(a, b) {
  if (!a || !b) return null;
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  d = Math.min(1, Math.max(-1, Math.abs(d)));
  return (2 * Math.acos(d) * 180) / Math.PI;
}
function fieldDiff(gv, ov) {
  if (Array.isArray(gv) || Array.isArray(ov)) return arrDiff(gv, ov).diff;
  return !eq(gv, ov);
}

// ---- load ----
for (const f of [DIAG, DUMP]) {
  if (!fs.existsSync(f)) { console.error('数据文件缺失: ' + f); process.exit(1); }
}
let game, dump;
try {
  game = JSON.parse(fs.readFileSync(DIAG, 'utf8'));
  dump = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
} catch (e) { console.error('JSON 解析失败: ' + e.message); process.exit(1); }
if (!Array.isArray(game.rigidBodies) || !Array.isArray(game.constraints) || !game.params || !game.warmupEndBones) {
  console.error('游戏 diag JSON 结构异常'); process.exit(1);
}
if (!Array.isArray(dump.rigidBodies) || !Array.isArray(dump.constraints) || !dump.warmupEndBones) {
  console.error('离线 dump JSON 结构异常'); process.exit(1);
}

const out = { meta: {}, rigidBody: {}, constraint: {}, warmup: {} };
const P = MESH;

// ---- 1. filter ----
const rbs = game.rigidBodies.filter((r) => r.mesh === P);
const cs = game.constraints.filter((c) => c.mesh === P);
const params = game.params.filter((p) => p.meshName === P);
out.meta = {
  diag: path.basename(DIAG), dump: path.basename(DUMP), mesh: P,
  filteredRB: rbs.length, filteredC: cs.length, expectedRB: EXPECT_RB * 3, expectedC: EXPECT_C * 3,
};
console.log(`[filter] rb=${rbs.length} c=${cs.length} params=${params.length}`);

// ---- 2. verify 3 constructions identical ----
let rbChunkOK = true, cChunkOK = true, paramsOK = true;
for (let i = 0; i < EXPECT_RB; i++) {
  if (!(eq(rbs[i], rbs[i + EXPECT_RB]) && eq(rbs[i], rbs[i + EXPECT_RB * 2]))) { rbChunkOK = false; break; }
}
for (let i = 0; i < EXPECT_C; i++) {
  if (!(eq(cs[i], cs[i + EXPECT_C]) && eq(cs[i], cs[i + EXPECT_C * 2]))) { cChunkOK = false; break; }
}
paramsOK = eq(params[0], params[1]) && eq(params[1], params[2]);
out.meta.rb3ChunksIdentical = rbChunkOK;
out.meta.c3ChunksIdentical = cChunkOK;
out.meta.params3EntriesIdentical = paramsOK;
console.log(`[verify] rb chunks identical=${rbChunkOK} c chunks identical=${cChunkOK} params identical=${paramsOK}`);

const gRB = rbs.slice(0, EXPECT_RB), gC = cs.slice(0, EXPECT_C), gP = params[0];
const oRB = dump.rigidBodies, oC = dump.constraints;

// ---- 3. name alignment ----
const rbNameMismatch = [], cNameMismatch = [];
for (let i = 0; i < EXPECT_RB; i++) if (gRB[i].name !== oRB[i].name) rbNameMismatch.push({ i, g: gRB[i].name, o: oRB[i].name });
for (let i = 0; i < EXPECT_C; i++) if (gC[i].name !== oC[i].name) cNameMismatch.push({ i, g: gC[i].name, o: oC[i].name });
out.meta.rbNameMismatch = rbNameMismatch.length;
out.meta.cNameMismatch = cNameMismatch.length;
console.log(`[align] rb name mismatch=${rbNameMismatch.length} c name mismatch=${cNameMismatch.length}`);

// ---- 4. rigidBody field diff ----
const RB_FIELDS = ['name', 'type', 'boneIndex', 'weight', 'position', 'rotation', 'shapeType', 'size', 'groupIndex', 'groupTarget', 'friction', 'restitution', 'positionDamping', 'rotationDamping'];
const rbFieldDiff = {};        // field -> {count, samples[]}
const rbRows = [];
for (let i = 0; i < EXPECT_RB; i++) {
  for (const f of RB_FIELDS) {
    const gv = gRB[i][f], ov = oRB[i][f];
    if (gv === undefined && ov === undefined) continue; // 字段缺失（如 size）
    if (fieldDiff(gv, ov)) {
      rbFieldDiff[f] = rbFieldDiff[f] || { count: 0, samples: [] };
      rbFieldDiff[f].count++;
      if (rbFieldDiff[f].samples.length < 8) rbFieldDiff[f].samples.push({ i, name: gRB[i].name, g: gv, o: ov });
    }
  }
}
out.rigidBody.fieldDiff = rbFieldDiff;
console.log('\n===== rigidBody 字段差异 =====');
for (const [f, v] of Object.entries(rbFieldDiff)) {
  console.log(`  ${f}: ${v.count}`);
  for (const s of v.samples) console.log(`    #${s.i} ${s.name} g=${JSON.stringify(s.g)} o=${JSON.stringify(s.o)}`);
}

// ---- 5. constraint field diff ----
const C_FIELDS = ['name', 'rigidBodyIndex1', 'rigidBodyIndex2', 'position', 'rotation', 'springPosition', 'springRotation', 'translationLimitation1', 'translationLimitation2', 'rotationLimitation1', 'rotationLimitation2'];
const cFieldDiff = {};
for (let i = 0; i < EXPECT_C; i++) {
  for (const f of C_FIELDS) {
    if (fieldDiff(gC[i][f], oC[i][f])) {
      cFieldDiff[f] = cFieldDiff[f] || { count: 0, samples: [] };
      cFieldDiff[f].count++;
      if (cFieldDiff[f].samples.length < 8) cFieldDiff[f].samples.push({ i, name: gC[i].name, g: gC[i][f], o: oC[i][f] });
    }
  }
}
out.constraint.fieldDiff = cFieldDiff;
console.log('\n===== constraint 字段差异 =====');
for (const [f, v] of Object.entries(cFieldDiff)) {
  console.log(`  ${f}: ${v.count}`);
  for (const s of v.samples) console.log(`    #${s.i} ${s.name} g=${JSON.stringify(s.g)} o=${JSON.stringify(s.o)}`);
}
console.log('  (无输出 = 0 差异)');

// ---- 6. groupTarget 深入：zone 判定 ----
const zoneOf = (n) => n.includes('スカート') ? 'skirt' : (n.includes('胸') ? 'chest' : null);
const gtDiffs = [];
for (let i = 0; i < EXPECT_RB; i++) {
  if (gRB[i].groupTarget !== oRB[i].groupTarget) gtDiffs.push({ i, name: gRB[i].name, zone: zoneOf(gRB[i].name), g: gRB[i].groupTarget, o: oRB[i].groupTarget, xor: gRB[i].groupTarget ^ oRB[i].groupTarget });
}
const gtByZone = { skirt: 0, chest: 0, other: 0 };
for (const d of gtDiffs) gtByZone[d.zone || 'other']++;
const allXor2 = gtDiffs.every((d) => d.xor === 2);
out.rigidBody.groupTarget = { diffCount: gtDiffs.length, byZone: gtByZone, allXorIsBit1: allXor2, samples: gtDiffs.slice(0, 5) };
console.log(`\n===== groupTarget 差异: ${gtDiffs.length}/${EXPECT_RB} =====`);
console.log('  byZone:', JSON.stringify(gtByZone), 'all xor==2(bit1):', allXor2);

// ---- 7. type 差异（呆毛1 复查）----
const typeDiffs = [];
for (let i = 0; i < EXPECT_RB; i++) if (gRB[i].type !== oRB[i].type) typeDiffs.push({ i, name: gRB[i].name, game: gRB[i].type, offline: oRB[i].type });
out.rigidBody.type = typeDiffs;
console.log(`\n===== type 差异: ${typeDiffs.length} =====`, JSON.stringify(typeDiffs));

// ---- 8. warmup 对比 ----
const wEntries = Object.entries(game.warmupEndBones).filter(([, e]) => e.meshName === P);
const warmupRows = [];
for (const bn of Object.keys(dump.warmupEndBones)) {
  const oq = dump.warmupEndBones[bn];
  const perEntry = wEntries.map(([k, e]) => ({ entry: k, deg: quatAngleDeg(e.bones[bn], oq) }));
  warmupRows.push({ bone: bn, perEntry });
}
warmupRows.sort((a, b) => (b.perEntry[0].deg || 0) - (a.perEntry[0].deg || 0));
const stats = { boneCount: warmupRows.length, entries: wEntries.map(([k]) => k) };
for (const e of wEntries) {
  const key = `entry${e[0]}`;
  stats[key] = {
    over1: warmupRows.filter((r) => r.perEntry.find((x) => x.entry === e[0]).deg > 1).length,
    over10: warmupRows.filter((r) => r.perEntry.find((x) => x.entry === e[0]).deg > 10).length,
    over30: warmupRows.filter((r) => r.perEntry.find((x) => x.entry === e[0]).deg > 30).length,
    max: Math.max(...warmupRows.map((r) => r.perEntry.find((x) => x.entry === e[0]).deg)),
  };
}
// game 内部 3 个 entry 之间的一致性（取最大两两差异）
let internalMax = 0;
for (const r of warmupRows) {
  const degs = r.perEntry.map((x) => x.deg).filter((d) => d !== null);
  for (let i = 0; i < degs.length; i++) for (let j = i + 1; j < degs.length; j++) internalMax = Math.max(internalMax, Math.abs(degs[i] - degs[j]));
}
stats.internalMaxGameEntryDiff = internalMax;
out.warmup = { stats, top: warmupRows.slice(0, 15).map((r) => ({ bone: r.bone, deg: r.perEntry[0].deg })) };
console.log('\n===== warmupEndBones 对比 =====');
console.log('  骨数:', stats.boneCount, 'entries:', stats.entries.join(','));
for (const e of wEntries) console.log(`  entry${e[0]}: >1deg=${stats['entry' + e[0]].over1} >10deg=${stats['entry' + e[0]].over10} >30deg=${stats['entry' + e[0]].over30} max=${stats['entry' + e[0]].max.toFixed(1)}deg`);
console.log(`  game 3 个 entry 之间最大差异: ${internalMax.toFixed(1)}deg`);
console.log('  top 差异:');
for (const t of out.warmup.top) console.log(`    ${t.bone}: ${t.deg.toFixed(1)}deg`);

// ---- 9. params 对比 ----
out.gameParams = { unitStep: gP.unitStep, maxStepNum: gP.maxStepNum, gravity: gP.gravity, physicsUpdateInterval: gP.physicsUpdateInterval, solverIterations: gP.solverIterations, meshScale: gP.meshScale, warmup: gP.warmup };
out.offlineParams = { unitStep: dump.params?.unitStep, maxStepNum: dump.params?.maxStepNum, gravity: dump.params?.gravity, physicsUpdateInterval: dump.params?.physicsUpdateInterval, solverIterations: dump.params?.solverIterations, meshScale: dump.params?.meshScale, warmup: dump.params?.warmup };
console.log('\n===== params =====');
console.log('  game:', JSON.stringify(out.gameParams));
console.log('  offline:', JSON.stringify(out.offlineParams));

// ---- save ----
const outPath = path.join(ROOT, 'output', 'compare-result.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('\n[out] ' + outPath);
