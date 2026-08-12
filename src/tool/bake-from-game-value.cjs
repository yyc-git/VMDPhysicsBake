// 直接用游戏实测物理值生成 VMD（验证链路：游戏数据 → VMD → MMD 播放）
// 物理骨 = 游戏 __mmdPhysicsBoneLog 实测 quaternion；动画骨 = pickup.vmd 原始
const fs = require('fs');
const path = require('path');
const { MMDParser } = require('three/examples/jsm/libs/mmdparser.module.js');
const p = new MMDParser.Parser();

const load = (pth) => {
  const buf = fs.readFileSync(pth);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return p.parseVmd(ab, true);
};

// 1. 游戏实测数据（pickup 段；capture 需放置于 output/captures/ 下）
const raw = JSON.parse(fs.readFileSync('output/captures/game-bone-pickup.json', 'utf8'));
const pg = raw.entries.filter(e => e.meshName === '$girl$_PlayerGoddess' && e.frame >= 901 && e.frame <= 1081);
console.log('pickup 段采样点:', pg.map(e => e.frame).join(','));

// 2. 动画骨：pickup.vmd 原始
const animRaw = load('demo/assets/pickup.vmd');
const animByBone = {};
for (const m of animRaw.motions) {
  if (!animByBone[m.boneName]) animByBone[m.boneName] = [];
  animByBone[m.boneName].push(m);
}
// 物理骨名集合（游戏日志里的）
const gameBoneNames = new Set();
for (const e of pg) for (const bn of Object.keys(e.bones || {})) gameBoneNames.add(bn);

// 3. 组装 motions
const outMotions = [];
// 动画骨（排除物理骨，避免冲突）
for (const [bn, arr] of Object.entries(animByBone)) {
  if (gameBoneNames.has(bn)) continue;
  for (const m of arr) {
    outMotions.push({ boneName: bn, frameNum: m.frameNum, position: [...m.position], rotation: [...m.rotation], interpolation: [...m.interpolation] });
  }
}
// 物理骨（游戏实测值）
// 帧号映射：游戏物理帧 901 → 动画帧 0，每 2 物理帧 = 1 动画帧
for (const e of pg) {
  const animFrame = Math.round((e.frame - 901) / 2);
  for (const [bn, v] of Object.entries(e.bones || {})) {
    outMotions.push({
      boneName: bn,
      frameNum: animFrame,
      position: [0, 0, 0], // 物理骨 position 不写（MMD 约定）
      rotation: [...v.q],
      interpolation: new Array(64).fill(0)
    });
  }
}

// 4. 坐标空间转换（RIGHT → LEFT，与 bake 一致）
const toFilePosition = (p) => [p[0], p[1], -p[2]];
const toFileRotation = (q) => [-q[0], -q[1], q[2], q[3]];
for (const m of outMotions) {
  m.position = toFilePosition(m.position);
  m.rotation = toFileRotation(m.rotation);
}

// 5. 写出
const { writeVmd } = require('./vmd-writer.mjs').default || require('./vmd-writer.mjs');
const outBytes = writeVmd('pickup_bake_game_value', outMotions, animRaw.morphs);
const outPath = 'output/pickup_bake_HMS_gamevalue.vmd';
fs.writeFileSync(outPath, outBytes);
console.log(`written: ${outPath} (${outBytes.length} bytes) motions=${outMotions.length}`);

// 验证回读
const check = load(outPath);
console.log('回读 motions:', check.motions.length);
const physCheck = [...new Set(check.motions.filter(m => gameBoneNames.has(m.boneName)).map(m => m.boneName))];
console.log('物理骨数:', physCheck.length, '示例:', physCheck.slice(0, 5).join(', '));
