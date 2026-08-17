// pmx-rename-bones.mjs — PMX 骨骼骨名重命名工具
// 2026-08-10 新增：修复超长骨名（>15 字节 SJIS）写不进 VMD 的问题（梅比乌斯 115 个物理骨被过滤）
// 原理：PMX 2.0 顺序布局（无 section 偏移表），骨骼名在每条骨骼记录最前 →
//   只替换 name 字段，englishName 及之后字段字节原样平移 → 后续 sections 整体拷贝 → 无需重算偏移
// 用法：node src/tool/pmx-rename-bones.mjs <输入.pmx> <输出.pmx> [--map <映射JSON>]
//   映射 JSON: {"旧骨名": "新骨名", ...}；缺省用内置规则（Mobius_Bone_C1_→M_ 等）
// 条件触发（Batch B / B2，2026-08-13）：加 --conditional 时，先检测是否有超长骨名
//   （>15 字节 SJIS，或含 SJIS 无法编码字符 → 写不进 VMD）；无 → 跳过（输出=输入，0 改名），
//   有 → 仅对确实写不进 VMD 的骨应用内置映射改名。正常模型（如 Xiaye1）直接跳过。
// 安全性：刚体/约束/Joint 引用 boneIndex（数字）→ 改名不影响物理；纯物理骨（源动画无帧）改名单向安全
// 格式依据：three.js mmdparser.module.js parsePmx（各 section 字节布局逐项核对）
import fs from 'node:fs';
import path from 'node:path';
import { encodeSjis } from './vmd-writer.mjs';
import { MMDParser } from 'three/examples/jsm/libs/mmdparser.module.js';

// ---------- 基础读取 ----------
function readText(buf, pos, enc) {
  // PMX text: 长度字段 = 字节数（UTF-16LE 每字符 2 字节；MMDParser getUnicodeStrings 按字节消费）
  const len = buf.readUInt32LE(pos);
  const start = pos + 4;
  let value;
  if (enc === 0) value = buf.toString('utf16le', start, start + len);
  else value = buf.toString('utf8', start, start + len);
  return { value, next: start + len, start };
}
function encodeText(s, enc) {
  const b = enc === 0 ? Buffer.from(s, 'utf16le') : Buffer.from(s, 'utf8');
  const out = Buffer.alloc(4 + b.length);
  out.writeUInt32LE(b.length, 0); // 字节数
  b.copy(out, 4);
  return out;
}

// ---------- 骨骼记录解析（对照 MMDParser parseBone 逐字段） ----------
function parseBoneRecord(buf, pos, enc, boneIdxSize) {
  const start = pos;
  const name = readText(buf, pos, enc); pos = name.next;
  const enNameFieldStart = pos; // englishName 的 4 字节长度字段起点（改名输出必须保留）
  const enName = readText(buf, pos, enc); pos = enName.next;
  pos += 12; // position vec3
  pos += boneIdxSize; // parentIndex
  pos += 4; // transformationClass u32
  const flag = buf.readUInt16LE(pos); pos += 2;
  if (flag & 0x1) pos += boneIdxSize; else pos += 12; // connectIndex | offsetPosition
  if (flag & (0x100 | 0x200)) pos += boneIdxSize + 4; // grant parentIndex + ratio
  if (flag & 0x400) pos += 12; // fixAxis
  if (flag & 0x800) pos += 24; // localX + localZ
  if (flag & 0x2000) pos += 4; // key u32
  if (flag & 0x20) { // IK
    pos += boneIdxSize; // effector
    pos += 4; // iteration u32
    pos += 4; // maxAngle f32
    const linkCount = buf.readUInt32LE(pos); pos += 4;
    for (let i = 0; i < linkCount; i++) {
      pos += boneIdxSize;
      const al = buf.readUInt8(pos); pos += 1;
      if (al === 1) pos += 24; // lower + upper vec3
    }
  }
  return { start, enNameStart: enNameFieldStart, end: pos, name: name.value };
}

