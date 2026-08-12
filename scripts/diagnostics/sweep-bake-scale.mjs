// sweep-bake-scale.mjs — 用真实 bake-physics.mjs 扫描 springStiffnessScale（每次改 config 重跑 bake）
// 临时 config 写在 temp 目录，跑 bake 后读 VMD 前髪１ 起身段角度。
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(SCRIPT_DIR, 'bake-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const parser = new MMDParser.Parser();
const ang = q => 2 * Math.acos(Math.min(1, Math.max(-1, q[3]))) * 180 / Math.PI;
const frames = [38, 40, 42, 44, 46, 48, 50];
const mmmFile = path.resolve(SCRIPT_DIR, '../../../../../../mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd');
const rd = (f) => { const b = fs.readFileSync(f); return parser.parseVmd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), true); };
const mm = rd(mmmFile);
const mmmVals = frames.map(f => { const m = mm.motions.find(x => x.boneName === '前髪１' && x.frameNum === f); return m ? ang(m.rotation) : NaN; });
const MMM_T = { 38: 17, 39: 17, 40: 17, 41: 16, 42: 16, 43: 16, 44: 15, 45: 14, 46: 15, 47: 15, 48: 16, 49: 16, 50: 16 };

for (const scale of [1800, 1900, 1950, 2000, 2050, 2100, 2200]) {
  const cfg = JSON.parse(JSON.stringify(config));
  cfg.physicsParams.solverIterations = 50;
  cfg.physicsParams.springStiffnessScale = scale;
  const tmpConfig = path.join(SCRIPT_DIR, `output/tmp-scale-${scale}.json`);
  fs.writeFileSync(tmpConfig, JSON.stringify(cfg));
  try {
    execSync(`node "${path.join(SCRIPT_DIR, 'bake-physics.mjs')}" --config "${tmpConfig}" --output "${path.join(SCRIPT_DIR, 'output/tmp-scale.vmd')}"`, { stdio: 'ignore' });
  } catch (e) { console.log(`scale=${scale} BAKE FAIL`, e.message.slice(0, 100)); continue; }
  const o = rd(path.join(SCRIPT_DIR, 'output/tmp-scale.vmd'));
  const vals = frames.map(f => { const m = o.motions.find(x => x.boneName === '前髪１' && x.frameNum === f); return m ? ang(m.rotation) : NaN; });
  const err = frames.reduce((s, f, i) => { const a = vals[i]; return s + (Number.isFinite(a) ? Math.abs(a - MMM_T[f]) : 999); }, 0);
  const allUnder40 = vals.every(v => Number.isFinite(v) && v < 40);
  console.log(`scale=${String(scale).padEnd(6)}`, vals.map(v => Number.isFinite(v) ? v.toFixed(0) : '--').join(' '), ` err=${err.toFixed(0)}`, allUnder40 ? '[OK all<40]' : '');
}
