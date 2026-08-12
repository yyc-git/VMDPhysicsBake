// 用 CharsetEncoder 正确解码 MMM 烘焙版 VMD 全部骨名，看「后腰/侧腰/十字架」等简体骨名在 MMM 版里是什么
import fs from 'fs';
import * as m from 'three/examples/jsm/libs/mmdparser.module.js';
const Parser = m.MMDParser.Parser;
const parser = new Parser();
const b = fs.readFileSync('D:/Github/GTS-Play/mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd');
const vmd = parser.parseVmd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), true);
const names = [...new Set(vmd.motions.map(x => x.boneName))];
// 找含 腰/饰/发/垂/头/胸/架 的
const hits = names.filter(n => /[腰发垂头胸架亲试吊饰带]/.test(n));
console.log('相关骨名:', hits.length);
hits.forEach(n => console.log('  ', JSON.stringify(n)));
