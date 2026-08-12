// 临时诊断：对比我们输出 vs MMM 版裙子骨骼 position/rotation 量级
import fs from 'fs';
const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();
function load(p) { const b = fs.readFileSync(p); return parser.parseVmd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), true); }
const ours = load('笔记/项目文档/changes/2026-08-05-mmd-vmd-unify/analysis/vmd-physics-bake/output/pickup_bake.vmd');
const mmm = load('mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd');
const byName = (v) => { const m = new Map(); for (const x of v.motions) { if (!m.has(x.boneName)) m.set(x.boneName, []); m.get(x.boneName).push(x); } return m; };
const o = byName(ours), mm = byName(mmm);
const skirtNames = [...o.keys()].filter(n => n.includes('スカート')).slice(0, 8);
console.log('=== 我们输出 裙子骨骼 (RIGHT 空间) ===');
for (const n of skirtNames) {
  const list = o.get(n).sort((a,b)=>a.frameNum-b.frameNum);
  const f0 = list[0], f45 = list.find(x=>x.frameNum===45) || list[0], f90 = list[list.length-1];
  console.log(n.padEnd(16), 'f0 p:', f0.position.map(v=>v.toFixed(2)).join(','), ' f45 p:', f45.position.map(v=>v.toFixed(2)).join(','), ' f90 p:', f90.position.map(v=>v.toFixed(2)).join(','));
}
console.log('\n=== MMM 版 同名骨骼 ===');
for (const n of skirtNames) {
  if (!mm.has(n)) { console.log(n, 'MMM 无此骨'); continue; }
  const list = mm.get(n).sort((a,b)=>a.frameNum-b.frameNum);
  const f0 = list[0], f45 = list.find(x=>x.frameNum===45) || list[0], f90 = list[list.length-1];
  console.log(n.padEnd(16), 'f0 p:', f0.position.map(v=>v.toFixed(2)).join(','), ' f45 p:', f45.position.map(v=>v.toFixed(2)).join(','), ' f90 p:', f90.position.map(v=>v.toFixed(2)).join(','));
}
// rotation 对比
console.log('\n=== rotation 对比 (f45) ===');
for (const n of skirtNames.slice(0,4)) {
  const a = (o.get(n)||[]).find(x=>x.frameNum===45);
  const b = (mm.get(n)||[]).find(x=>x.frameNum===45);
  if (!a || !b) continue;
  const r2 = (q) => Math.round(2*Math.acos(Math.min(1,Math.max(-1,q[3])))*180/Math.PI);
  console.log(n.padEnd(16), 'ours deg:', r2(a.rotation), ' mmm deg:', r2(b.rotation));
}
// 量级统计
const mag = (list) => { const arr = list.map(x=>Math.hypot(...x.position)); return {min:Math.min(...arr).toFixed(1), max:Math.max(...arr).toFixed(1), mean:(arr.reduce((s,v)=>s+v,0)/arr.length).toFixed(1)}; };
console.log('\n=== position 模长范围 ===');
for (const n of skirtNames.slice(0,4)) {
  console.log(n.padEnd(16), 'ours:', JSON.stringify(mag(o.get(n))), ' mmm:', JSON.stringify(mag(mm.get(n)||[])));
}
