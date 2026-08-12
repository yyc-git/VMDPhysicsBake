// 检查 MMM 烘焙版 VMD 中简体中文骨名的原始字节编码
import fs from 'fs';

const buf = fs.readFileSync('D:/Github/GTS-Play/mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd');
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let o = 50;
const motionCount = dv.getUint32(o, true); o += 4;

// 找包含「飾」的 UTF-8 字节序列的骨名（PMX 用简体中文「饰」）
// 饰 UTF-8 = E9 A5 B0
const utf8s = Buffer.from('饰', 'utf8'); // e9 a5 b0
const utf8hou = Buffer.from('后', 'utf8'); // e5 90 8e

// 用 MMDParser 的 CharsetEncoder 解码（Node Buffer 不支持 sjis）
import * as m from 'three/examples/jsm/libs/mmdparser.module.js';
const decoder = new m.MMDParser.CharsetEncoder();
const decSjis = (nb) => {
  const arr = Array.from(nb);
  const trimmed = [];
  for (const x of arr) { if (x === 0) break; trimmed.push(x); }
  let s = '';
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed[i];
    const c = decoder.s2u(code);
    s += c !== undefined && c !== null ? c : '?';
  }
  return s;
};

const results = new Map();
for (let i = 0; i < motionCount; i++) {
  const nb = Buffer.from(buf.slice(o, o + 15));
  const decSJIS = decSjis(nb);
  const decUTF8 = nb.toString('utf8').replace(/\u0000+$/, '');
  // 检查是否含 UTF-8 的「饰」字节
  if (nb.includes(utf8s) || nb.includes(utf8hou)) {
    if (!results.has(decSJIS)) {
      results.set(decSJIS, { hex: nb.toString('hex'), utf8: decUTF8 });
    }
  }
  o += 111;
}
console.log('含简体中文 UTF-8 字节的骨名数:', results.size);
for (const [name, info] of results) {
  console.log('SJIS解码:', JSON.stringify(name), '| UTF8解码:', JSON.stringify(info.utf8), '| hex:', info.hex);
}
