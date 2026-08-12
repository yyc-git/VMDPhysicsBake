// 诊断7：胸骨翻转根因——查右胸上/胸上对应刚体参数 + 约束
import fs from 'fs';
const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();
const readBuf = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const pmx = parser.parsePmx(readBuf('mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx'), true);

const targetBones = ['右胸上', '左胸上', '胸上', '胸', '上半身'];
for (const bn of targetBones) {
  const bi = pmx.bones.findIndex(b => b.name === bn);
  console.log(`\n=== 骨骼 ${bn} (index ${bi}) ===`);
  if (bi === -1) continue;
  const b = pmx.bones[bi];
  console.log('position:', b.position, 'parent:', b.parentIndex, pmx.bones[b.parentIndex]?.name);
  // 关联刚体
  const rbs = pmx.rigidBodies.filter(rb => rb.boneIndex === bi);
  for (const rb of rbs) {
    console.log(`  刚体: name=${rb.name} type=${rb.type} shape=${rb.shape} size=${JSON.stringify(rb.size)} mass=${rb.mass} pos=${JSON.stringify(rb.position)} rot=${JSON.stringify(rb.rotation)} group=${rb.groupIndex} target=${rb.groupTarget}`);
  }
  // 关联约束
  const cons = pmx.constraints.filter(c => c.bodyIndexA === bi || c.bodyIndexB === bi || 
    (rbs.length && (c.bodyIndexA === rbs[0].index || c.bodyIndexB === rbs[0].index)));
  for (const c of cons.slice(0, 6)) {
    console.log(`  约束: A=${pmx.rigidBodies[c.bodyIndexA]?.name} B=${pmx.rigidBodies[c.bodyIndexB]?.name} springPos=${JSON.stringify(c.springPosition)} springRot=${JSON.stringify(c.springRotation)} transLim1=${JSON.stringify(c.translationLimitation1)} transLim2=${JSON.stringify(c.translationLimitation2)} rotLim1=${JSON.stringify(c.rotationLimitation1)} rotLim2=${JSON.stringify(c.rotationLimitation2)}`);
  }
}