// ---------- 内置映射规则 ----------
// 简体中文骨名 → 日文汉字（SJIS 可编码）：Tda 夏夜1 HMS 等模型骨名用简体中文（发/饰/带/侧/后/头/结/亲/测/试）
// → SJIS 无映射 → 写不进 VMD。替换为日文汉字后 SJIS 可编码（髪/飾/帯/側/後/頭/結/親/測/試）
const CN_TO_JP = {
  '发': '髪', '饰': '飾', '带': '帯', '侧': '側', '后': '後',
  '头': '頭', '结': '結', '亲': '親', '测': '測', '试': '試',
};

function defaultMap(old) {
  // 只处理 Mobius 前缀骨；Headband/Earrings 压缩仅作用于 Mobius 前缀替换后的剩余部分（避免误伤 Bone_Bronya_C9_Earrings_* 等非目标骨）
  if (old.startsWith('Mobius_Bone_C1_')) {
    const n = 'M_' + old.slice('Mobius_Bone_C1_'.length)
      .replace(/Headband/, 'Head')
      .replace(/Earrings/, 'EarR');
    return n !== old ? n : null;
  }
  if (old.startsWith('acs_j_whistle')) {
    return 'whistle' + old.slice('acs_j_whistle'.length);
  }
  // Vanilla 超长 ASCII 物理骨压缩（_yure_hair_*/Skirt*_yure_skirt_h_/BoneRib*_yure_soft_ 等 >15B → 写不进 VMD）
  const vn = vanillaMap(old);
  if (vn) return vn;
  // 简体中文 → 日文汉字（逐字符替换；仅当确有替换时才返回新名）
  if (/[\u4e00-\u9fff]/.test(old)) {
    let n = '';
    for (const ch of old) n += CN_TO_JP[ch] || ch;
    if (n !== old) return shrinkTo15(n);
  }
  return null;
}

// Vanilla 前缀压缩表：较长公共前缀 → 短前缀（逐条 startsWith 匹配，先长后短）
const VANILLA_SUB = [
  ['_yure_hair_h50_', '_yuh50_'],
  ['_yure_hair_soft_', '_yus_'],
  ['_yure_hair_h_', '_yuh_'],
  ['_yure_hair_', '_yuh_'],
  ['_yure_skirt_h_', '_ysk_'],
  ['_yure_hard_', '_yhd_'],
  ['_yure_soft_', '_ysf_'],
  ['BoneRib2L_A_yure_soft_', 'BoneRib2LA_ysf_'],
  ['BoneRib2R_A_yure_soft_', 'BoneRib2RA_ysf_'],
  ['BoneRib2L_B_yure_soft_', 'BoneRib2LB_ysf_'],
  ['BoneRib2R_B_yure_soft_', 'BoneRib2RB_ysf_'],
  ['BoneRibL_yure_soft_', 'BoneRibL_ysf_'],
  ['BoneRibR_yure_soft_', 'BoneRibR_ysf_'],
  ['BoneAho_yure_hard_', 'BoneAho_yhd_'],
  ['KubiB_yure_hard_', 'KubiB_yhd_'],
  ['Apron2_B_yure_hard', 'Apron2B_yhd'],
  ['Apron1_B_yure_hard', 'Apron1B_yhd'],
  ['Skirt', 'Sk'],
];

function vanillaMap(old) {
  for (const [from, to] of VANILLA_SUB) {
    if (old.startsWith(from)) {
      const n = to + old.slice(from.length);
      return n !== old ? shrinkTo15(n) : null;
    }
  }
  return null;
}

// 超长压缩：SJIS 字节 >15 时先去空格，仍超则按 SJIS 字节安全截断（不切半个字符）
function shrinkTo15(name) {
  const sjisBytes = (s) => { try { return encodeSjis(s).length; } catch { return Infinity; } };
  let n = name;
  if (sjisBytes(n) <= 15) return n;
  n = n.replace(/\s+/g, '');
  if (sjisBytes(n) <= 15) return n;
  // 逐字符截断直到 ≤15 字节
  const chars = [...n];
  let acc = '';
  for (const c of chars) {
    if (sjisBytes(acc + c) > 15) break;
    acc += c;
  }
  return acc;
}

