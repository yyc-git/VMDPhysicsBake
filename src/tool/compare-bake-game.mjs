#!/usr/bin/env node
// compare-bake-game.mjs — game 模式 vs patch 模式 vs MMM 参考：关键物理骨角度对比表
// 输出：笔记/项目文档/changes/2026-08-05-mmd-vmd-unify/analysis/vmd-physics-bake/game-mode-comparison.md 的数据源（stdout）
// 口径与 diag-skirt3.mjs 一致：angOf(q) = 2*acos(min(1,max(-1,q[3])))*180/PI（rotation 相对单位四元数的角度）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MMDParser } from 'three/examples/jsm/libs/mmdparser.module.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../../');
const MMM_DEFAULT = path.join(PROJECT_ROOT, 'output', 'pickup_bake_mmm_reference.vmd');

const parser = new MMDParser.Parser();
const load = (p) => {
  const b = fs.readFileSync(p);
  return parser.parseVmd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), true);
};
const byName = (v) => {
  const m = new Map();
  for (const x of v.motions) {
    if (!m.has(x.boneName)) m.set(x.boneName, []);
    m.get(x.boneName).push(x);
  }
  return m;
};
const angOf = (q) => 2 * Math.acos(Math.min(1, Math.max(-1, q[3]))) * 180 / Math.PI;

const GAME = path.join(PROJECT_ROOT, 'output', 'pickup_bake_game.vmd');
const PATCH = path.join(PROJECT_ROOT, 'output', 'pickup_bake.vmd');
const MMM = process.argv[2] || MMM_DEFAULT;

for (const p of [GAME, PATCH, MMM]) {
  if (!fs.existsSync(p)) { console.error('MISSING:', p); process.exit(2); }
}

const vg = load(GAME), vp = load(PATCH), vm = load(MMM);
const g = byName(vg), p = byName(vp), m = byName(vm);
console.log(`GAME motions=${vg.motions.length} PATCH=${vp.motions.length} MMM=${vm.motions.length}`);

// 关键骨：裙子 + 胸部（任务关注点）
const sampleBones = ['スカート_0_1', 'スカート_0_10', 'スカート_1_1', '前髪１', '胸上', '左胸上', '右胸上', '髪１'];
const frames = [0, 15, 30, 45, 60, 75, 90];
console.log('=== 关键物理骨 rotation 角(°) 帧采样对比 game / patch / mmm ===');
for (const n of sampleBones) {
  const a = g.get(n), b = p.get(n), c = m.get(n);
  const line = [];
  for (const f of frames) {
    const ma = (a || []).find(x => x.frameNum === f);
    const mb = (b || []).find(x => x.frameNum === f);
    const mc = (c || []).find(x => x.frameNum === f);
    const sa = ma ? angOf(ma.rotation).toFixed(1) : '--';
    const sb = mb ? angOf(mb.rotation).toFixed(1) : '--';
    const sc = mc ? angOf(mc.rotation).toFixed(1) : '--';
    line.push(`f${f}:${sa}/${sb}/${sc}`);
  }
  console.log(n.padEnd(14), line.join(' '));
}

// 全局角差（帧45，game vs MMM，patch vs MMM）
const stat45 = (src, ref) => {
  let n = 0, sum = 0, worst = null;
  for (const [name, list] of src) {
    const mb = ref.get(name);
    if (!mb) continue;
    const ma = list.find(x => x.frameNum === 45);
    const mbb = mb.find(x => x.frameNum === 45);
    if (!ma || !mbb) continue;
    const d = Math.abs(angOf(ma.rotation) - angOf(mbb.rotation));
    sum += d; n++;
    if (!worst || d > worst.d) worst = { name, d };
  }
  return { n, avg: n ? (sum / n).toFixed(1) : '--', worst };
};
const gv = stat45(g, m), pv = stat45(p, m);
console.log(`\n=== 全局角差统计 (帧45, 相对MMM) ===`);
console.log(`game : 样本 ${gv.n} 骨, 平均角差 ${gv.avg}°, 最大 ${gv.worst ? gv.worst.d.toFixed(1) + '° (' + gv.worst.name + ')' : '--'}`);
console.log(`patch: 样本 ${pv.n} 骨, 平均角差 ${pv.avg}°, 最大 ${pv.worst ? pv.worst.d.toFixed(1) + '° (' + pv.worst.name + ')' : '--'}`);
