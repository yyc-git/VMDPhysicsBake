// bake-from-view.cjs — 可视化页抓取数据 → VMD（复用游戏内烘焙 v2 产物链路）
// 与 bake-from-game-v2.cjs 同逻辑：能量法主段 + 均匀抽稀 0..ANIM_FRAMES + 补帧 + LEFT 转换
// 多动画适配：
//   - 抓取文件名 view-bake-bone-log-<char>-<anim>-<timestamp>.json → 解析出 anim
//   - 动画骨 = 对应源 VMD（demo/assets/<anim>.vmd）原样
//   - ANIM_FRAMES 按该 VMD 的最大帧号（pickup=90 …），不硬编码 90
// 用法：node bake-from-view.cjs <capture.json> [out.vmd]
const fs = require('fs');
const path = require('path');
const { MMDParser } = require('three/examples/jsm/libs/mmdparser.module.js');
const { encodeSjis } = require('./vmd-writer.mjs');
const p = new MMDParser.Parser();
const readBuf = (pth) => { const b = fs.readFileSync(pth); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

// SJIS 可编码缓存（HMS 骨名含简体字如 亲/饰/发 → 无法 SJIS 编码 → 写 VMD 抛错，必须排除）
const sjisOkCache = new Map();
function sjisEncodable(name) {
  if (sjisOkCache.has(name)) return sjisOkCache.get(name);
  try { encodeSjis(name); sjisOkCache.set(name, true); return true; }
  catch { sjisOkCache.set(name, false); return false; }
}
// VMD 骨名固定 15 字节 SJIS：超长骨名（如 Vanilla 的 _yure_hair_h_F03=16B/Skirt*_yure_skirt_h_=23B）
// 若静默截断会与其它超长骨名撞名 → 数据错乱。正确行为 = 跳过 + 警告（MMD 物理引擎自行驱动这些骨）
const sjisLenCache = new Map();
function sjisLenOk(name) {
  if (sjisLenCache.has(name)) return sjisLenCache.get(name);
  let ok;
  try { ok = encodeSjis(name).length <= 15; } catch { ok = false; }
  sjisLenCache.set(name, ok);
  return ok;
}
const CAPTURE = process.argv[2];
const VMD_BASE = 'demo/assets/';

if (!CAPTURE) { console.error('usage: node bake-from-view.cjs <capture.json> [out.vmd]'); process.exit(1); }

// ---- 0. 从文件名解析 anim（view-bake-bone-log-<char>-<anim>-<ts>.json）----
const mName = path.basename(CAPTURE).match(/^view-bake-bone-log-([^-]+)-([^-]+)-.*\.json$/);
const ANIM = mName ? mName[2] : (process.argv[4] || 'pickup');
const CHAR = mName ? mName[1] : 'hms';
const raw = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'));
// 源动画目录固定在 demo/assets
const SRC_VMD = `demo/assets/${ANIM}.vmd`;
const OUT = process.argv[3] || `output/${CHAR}_${ANIM}_view.vmd`;

// ---- PMX 刚体 type 映射（★ 2026-08-10：type 0 = 跟骨，不参与物理、跟随动画 → 禁止烘焙其物理采样值）----
// 踩坑：Vanilla 的 右ひざD/左ひざD/右足D/左足D 均为 type 0 跟骨（刚体「右ひざ」绑定骨「右ひざD」），
// 物理世界里被碰撞拉扯弄歪（同初音右足 -0.48 教训）→ 烘焙写歪值 → MMD 里膝盖/脚穿模。
// 源动画只有无 D 名（右ひざ）的帧 → animBoneSet 精确匹配不到 D 名 → 此前被当物理骨烘焙。
const rbType = new Map();
if (raw.pmx) {
  try {
    const pmxPath = String(raw.pmx).replace(/^\//, ''); // URL /demo/assets/... → 相对仓库根
    const pmxBuf = fs.readFileSync(pmxPath);
    const pmx = p.parsePmx(pmxBuf.buffer.slice(pmxBuf.byteOffset, pmxBuf.byteOffset + pmxBuf.byteLength), true);
    for (const rb of pmx.rigidBodies) {
      const bn = pmx.bones[rb.boneIndex] && pmx.bones[rb.boneIndex].name;
      if (bn && !rbType.has(bn)) rbType.set(bn, rb.type);
    }
    console.log('PMX 刚体映射:', pmxPath, '→', rbType.size + ' 骨');
  } catch (e) {
    console.log('PMX 解析失败(跳过 type 过滤):', e.message);
  }
}

const pg = raw.entries; // 可视化页只有一组 mesh
console.log('capture:', path.basename(CAPTURE), '→ anim=' + ANIM + ' char=' + CHAR);
console.log('entries:', pg.length, 'frame:', pg[0]?.frame, '..', pg[pg.length - 1]?.frame);

// ---- 源 VMD（动画骨 + ANIM_FRAMES 来源）----
const srcVmd = p.parseVmd(readBuf(SRC_VMD), true);
let maxFrame = 0;
for (const m of srcVmd.motions) if (m.frameNum > maxFrame) maxFrame = m.frameNum;
const ANIM_FRAMES = maxFrame;
console.log('源 VMD:', SRC_VMD, 'maxFrame=' + maxFrame, 'ANIM_FRAMES=' + ANIM_FRAMES);

// ---- 1. 能量法定位主段（与 v2 一致）----
// 动态 WATCH 骨：默认优先裙子+前髪（HMS 命名），若全不存在（如初音只有头发骨）
// 则从采样骨中选总变化量最大的前 6 个物理骨作为观察骨
const qAng = (q1, q2) => {
  const dot = Math.abs(q1[0]*q2[0] + q1[1]*q2[1] + q1[2]*q2[2] + q1[3]*q2[3]);
  return 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
};
// 🔴 物理骨判定不再用骨名正则（曾漏掉 しっぽ/腰ベルト/腰羽 等非「髪/スカート」命名的物理骨）
// 采样骨全集 = physics.bodies（PMX 刚体创建的物理体）关联骨 = 有物理数据的骨骼全集
let WATCH = ['スカート_0_3', 'スカート_0_10', 'スカート_6_3', 'スカート_13_10', 'スカート_0_1', '前髪１'];
// 检查默认 WATCH 是否大部分存在于采样中；少于 3 个则动态选变化最大的 6 骨
{
  const existCount = WATCH.filter(bn => pg.some(e => e.bones && e.bones[bn])).length;
  if (existCount < 3) {
    const totalDelta = {};
    const prevTmp = {};
    for (const e of pg) {
      for (const [bn, d] of Object.entries(e.bones || {})) {
        if (prevTmp[bn]) totalDelta[bn] = (totalDelta[bn] || 0) + qAng(prevTmp[bn], d.q);
        prevTmp[bn] = d.q;
      }
    }
    WATCH = Object.entries(totalDelta).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([bn]) => bn);
    console.log('WATCH 骨动态选取:', WATCH.join(', '));
    if (!WATCH.length) { console.error('未找到任何物理骨，无法定位主段'); process.exit(1); }
  } else {
    console.log('WATCH 骨默认列表命中:', existCount + ' 个');
  }
}
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
// 🔴 主段起点延伸到采样起点：warmup 过渡（初始绑定姿态 → 下落姿态）是关键过程，
//   若从主段 start 开始会切掉 0..30 帧，补帧 0 用帧 31 的 q（≈绑定姿态）→ MMD 播放头发悬浮（初音 bug）
mainSeg.start = pg[0].frame;
console.log('主摆动段: frame', mainSeg.start, '..', mainSeg.end, `(${mainSeg.n} 条采样)`);
const seg = pg.filter(e => e.frame >= mainSeg.start && e.frame <= mainSeg.end);
console.log('主段实际条数:', seg.length);

// ---- 2. 物理骨集合 = 采样骨全集（★ 2026-08-10：排除动画骨后才是真正写物理值的骨）----
// 采样来自 view-bake.html 的 recordPhysicsFrame：遍历 physics.bodies（MMDPhysics 基于 PMX rigidBodies 创建），
// 每个 body 关联一个 bone → 骨名全集即「PMX 有刚体的骨骼」。
// 其中源动画有帧的骨（右足/前髪１ 等）= 动画骨，不写物理值；纯物理骨（源动画无帧）才写采样值
const animBoneSet = new Set(srcVmd.motions.map(m => m.boneName));
const allBoneNames = new Set();
let longSkipped = 0, type0Skipped = 0;
for (const e of seg) for (const bn of Object.keys(e.bones)) {
  // 排除含 U+FFFD 的骨名（PMX 内无法解码的 SJIS 特殊字符 → 写 VMD 会抛错）
  if (bn.includes('\uFFFD')) continue;
  // 排除 SJIS 不可编码骨名（简体字 亲/饰/发 等 → encodeSjis 抛错）
  if (!sjisEncodable(bn)) continue;
  // 排除超 15 字节骨名（VMD 格式限制；静默截断会撞名损坏数据）
  if (!sjisLenOk(bn)) { longSkipped++; continue; }
  // 排除 type 0 跟骨（PMX 刚体数据：跟随动画不参与物理，采样值会被碰撞拉扯弄歪）
  if (rbType.get(bn) === 0) { type0Skipped++; continue; }
  // ★ 动画骨中仅 type 1/2 物理骨写物理值（2026-08-10 兄弟拍板：动画不应有胸部等物理骨的动画帧，应忽略当物理骨烘焙）
  const rbT = rbType.get(bn);
  if (animBoneSet.has(bn) && rbT !== 1 && rbT !== 2) continue; // type 0/无刚体动画骨：保留源动画帧
  allBoneNames.add(bn);
}
console.log('物理骨数(采样全集-动画骨):', allBoneNames.size, '| 动画骨数(源动画有帧):', animBoneSet.size, '| 超15字节跳过:', longSkipped, '| type0跟骨跳过:', type0Skipped);

// ---- 3. 动画骨 = 源 VMD 原样（★ 2026-08-10 修复：不再跳过「刚体骨」的动画帧）----
// 此前 physSet.has(m.boneName) continue 把右足/左ひざ/前髪１ 等「源动画有帧的刚体骨”动画帧
// 全部丢弃 → 第 4 步用物理采样值覆盖 → 腿歪/膝盖 95°/前髪翘起（初音 MMD 实测错误）。
// 正确行为（对齐 MMM pickup.vmd）：源动画有帧的骨 = 动画骨，保留源动画帧；
// 物理采样只写源动画无帧的骨（纯物理骨：しっぽ/右髪２/腰ベルト/ﾈｸﾀｲ/アホ毛 等）
const outMotions = [];for (const m of srcVmd.motions) {
  // ★ type 1/2 物理骨：忽略源动画帧（兄弟拍板：物理骨动画帧应忽略，如左胸上/右胸上），改由物理采样驱动
  const rbT = rbType.get(m.boneName);
  if (rbT === 1 || rbT === 2) continue;
  outMotions.push({ boneName: m.boneName, frameNum: m.frameNum, position: [...m.position], rotation: [...m.rotation], interpolation: [...m.interpolation] });
}
console.log('动画骨 motions:', outMotions.length, '(全部源动画帧，含右足/前髪１ 等刚体骨动画帧)');

// ---- 4. 物理骨：主段均匀抽稀映射 0..ANIM_FRAMES ----
const n = seg.length;
const boneEntries = {};
for (let i = 0; i < n; i++) {
  const e = seg[i];
  const animF = Math.round(i * ANIM_FRAMES / (n - 1));
  for (const [bn, data] of Object.entries(e.bones)) {
    if (bn.includes('\uFFFD')) continue; // 排除无法 SJIS 编码的乱码骨名（PMX 内特殊字符）
    if (!sjisEncodable(bn)) continue; // 排除 SJIS 不可编码骨名（简体字）
    if (!sjisLenOk(bn)) continue; // 排除超 15 字节骨名（VMD 格式限制）
    if (rbType.get(bn) === 0) continue; // ★ type 0 跟骨：跟随动画，物理采样值会被碰撞拉扯弄歪（Vanilla 右ひざD 穿模教训）
    // ★ 动画骨中仅 type 1/2 物理骨写物理值（2026-08-10 兄弟拍板）
    const rbT = rbType.get(bn);
    if (animBoneSet.has(bn) && rbT !== 1 && rbT !== 2) continue;
    if (!boneEntries[bn]) boneEntries[bn] = new Map();
    boneEntries[bn].set(animF, data.q);
  }
}
// ★ 2026-08-10：只丢弃物理启动爆炸段前 2 条（兄弟 11:26 拍板 SKIP=2，11:35 拍板去掉归一化）
//   不做 frame0 归一化：frame0 = 物理稳定起点（采样 #2 值），避免裙子等骨从绑定姿态起算导致观感摆幅变大（Xiaye1 pickup 反馈）
const SKIP_HEAD = 2; // 丢弃前 2 条采样（最炸的启动段）
for (const bn of Object.keys(boneEntries)) {
  const fm = boneEntries[bn];
  const cutF = Math.round((SKIP_HEAD - 1) * ANIM_FRAMES / (n - 1)); // 第 SKIP_HEAD 条采样对应的 animF
  for (const k of [...fm.keys()]) if (k <= cutF) fm.delete(k);
}
let physMotionCount = 0;
for (const [bn, frameMap] of Object.entries(boneEntries)) {
  const frames = [...frameMap.keys()].sort((a, b) => a - b);
  // 补帧 0：用第一条采样值（缓存，避免 unshift 后 get 不到）
  if (frames[0] !== 0) {
    const firstQ = frameMap.get(frames[0]);
    if (firstQ) {
      outMotions.push({ boneName: bn, frameNum: 0, position: [0, 0, 0], rotation: [...firstQ], interpolation: new Array(64).fill(0) });
    }
  }
  // 补帧 ANIM_FRAMES：用最后一条采样值
  if (frames[frames.length - 1] !== ANIM_FRAMES) {
    const lastQ = frameMap.get(frames[frames.length - 1]);
    if (lastQ) {
      outMotions.push({ boneName: bn, frameNum: ANIM_FRAMES, position: [0, 0, 0], rotation: [...lastQ], interpolation: new Array(64).fill(0) });
    }
  }
  for (const f of frames) {
    const q = frameMap.get(f);
    if (!q) continue; // 稀疏骨缺帧跳过（不破坏整体）
    outMotions.push({
      boneName: bn,
      frameNum: f,
      position: [0, 0, 0],
      rotation: [...q],
      interpolation: new Array(64).fill(0)
    });
  }
  physMotionCount += frames.length;
}
console.log('物理骨 motions:', physMotionCount);


// ---- 5. LEFT 转换 ----
const toFilePosition = (pp) => [pp[0], pp[1], -pp[2]];
const toFileRotation = (q) => [-q[0], -q[1], q[2], q[3]];
for (const m of outMotions) {
  m.position = toFilePosition(m.position);
  m.rotation = toFileRotation(m.rotation);
}

// ---- 6. 写 VMD + 自检 ----
(async () => {
  const { writeVmd } = await import('./vmd-writer.mjs');
  const morphs = srcVmd.morphs.map(m => ({ morphName: m.morphName, frameNum: m.frameNum, weight: m.weight }));
  const bytes = writeVmd(ANIM + '_bake_view', outMotions, morphs);
  fs.mkdirSync('output', { recursive: true });
  fs.writeFileSync(OUT, bytes);
  console.log('written:', OUT, bytes.length, 'bytes, motions=' + outMotions.length + ' morphs=' + morphs.length);

  const back = p.parseVmd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true);
  const byName = {};
  for (const m of back.motions) {
    if (!byName[m.boneName]) byName[m.boneName] = [];
    byName[m.boneName].push(m);
  }
  const physBones = Object.keys(boneEntries);
  let frame0Ok = true, frameRangeOk = true, missing = [];
  for (const bn of physBones) {
    const ms = byName[bn] || [];
    if (!ms.some(m => m.frameNum === 0)) { frame0Ok = false; missing.push(bn + ':no0'); }
    const fr = ms.map(m => m.frameNum);
    if (Math.min(...fr) !== 0 || Math.max(...fr) !== ANIM_FRAMES) { frameRangeOk = false; missing.push(bn + ':range'); }
  }
  console.log('self-check: 物理骨=' + physBones.length, 'frame0覆盖=' + frame0Ok, '帧范围0..' + ANIM_FRAMES + '=' + frameRangeOk, missing.length ? ('missing: ' + missing.slice(0, 5).join(',')) : '');
})();
