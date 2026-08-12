// 对比原始 vmd_160/pickup.vmd 与烘焙版 vmd_bake_physics/pickup.vmd 的骨骼差异
// 用途: 物理烘焙研究 — 看烘焙到底新增/改了什么
import * as mmdParserMod from 'file:///D:/Github/GTS-Play/node_modules/three/examples/jsm/libs/mmdparser.module.js';
import fs from 'fs';

const Parser = mmdParserMod.MMDParser.Parser;
const parser = new Parser();

function parse(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return parser.parseVmd(ab, true);
}

const raw = parse('D:/Github/GTS-Play/packages/frontend/src/resource_girl/city/vmd_160/pickup.vmd');
const baked = parse('D:/Github/GTS-Play/mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd');

const byBone = (vmd) => {
  const m = new Map();
  for (const x of vmd.motions) {
    if (!m.has(x.boneName)) m.set(x.boneName, []);
    m.get(x.boneName).push(x);
  }
  return m;
};

const rawBones = byBone(raw);
const bakedBones = byBone(baked);

const rawNames = new Set(rawBones.keys());
const bakedNames = new Set(bakedBones.keys());

console.log(`raw:   ${raw.motions.length} motions, ${rawNames.size} bones, maxFrame=${Math.max(...raw.motions.map(m => m.frameNum))}`);
console.log(`baked: ${baked.motions.length} motions, ${bakedNames.size} bones, maxFrame=${Math.max(...baked.motions.map(m => m.frameNum))}`);
console.log(`morphs: raw=${raw.morphs.length} baked=${baked.morphs.length}`);
console.log('');

// 1) 新增骨骼（烘焙版独有）
const added = [...bakedNames].filter(n => !rawNames.has(n));
console.log(`=== 烘焙新增骨骼 (${added.length}) ===`);
for (const n of added.sort()) {
  const frames = bakedBones.get(n).sort((a, b) => a.frameNum - b.frameNum);
  const hasPos = frames.some(f => f.position.some(v => Math.abs(v) > 1e-4));
  const hasRot = frames.some(f => f.rotation.some(v => Math.abs(v) > 1e-4));
  console.log(`${n.padEnd(24)} frames=${String(frames.length).padEnd(4)} range=[${frames[0].frameNum}..${frames[frames.length-1].frameNum}] pos=${hasPos ? 'Y' : 'n'} rot=${hasRot ? 'Y' : 'n'}`);
}

// 2) 共有骨骼但帧数大幅变化
console.log('\n=== 共有骨骼: 烘焙帧数 > 原始帧数 × 3 (逐帧烘焙) ===');
const shared = [...rawNames].filter(n => bakedNames.has(n));
for (const n of shared.sort()) {
  const r = rawBones.get(n).length;
  const b = bakedBones.get(n).length;
  if (b > r * 3) {
    console.log(`${n.padEnd(24)} raw=${String(r).padEnd(4)} baked=${String(b).padEnd(4)}`);
  }
}

// 3) 共有骨骼: 原始有 position 位移、烘焙后 position 是否一致（验证动作骨未被烘焙改动）
console.log('\n=== 原始有 position 位移的骨骼: 烘焙后 position 一致性 ===');
const posBones = [...rawBones].filter(([n, frames]) => frames.some(f => f.position.some(v => Math.abs(v) > 1e-3)));
for (const [n, rframes] of posBones) {
  const bframes = bakedBones.get(n);
  if (!bframes) { console.log(`${n}: 烘焙缺失!`); continue; }
  // 对每个原始帧找烘焙对应帧比 position
  const bMap = new Map(bframes.map(f => [f.frameNum, f]));
  let maxDiff = 0;
  for (const f of rframes) {
    const bf = bMap.get(f.frameNum);
    if (bf) {
      for (let i = 0; i < 3; i++) maxDiff = Math.max(maxDiff, Math.abs(f.position[i] - bf.position[i]));
    }
  }
  console.log(`${n.padEnd(24)} maxPosDiff=${maxDiff.toFixed(6)} ${maxDiff < 1e-3 ? '(一致)' : '(!!!差异!!!)'}`);
}