// ---------- 主流程 ----------
const args = process.argv.slice(2);
const inFile = args[0], outFile = args[1];
if (!inFile || !outFile) { console.error('usage: node pmx-rename-bones.mjs <in.pmx> <out.pmx> [--map map.json] [--anim-names <vmd目录>] [--conditional]'); process.exit(1); }
const mapIdx = args.indexOf('--map');
const customMap = mapIdx >= 0 ? JSON.parse(fs.readFileSync(args[mapIdx + 1], 'utf8')) : null;
const animNamesIdx = args.indexOf('--anim-names');
const animNamesDir = animNamesIdx >= 0 ? args[animNamesIdx + 1] : null;
const conditional = args.includes('--conditional');

// 收集源动画 VMD 骨名集合（MMDParser parseVmd 自动 SJIS→Unicode 解码；
// 与 bake-from-view.cjs 的 animBoneSet 同源）。改名后新名若命中动画帧名 →
// 该骨会被 bake 判定为动画骨（保留源动画帧）→ 物理丢失 → 预检直接报错
function loadAnimNames(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const names = new Set();
  let count = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.vmd$/i.test(f)) continue;
    const file = path.join(dir, f);
    let parsed;
    try {
      const buf2 = fs.readFileSync(file);
      parsed = new MMDParser.Parser().parseVmd(buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.byteLength), true);
    } catch { continue; }
    for (const m of parsed.motions) { names.add(m.boneName); count++; }
  }
  console.log(`源动画骨名集合: ${names.size} 个唯一骨名（${count} 帧，目录 ${dir}）`);
  return names;
}

const buf = fs.readFileSync(inFile);
if (buf.toString('ascii', 0, 4) !== 'PMX ') { console.error('not a PMX file'); process.exit(1); }
const version = buf.readFloatLE(4);
const enc = buf.readUInt8(9);
const additionalUvNum = buf.readUInt8(10);
const vertexIdxSize = buf.readUInt8(11);
const textureIdxSize = buf.readUInt8(12);
const materialIdxSize = buf.readUInt8(13);
const boneIdxSize = buf.readUInt8(14);
const morphIdxSize = buf.readUInt8(15);
const rbIdxSize = buf.readUInt8(16);

let pos = 17;
// header 4 个 text buffer（modelName/englishModelName/comment/englishComment）
for (let i = 0; i < 4; i++) pos = readText(buf, pos, enc).next;

