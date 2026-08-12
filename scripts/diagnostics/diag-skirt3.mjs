// 诊断3：fix2 后 rotation 与 MMM 对比（关键物理骨采样）
import fs from 'fs';
const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();
function load(p) { const b = fs.readFileSync(p); return parser.parseVmd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), true); }
const ours = load('笔记/项目文档/changes/2026-08-05-mmd-vmd-unify/analysis/vmd-physics-bake/output/pickup_bake.vmd');
const mmm = load('mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd');
const byName = (v) => { const m = new Map(); for (const x of v.motions) { if (!m.has(x.boneName)) m.set(x.boneName, []); m.get(x.boneName).push(x); } return m; };
const o = byName(ours), mm = byName(mmm);
const angOf = (q) => 2 * Math.acos(Math.min(1, Math.max(-1, q[3]))) * 180 / Math.PI;
// 多帧采样对比（0/15/30/45/60/75/90）
const sampleBones = ['スカート_0_1', 'スカート_0_10', 'スカート_1_1', '前髪１', '胸上', '左胸上', '右胸上', '髪１'];
const frames = [0, 15, 30, 45, 60, 75, 90];
console.log('=== 关键物理骨 rotation 角(°) 帧采样对比 ours vs mmm ===');
for (const n of sampleBones) {
  const a = o.get(n), b = mm.get(n);
  if (!a && !b) { console.log(n.padEnd(14), '双方无'); continue; }
  const line = [];
  for (const f of frames) {
    const ma = (a||[]).find(x => x.frameNum === f);
    const mb = (b||[]).find(x => x.frameNum === f);
    const sa = ma ? angOf(ma.rotation).toFixed(0) : '--';
    const sb = mb ? angOf(mb.rotation).toFixed(0) : '--';
    line.push(`f${f}:${sa}/${sb}`);
  }
  console.log(n.padEnd(14), line.join(' '));
}
// 全局角差统计（每骨取中间帧 45 对比）
console.log('\n=== 全局角差统计 (帧45) ===');
let n = 0, sum = 0, worst = null;
for (const [name, list] of o) {
  const mb = mm.get(name);
  if (!mb) continue;
  const ma = list.find(x => x.frameNum === 45);
  const mbb = mb.find(x => x.frameNum === 45);
  if (!ma || !mbb) continue;
  const d = Math.abs(angOf(ma.rotation) - angOf(mbb.rotation));
  sum += d; n++;
  if (!worst || d > worst.d) worst = { name, d };
}
console.log(`样本 ${n} 骨, 平均角差 ${(sum/n).toFixed(1)}°, 最大 ${worst.d.toFixed(1)}° (${worst.name})`);
