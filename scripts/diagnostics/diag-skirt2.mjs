// 诊断2：MMM 版全物理骨 position 是否全 0 + 我们输出对比
import fs from 'fs';
const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();
function load(p) { const b = fs.readFileSync(p); return parser.parseVmd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), true); }
const mmm = load('mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd');
const ours = load('笔记/项目文档/changes/2026-08-05-mmd-vmd-unify/analysis/vmd-physics-bake/output/pickup_bake.vmd');
const byName = (v) => { const m = new Map(); for (const x of v.motions) { if (!m.has(x.boneName)) m.set(x.boneName, []); m.get(x.boneName).push(x); } return m; };
const mm = byName(mmm), o = byName(ours);

// 1. MMM 全骨 position 非零统计
let mmmNonZero = 0, mmmTotal = 0;
const mmmNonZeroBones = [];
for (const [n, list] of mm) {
  mmmTotal++;
  const maxMag = Math.max(...list.map(x => Math.hypot(...x.position)));
  if (maxMag > 1e-3) { mmmNonZero++; mmmNonZeroBones.push({ n, maxMag: maxMag.toFixed(2) }); }
}
console.log(`MMM 版: 总骨 ${mmmTotal}, position 非零骨 ${mmmNonZero}`);
console.log('MMM position 非零骨列表(前10):', JSON.stringify(mmmNonZeroBones.slice(0, 10), null, 0));

// 2. 我们输出 position 非零物理骨统计（模长 > 10 单位 = 异常大）
let oursBig = [];
for (const [n, list] of o) {
  const maxMag = Math.max(...list.map(x => Math.hypot(...x.position)));
  if (maxMag > 10) oursBig.push({ n, maxMag: maxMag.toFixed(1) });
}
console.log(`\n我们输出: position 模长>10 的骨 ${oursBig.length} 个`);
console.log(JSON.stringify(oursBig.slice(0, 20), null, 0));

// 3. MMM 版 rotation 有值的骨数（物理骨确实只写 rotation？）
let rotZero = 0, rotNonZero = 0;
for (const [n, list] of mm) {
  const maxAng = Math.max(...list.map(x => Math.abs(x.rotation[3] - 1) + Math.abs(x.rotation[0]) + Math.abs(x.rotation[1]) + Math.abs(x.rotation[2])));
  if (maxAng < 1e-6) rotZero++; else rotNonZero++;
}
console.log(`\nMMM 版 rotation: 全零骨 ${rotZero}, 有旋转骨 ${rotNonZero}`);

// 4. 采样：MMM 裙子/头发/胸 骨骼 rotation 幅度 vs 我们
const sample = ['スカート_0_1', '前髪１', '前髪１（左）', '胸上', '髪１', 'スカート_1_1'];
console.log('\n=== 采样骨 rotation 幅度 (帧45, 度) ===');
const angOf = (q) => 2 * Math.acos(Math.min(1, Math.max(-1, q[3]))) * 180 / Math.PI;
for (const n of sample) {
  const a = (o.get(n) || []).find(x => x.frameNum === 45);
  const b = (mm.get(n) || []).find(x => x.frameNum === 45);
  const fmt = (m, tag) => m ? `${tag} ${angOf(m.rotation).toFixed(1)}°` : `${tag} 无`;
  console.log(n.padEnd(18), fmt(a, 'ours'), ' |', fmt(b, 'mmm'));
}
