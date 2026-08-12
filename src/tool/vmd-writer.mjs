// vmd-writer.mjs
// VMD 纯写出层：SJIS 编码（Unicode→SJIS）+ 二进制写出 + 骨名 SJIS 往返自检。
// 从 generate-vmd.mjs 原样抽出（纯抽取，逻辑一字不动），供 generate-vmd.mjs /
// vmd-motion-builder.mjs 等生成/改造层复用。
//
// 坐标系说明: VMD 文件内存储 MMD 原生（左手系）值，本层只负责编码与写出，
// 不做任何坐标变换（左右镜像、右手系转换均由上层处理）。

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mmdParserMod = require('three/examples/jsm/libs/mmdparser.module.js');

const CharsetEncoder = mmdParserMod.CharsetEncoder;

// ---------------------------------------------------------------
// 1. SJIS 编码（Unicode → SJIS），由解析器的 s2uTable 反查得到
// ---------------------------------------------------------------
const s2uTable = CharsetEncoder.prototype.s2uTable;

const sjisReverse = new Map(); // charCode -> bytes[]
for (const [k, v] of Object.entries(s2uTable)) {
  const key = Number(k);
  const val = Number(v);
  let bytes;
  if (key <= 0x7e || (key >= 0xa1 && key <= 0xdf)) {
    bytes = [key];
  } else {
    bytes = [(key >> 8) & 0xff, key & 0xff];
  }
  if (!sjisReverse.has(val)) {
    sjisReverse.set(val, bytes);
  } else {
    // 优先单字节（ASCII 用单字节，日文骨名是双字节，互不冲突）
    if (sjisReverse.get(val).length > 1 && bytes.length === 1) sjisReverse.set(val, bytes);
  }
}

function buildSjisEncoder() {
  return (str) => {
    const out = [];
    for (const ch of str) {
      const code = ch.codePointAt(0);
      const bytes = sjisReverse.get(code);
      if (!bytes) throw new Error(`no SJIS mapping for char U+${code.toString(16)} (${ch})`);
      out.push(...bytes);
    }
    return Uint8Array.from(out);
  };
}

const encodeSjis = buildSjisEncoder();

// 宽容编码：无法映射到 JIS X 0208 的字符替换为 '?'(0x3F)
// （简化汉字如 发/饰/侧/头 无 SJIS 映射，游戏烘焙 VMD 亦用 0x3F 占位，见 vmd_bake_physics/pickup.vmd）
function sanitizeSjis(str) {
  const out = [];
  for (const ch of str) {
    const code = ch.codePointAt(0);
    const bytes = sjisReverse.get(code);
    if (!bytes) out.push(0x3f);
    else out.push(...bytes);
  }
  return Uint8Array.from(out);
}

// 自检：所有要写的骨名都能 SJIS 往返（编码→解码 一致）
function sjisRoundTripOK(name, encFn, decoder) {
  const enc = encFn(name);
  const dec = decoder.s2u(enc);
  return dec === name;
}

// ---------------------------------------------------------------
// 2. 二进制写出（与 MMDParser.parseVmd 读取结构一致，little-endian）
//    布局: magic(30) + name(20) + motionCount(u32) + motions[] + morphCount(u32) + morphs[] + cameraCount(u32)
//    morph: morphName(15B SJIS) + frameNum(u32) + weight(f32) = 23B
// ---------------------------------------------------------------
function writeVmd(nameStr, motions, morphs = []) {
  const MAGIC = 'Vocaloid Motion Data 0002';
  const HEADER = 50; // 30 magic + 20 name
  const MOTION = 15 + 4 + 12 + 16 + 64; // 111
  const MORPH = 15 + 4 + 4; // 23
  const total = HEADER + 4 + motions.length * MOTION + 4 + morphs.length * MORPH + 4;
  const arr = new Uint8Array(total);
  const dv = new DataView(arr.buffer);
  let o = 0;

  // magic
  for (let i = 0; i < MAGIC.length; i++) arr[o + i] = MAGIC.charCodeAt(i);
  o = 30;

  // name
  const nameBytes = encodeSjis(nameStr);
  for (let i = 0; i < 20; i++) arr[o + i] = i < nameBytes.length ? nameBytes[i] : 0;
  o += 20;

  // motionCount
  dv.setUint32(o, motions.length, true);
  o += 4;

  for (const m of motions) {
    const nb = encodeSjis(m.boneName);
    for (let i = 0; i < 15; i++) arr[o + i] = i < nb.length ? nb[i] : 0;
    o += 15;
    dv.setUint32(o, m.frameNum, true);
    o += 4;
    for (let i = 0; i < 3; i++) {
      dv.setFloat32(o, m.position[i], true);
      o += 4;
    }
    for (let i = 0; i < 4; i++) {
      dv.setFloat32(o, m.rotation[i], true);
      o += 4;
    }
    for (let i = 0; i < 64; i++) arr[o + i] = m.interpolation[i] || 0;
    o += 64;
  }

  // morphCount
  dv.setUint32(o, morphs.length, true);
  o += 4;

  // morphs（可选，向后兼容：不传则写出 0 条，与旧版行为一致）
  for (const m of morphs) {
    const mb = encodeSjis(m.morphName);
    for (let i = 0; i < 15; i++) arr[o + i] = i < mb.length ? mb[i] : 0;
    o += 15;
    dv.setUint32(o, m.frameNum, true);
    o += 4;
    dv.setFloat32(o, m.weight, true);
    o += 4;
  }

  // cameraCount = 0（解析器无条件读取该字段）
  dv.setUint32(o, 0, true);
  o += 4;

  return arr;
}

export { CharsetEncoder, encodeSjis, sanitizeSjis, sjisRoundTripOK, writeVmd };
