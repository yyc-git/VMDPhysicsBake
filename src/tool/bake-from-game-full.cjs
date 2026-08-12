// 从新版抓取数据生成完整版 VMD：pickup 段每 2 帧采样 + pickup.vmd 动画骨原样
// 结构对齐 MMM：动画骨（pickup.vmd 原样）+ 物理骨（游戏实测，30fps）
const fs = require('fs');
const { MMDParser } = require('three/examples/jsm/libs/mmdparser.module.js');
const p = new MMDParser.Parser();
const readBuf = (pth) => { const b = fs.readFileSync(pth); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const CAPTURE = 'output/captures/game-bone-pickup.json';
const PICKUP_VMD = 'demo/assets/pickup.vmd';
const OUT = 'output/pickup_bake_HMS_gamevalue_full.vmd';

const raw = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'));
const pg = raw.entries.filter(e => e.meshName === '$girl$_PlayerGoddess');
console.log('PlayerGoddess entries:', pg.length);

// pickup 段：摆动从 f1140 开始，取 f1140 ~ f1460（约 160 物理帧 = 80 动画帧）
const START = 1140, END = 1460;
const seg = pg.filter(e => e.frame >= START && e.frame <= END);
console.log('pickup 段 entries:', seg.length, 'frame:', START, '~', END);

// 物理骨 = 抓取到的所有骨（裙子+头发+其他 yure/skirt）
const allBoneNames = new Set();
for (const e of seg) for (const bn of Object.keys(e.bones)) allBoneNames.add(bn);
console.log('物理骨数:', allBoneNames.size);

// 动画骨 = pickup.vmd 的骨骼（不含物理骨）
const pickupVmd = p.parseVmd(readBuf(PICKUP_VMD), true);
const outMotions = [];
// 1. 动画骨原样复制（跳过物理骨——MMM 结构：动画骨不修改）
const physSet = allBoneNames;
for (const m of pickupVmd.motions) {
  if (physSet.has(m.boneName)) continue; // 物理骨不复制动画数据
  outMotions.push({ boneName: m.boneName, frameNum: m.frameNum, position: [...m.position], rotation: [...m.rotation], interpolation: [...m.interpolation] });
}
console.log('动画骨 motions:', outMotions.length);

// 2. 物理骨：pickup 段每 2 帧采样（30fps），映射到动画帧 0-80
// 物理帧 f → 动画帧 = (f - START) / 2
const boneEntries = {};
for (const e of seg) {
  const animF = Math.round((e.frame - START) / 2);
  if (animF < 0 || animF > 90) continue;
  for (const [bn, data] of Object.entries(e.bones)) {
    if (!boneEntries[bn]) boneEntries[bn] = [];
    boneEntries[bn].push({ frame: animF, q: data.q });
  }
}
for (const [bn, arr] of Object.entries(boneEntries)) {
  // 按帧排序 + 去重
  arr.sort((a, b) => a.frame - b.frame);
  const seen = new Set();
  for (const item of arr) {
    if (seen.has(item.frame)) continue;
    seen.add(item.frame);
    outMotions.push({
      boneName: bn,
      frameNum: item.frame,
      position: [0, 0, 0],
      rotation: [...item.q],
      interpolation: new Array(64).fill(0)
    });
  }
}
console.log('物理骨 motions:', outMotions.length - (pickupVmd.motions.length - [...pickupVmd.motions].filter(m => physSet.has(m.boneName)).length));

// 3. morph 复制
const morphs = pickupVmd.morphs.map(m => ({ morphName: m.morphName, frameNum: m.frameNum, weight: m.weight }));

// 4. LEFT 转换（与 bake-from-game-value 一致）
const toFilePosition = (pp) => [pp[0], pp[1], -pp[2]];
const toFileRotation = (q) => [-q[0], -q[1], q[2], q[3]];
for (const m of outMotions) {
  m.position = toFilePosition(m.position);
  m.rotation = toFileRotation(m.rotation);
}

// 5. 写 VMD（复用 vmd-writer）
(async () => {
  const { writeVmd } = await import('./vmd-writer.mjs');
  const bytes = writeVmd('pickup_bake_game', outMotions, morphs);
  fs.mkdirSync('output', { recursive: true });
  fs.writeFileSync(OUT, bytes);
  console.log('written:', OUT, bytes.length, 'bytes, motions=' + outMotions.length + ' morphs=' + morphs.length);
})();
