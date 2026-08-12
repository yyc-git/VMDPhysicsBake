// bake-from-game-full.cjs — 游戏抓取数据 → 烘焙 VMD（v2 修复版）
// 修复 2026-08-09（对比 v1 的三个 bug）：
//   a. frame 0 缺失：主段首条采样直接映射动画帧 0（不再依赖 START 奇偶）
//   b. 摆动后半段截断：主段 = 能量法自动定位（平滑能量 > 15° 的最长连续段），不再拍脑袋 1140..1460
//   c. 帧映射无依据：(frame-START)/2 → 均匀抽稀映射 animF = round(i * 90 / (n-1))，n = 主段采样数
// 结构：动画骨（pickup.vmd 原样）+ 物理骨（游戏实测，抽稀到 0..90 帧）
const fs = require('fs');
const { MMDParser } = require('three/examples/jsm/libs/mmdparser.module.js');
const p = new MMDParser.Parser();
const readBuf = (pth) => { const b = fs.readFileSync(pth); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const CAPTURE = process.argv[2] || 'output/captures/game-bone-pickup.json';
const PICKUP_VMD = 'demo/assets/pickup.vmd';
const OUT = process.argv[3] || 'output/pickup_bake_game_v2.vmd';
const ANIM_FRAMES = 90; // pickup.vmd maxFrame

const raw = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'));
const pg = raw.entries.filter(e => e.meshName === '$girl$_PlayerGoddess');
console.log('PlayerGoddess entries:', pg.length, 'frame:', pg[0]?.frame, '..', pg[pg.length - 1]?.frame);

// ---- 1. 能量法定位 pickup 主段 ----
const qAng = (q1, q2) => {
  const dot = Math.abs(q1[0]*q2[0] + q1[1]*q2[1] + q1[2]*q2[2] + q1[3]*q2[3]);
  return 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
};
const WATCH = ['スカート_0_3', 'スカート_0_10', 'スカート_6_3', 'スカート_13_10', 'スカート_0_1', '前髪１'];
const prev = {};
const rows = [];
for (const e of pg) {
  let energy = 0;
  for (const bn of WATCH) {
    const d = e.bones && e.bones[bn];
    if (d && prev[bn]) energy += qAng(prev[bn], d.q);
    if (d) prev[bn] = d.q;
  }
  rows.push({ frame: e.frame, energy });
}
// 滑动窗口平滑（±5）
const smooth = rows.map((r, i) => {
  let s = 0, n = 0;
  for (let j = Math.max(0, i - 5); j <= Math.min(rows.length - 1, i + 5); j++) { s += rows[j].energy; n++; }
  return { frame: r.frame, energy: s / n };
});
const HIGH = 15;
let segs = [], cur = null;
for (const r of smooth) {
  if (r.energy > HIGH) {
    if (!cur) cur = { start: r.frame, end: r.frame, n: 0 };
    cur.end = r.frame; cur.n++;
  } else if (cur) { segs.push(cur); cur = null; }
}
if (cur) segs.push(cur);
segs.sort((a, b) => (b.end - b.start) - (a.end - a.start));
const mainSeg = segs[0];
if (!mainSeg) { console.error('未找到主摆动段'); process.exit(1); }
console.log('主摆动段: frame', mainSeg.start, '..', mainSeg.end, `(${mainSeg.n} 条采样)`);
const seg = pg.filter(e => e.frame >= mainSeg.start && e.frame <= mainSeg.end);
console.log('主段实际条数:', seg.length, '采样率≈', (seg.length / 3).toFixed(1), '条/s（假设 pickup 3s）');

// ---- 2. 物理骨 = 主段全部骨 ----
const allBoneNames = new Set();
for (const e of seg) for (const bn of Object.keys(e.bones)) allBoneNames.add(bn);
console.log('物理骨数:', allBoneNames.size);

// ---- 3. 动画骨 = pickup.vmd 原样（跳过物理骨）----
const pickupVmd = p.parseVmd(readBuf(PICKUP_VMD), true);
const outMotions = [];
const physSet = allBoneNames;
for (const m of pickupVmd.motions) {
  if (physSet.has(m.boneName)) continue;
  outMotions.push({ boneName: m.boneName, frameNum: m.frameNum, position: [...m.position], rotation: [...m.rotation], interpolation: [...m.interpolation] });
}
console.log('动画骨 motions:', outMotions.length);

// ---- 4. 物理骨：主段均匀抽稀映射到 0..ANIM_FRAMES ----
// animF = round(i * ANIM_FRAMES / (n-1))，i = 主段内索引 0..n-1
const n = seg.length;
const boneEntries = {}; // boneName -> Map<animFrame, q>
for (let i = 0; i < n; i++) {
  const e = seg[i];
  const animF = Math.round(i * ANIM_FRAMES / (n - 1));
  for (const [bn, data] of Object.entries(e.bones)) {
    if (!boneEntries[bn]) boneEntries[bn] = new Map();
    // 同帧多条（抽稀碰撞）取后者（时间更晚更接近真实）
    boneEntries[bn].set(animF, data.q);
  }
}
let physMotionCount = 0;
for (const [bn, frameMap] of Object.entries(boneEntries)) {
  const frames = [...frameMap.keys()].sort((a, b) => a - b);
  // 补帧 0：确保动画帧 0 有物理骨（用第一条采样）
  if (frames[0] !== 0) {
    const firstQ = frameMap.get(frames[0]);
    outMotions.push({ boneName: bn, frameNum: 0, position: [0, 0, 0], rotation: [...firstQ], interpolation: new Array(64).fill(0) });
    frames.unshift(0);
  }
  // 补帧 ANIM_FRAMES：确保动画末尾有物理骨
  if (frames[frames.length - 1] !== ANIM_FRAMES) {
    const lastQ = frameMap.get(frames[frames.length - 1]);
    outMotions.push({ boneName: bn, frameNum: ANIM_FRAMES, position: [0, 0, 0], rotation: [...lastQ], interpolation: new Array(64).fill(0) });
    frames.push(ANIM_FRAMES);
  }
  for (const f of frames) {
    outMotions.push({
      boneName: bn,
      frameNum: f,
      position: [0, 0, 0],
      rotation: [...frameMap.get(f)],
      interpolation: new Array(64).fill(0)
    });
  }
  physMotionCount += frames.length;
}
console.log('物理骨 motions:', physMotionCount);

// ---- 5. LEFT 转换（与 v1/bake 一致）----
const toFilePosition = (pp) => [pp[0], pp[1], -pp[2]];
const toFileRotation = (q) => [-q[0], -q[1], q[2], q[3]];
for (const m of outMotions) {
  m.position = toFilePosition(m.position);
  m.rotation = toFileRotation(m.rotation);
}

// ---- 6. 写 VMD + 自检 ----
(async () => {
  const { writeVmd } = await import('./vmd-writer.mjs');
  const morphs = pickupVmd.morphs.map(m => ({ morphName: m.morphName, frameNum: m.frameNum, weight: m.weight }));
  const bytes = writeVmd('pickup_bake_game_v2', outMotions, morphs);
  fs.mkdirSync('output', { recursive: true });
  fs.writeFileSync(OUT, bytes);
  console.log('written:', OUT, bytes.length, 'bytes, motions=' + outMotions.length + ' morphs=' + morphs.length);

  // 自检
  const back = p.parseVmd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true);
  const byName = {};
  for (const m of back.motions) {
    if (!byName[m.boneName]) byName[m.boneName] = [];
    byName[m.boneName].push(m);
  }
  const physBones = Object.keys(boneEntries);
  let frame0Ok = true, frameRangeOk = true, missing = [];
  for (const bn of physBones) {
    const arr = byName[bn] || [];
    const fs_ = arr.map(m => m.frameNum);
    if (!fs_.includes(0)) { frame0Ok = false; missing.push(bn + ':无0'); }
    if (Math.min(...fs_) !== 0 || Math.max(...fs_) !== ANIM_FRAMES) { frameRangeOk = false; missing.push(bn + ':范围' + Math.min(...fs_) + '..' + Math.max(...fs_)); }
  }
  console.log('--- self-check ---');
  console.log('物理骨 frame0 覆盖:', frame0Ok ? 'OK' : 'FAIL ' + missing.join(' '));
  console.log('物理骨帧范围 0..' + ANIM_FRAMES + ':', frameRangeOk ? 'OK' : 'FAIL');
  console.log('物理骨数:', physBones.length, '| 动画骨保留:', back.motions.length - byName[physBones[0]].length * Object.keys(boneEntries).length > 0);
})();