// 顶点 section
const vCount = buf.readUInt32LE(pos); pos += 4;
for (let i = 0; i < vCount; i++) {
  pos += 12 + 12 + 8 + additionalUvNum * 16; // position/normal/uv/auvs（每个附加 UV = float4 = 16 字节）
  const type = buf.readUInt8(pos); pos += 1;
  if (type === 0) pos += boneIdxSize * 1; // BDEF1
  else if (type === 1) pos += boneIdxSize * 2 + 4; // BDEF2
  else if (type === 2) pos += boneIdxSize * 4 + 16; // BDEF4
  else if (type === 3) pos += boneIdxSize * 2 + 4 + 36; // SDEF
  else if (type === 4) pos += boneIdxSize * 4 + 16; // QDEF
  else throw new Error('unsupported deform type ' + type + ' @vertex ' + i);
  pos += 4; // edgeRatio
}
// 面 section
const fCount = buf.readUInt32LE(pos); pos += 4;
pos += fCount * vertexIdxSize;
// 纹理 section
const tCount = buf.readUInt32LE(pos); pos += 4;
for (let i = 0; i < tCount; i++) pos = readText(buf, pos, enc).next;
// 材质 section
const mCount = buf.readUInt32LE(pos); pos += 4;
for (let i = 0; i < mCount; i++) {
  pos = readText(buf, pos, enc).next; // name
  pos = readText(buf, pos, enc).next; // englishName
  pos += 16 + 12 + 4 + 12 + 1 + 16 + 4; // diffuse/specular/shininess/ambient/flag/edgeColor/edgeSize
  pos += textureIdxSize * 2; // textureIndex + envTextureIndex
  pos += 2; // envFlag + toonFlag
  const toonFlag = buf.readUInt8(pos - 1);
  pos += toonFlag === 0 ? textureIdxSize : 1; // toonIndex
  pos = readText(buf, pos, enc).next; // comment
  pos += 4; // faceCount
}
// 撞名 + 15 字节（SJIS，与 bake-from-view.cjs 的 sjisLenOk 一致）预检
const sjisBytes = (s) => { try { return encodeSjis(s).length; } catch { return Infinity; } };
// 条件触发判定：骨名写不进 VMD = SJIS 字节 >15 或含 SJIS 无法编码字符（encodeSjis 抛错 → Infinity）
const needRename = (name) => sjisBytes(name) > 15;
const boneCount = buf.readUInt32LE(pos); pos += 4;
const bonesStart = pos;
const plans = [];
const used = new Set();
for (let i = 0; i < boneCount; i++) {
  const rec = parseBoneRecord(buf, pos, enc, boneIdxSize);
  let newName = null;
  if (customMap) {
    newName = customMap[rec.name] || null;
  } else if (!conditional || needRename(rec.name)) {
    // 条件模式：仅对确实写不进 VMD 的骨应用内置映射；正常骨名直接跳过
    newName = defaultMap(rec.name);
  }
  const finalName = newName && newName !== rec.name ? newName : rec.name;
  if (used.has(finalName)) throw new Error(`撞名: ${finalName} (bone ${i})`);
  used.add(finalName);
  plans.push({ rec, newName });
  pos = rec.end;
}
// 条件模式：无超长骨名 → 跳过（输出=输入，0 改名）
const renameCount = plans.filter((p) => p.newName && p.newName !== p.rec.name).length;
if (conditional && renameCount === 0) {
  fs.copyFileSync(inFile, outFile);
  console.log(`条件触发: 未检测到超长骨名（>15 字节 SJIS，写不进 VMD），跳过重命名，改名=0 → ${outFile}`);
  process.exit(0);
}
for (const p of plans) {
  if (!p.newName) continue;
  const bytes = sjisBytes(p.newName);
  if (bytes > 15) throw new Error(`改名后仍超 15 字节(SJIS): ${p.newName} (${bytes}B)`);
}
// --anim-names 预检：改名后新名若命中源动画帧名 → 该骨会被 bake 当动画骨 → 物理丢失
const animNames = loadAnimNames(animNamesDir);
if (animNames) {
  const hits = plans.filter(p => p.newName && animNames.has(p.newName));
  if (hits.length) {
    throw new Error(`改名后撞源动画帧名 ${hits.length} 个（会被 bake 当动画骨导致物理丢失）: ${hits.slice(0, 5).map(p => p.rec.name + '→' + p.newName).join(' | ')}`);
  }
  console.log(`动画帧名碰撞预检: 0 冲突 ✅`);
}
const outChunks = [buf.subarray(0, bonesStart)];
let renamed = 0;
for (const p of plans) {
  if (p.newName) {
    outChunks.push(encodeText(p.newName, enc));
    outChunks.push(buf.subarray(p.rec.enNameStart, p.rec.end));
    renamed++;
  } else {
    outChunks.push(buf.subarray(p.rec.start, p.rec.end));
  }
}
// 骨骼 section 之后的全部内容（morphs/frames/rigidbodies/constraints/尾部）不被修改 → 整体原样拷贝
outChunks.push(buf.subarray(pos));

const out = Buffer.concat(outChunks);
fs.writeFileSync(outFile, out);
console.log(`PMX ${version} enc=${enc === 0 ? 'UTF-16LE' : 'UTF-8'} bones=${boneCount} 改名=${renamed} → ${outFile} (${out.length} bytes)`);
