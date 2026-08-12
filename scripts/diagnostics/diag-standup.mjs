// 诊断8：定位起身帧 + 对比我们 vs MMM 起身阶段物理骨摆动
import fs from 'fs';
const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();
function load(p) { const b = fs.readFileSync(p); return parser.parseVmd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), true); }
const raw = load('packages/frontend/src/resource_girl/city/vmd_160/pickup.vmd');
const ours = load('笔记/项目文档/changes/2026-08-05-mmd-vmd-unify/analysis/vmd-physics-bake/output/pickup_bake.vmd');
const mmm = load('mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd');
const byName = (v) => { const m = new Map(); for (const x of v.motions) { if (!m.has(x.boneName)) m.set(x.boneName, []); m.get(x.boneName).push(x); } return m; };
const R = byName(raw), O = byName(ours), M = byName(mmm);

// 1. 找起身帧：上半身 rotation 角度变化速率最大的区间
const angOf = (q) => 2 * Math.acos(Math.min(1, Math.max(-1, q[3]))) * 180 / Math.PI;
const upper = R.get('上半身') || [];
const sorted = [...upper].sort((a,b) => a.frameNum - b.frameNum);
console.log('=== 原始 VMD 上半身 rotation 角逐帧 (找起身段) ===');
let prevAng = null;
for (const m of sorted) {
  const a = angOf(m.rotation);
  const d = prevAng === null ? 0 : a - prevAng;
  if (Math.abs(d) > 5) console.log(`f${m.frameNum}: ${a.toFixed(1)}° (Δ${d >= 0 ? '+' : ''}${d.toFixed(1)}°) ${Math.abs(d) > 10 ? ' <<< 大幅变化' : ''}`);
  prevAng = a;
}

// 2. 起身段物理骨对比：前髪１ 全帧曲线 ours vs mmm
console.log('\n=== 前髪１ 全帧摆动角对比 ours vs mmm ===');
const a1 = (O.get('前髪１') || []).sort((x,y)=>x.frameNum-y.frameNum);
const b1 = (M.get('前髪１') || []).sort((x,y)=>x.frameNum-y.frameNum);
const line = [];
for (let f = 0; f <= 90; f += 3) {
  const ma = a1.find(x=>x.frameNum===f), mb = b1.find(x=>x.frameNum===f);
  line.push(`f${f}:${ma?angOf(ma.rotation).toFixed(0):'--'}/${mb?angOf(mb.rotation).toFixed(0):'--'}`);
}
console.log(line.join(' '));

// 3. スカート_0_1 全帧
console.log('\n=== スカート_0_1 全帧摆动角对比 ===');
const a2 = (O.get('スカート_0_1') || []).sort((x,y)=>x.frameNum-y.frameNum);
const b2 = (M.get('スカート_0_1') || []).sort((x,y)=>x.frameNum-y.frameNum);
const line2 = [];
for (let f = 0; f <= 90; f += 3) {
  const ma = a2.find(x=>x.frameNum===f), mb = b2.find(x=>x.frameNum===f);
  line2.push(`f${f}:${ma?angOf(ma.rotation).toFixed(0):'--'}/${mb?angOf(mb.rotation).toFixed(0):'--'}`);
}
console.log(line2.join(' '));
