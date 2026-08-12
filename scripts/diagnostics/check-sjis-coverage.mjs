// 关键决策数据：物理骨 SJIS 可编码性 + MMM 版匹配情况
import fs from 'fs';
import * as m from 'three/examples/jsm/libs/mmdparser.module.js';
import { encodeSjis } from 'file:///D:/Github/GTS-Play/笔记/项目文档/changes/2026-08-05-mmd-vmd-unify/analysis/vmd-generator/vmd-writer.mjs';

const Parser = m.MMDParser.Parser;
const parser = new Parser();
const read = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

const pmx = parser.parsePmx(read('D:/Github/GTS-Play/mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx'), true);
const vmdMmm = parser.parseVmd(read('D:/Github/GTS-Play/mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd'), true);

// 物理骨（type 1/2 且 boneIndex != -1）
const physBoneIndices = new Set();
for (const rb of pmx.rigidBodies) {
  if ((rb.type === 1 || rb.type === 2) && rb.boneIndex !== -1) physBoneIndices.add(rb.boneIndex);
}
const physBones = [...physBoneIndices].map(i => pmx.bones[i].name);
console.log('物理骨总数:', physBones.length);

// SJIS 可编码
const sjisOk = [], sjisFail = [];
for (const n of physBones) {
  try { encodeSjis(n); sjisOk.push(n); } catch (e) { sjisFail.push(n); }
}
console.log('SJIS 可编码物理骨:', sjisOk.length);
console.log('SJIS 不可编码物理骨:', sjisFail.length);

// MMM 版 VMD 骨名集合
const mmmNames = new Set(vmdMmm.motions.map(x => x.boneName));
// MMM 版中能匹配 PMX 的物理骨
const mmmMatched = physBones.filter(n => mmmNames.has(n));
console.log('MMM 版可匹配物理骨:', mmmMatched.length);
// MMM 版中有、但 SJIS 编不了的物理骨（说明 MMM 也写不了）
const mmmMatchedFail = sjisFail.filter(n => mmmNames.has(n));
console.log('MMM 版匹配但 SJIS 编不了的:', mmmMatchedFail.length, JSON.stringify(mmmMatchedFail));

const out = [];
out.push('=== SJIS 可编码物理骨 (' + sjisOk.length + ') ===');
out.push(sjisOk.join('\n'));
out.push('\n=== SJIS 不可编码物理骨 (' + sjisFail.length + ') ===');
out.push(sjisFail.join('\n'));
out.push('\n=== MMM 版可匹配物理骨 (' + mmmMatched.length + ') ===');
out.push(mmmMatched.join('\n'));
fs.writeFileSync('D:/Github/GTS-Play/笔记/项目文档/changes/2026-08-05-mmd-vmd-unify/analysis/vmd-physics-bake/physbone-sjis-analysis.txt', out.join('\n'), 'utf8');
console.log('analysis written');
