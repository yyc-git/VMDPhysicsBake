// bake-check.mjs — BDD 辅助：解析烘焙产物 output/pickup_bake.vmd + 源 pickup.vmd + PMX
// 输出 JSON 事实：物理骨数(163)/物理骨 position 全 0/动作骨原样保留/morph 数量(78)
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { MMDParser, CharsetEncoder } = require('three/examples/jsm/libs/mmdparser.module.js');
import { sanitizeSjis } from '../../src/tool/vmd-writer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const TOOL_DIR = path.join(PKG, 'src/tool');

const config = JSON.parse(fs.readFileSync(path.join(TOOL_DIR, 'bake-config.json'), 'utf8'));
const resolveFrom = (base, p) => (path.isAbsolute(p) ? p : path.resolve(base, p));
const PMX_PATH = resolveFrom(TOOL_DIR, config.pmx);
const RAW_PATH = resolveFrom(TOOL_DIR, config.vmdRaw);
const OUT_PATH = resolveFrom(TOOL_DIR, config.output);

const readBuf = (p) => {
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const parser = new MMDParser.Parser();
const decoder = new CharsetEncoder();

const sjisSafeName = (name) =>
  [...name].map((ch) => {
    const b = sanitizeSjis(ch);
    return b.length === 1 && b[0] === 0x3f ? '?' : ch;
  }).join('');

const pmx = parser.parsePmx(readBuf(PMX_PATH), true);
const raw = parser.parseVmd(readBuf(RAW_PATH), true);
const out = parser.parseVmd(readBuf(OUT_PATH), true);

const maxFrame = Math.max(...out.motions.map((m) => m.frameNum));

// 物理骨集合：rigidBody type1/2 && boneIndex!==-1
const physIndices = new Set();
for (const rb of pmx.rigidBodies) {
  if ((rb.type === 1 || rb.type === 2) && rb.boneIndex !== -1) physIndices.add(rb.boneIndex);
}
const physOriginalNames = [...physIndices].map((i) => pmx.bones[i].name);
const physTolerantNames = [...new Set(physOriginalNames.map(sjisSafeName))];
const physNameSet = new Set(physOriginalNames);

const byBone = new Map();
for (const m of out.motions) {
  if (!byBone.has(m.boneName)) byBone.set(m.boneName, []);
  byBone.get(m.boneName).push(m);
}

// fix1 契约：物理骨每骨 (maxFrame+1) 帧、position 全 0
const expectedFrames = maxFrame + 1;
const missing = physTolerantNames.filter((n) => !byBone.has(n));
const wrongFrameCount = physTolerantNames.filter((n) => (byBone.get(n) || []).length !== expectedFrames);
let physicsPosAllZero = true;
let physZeroChecked = 0;
for (const n of physTolerantNames) {
  for (const m of byBone.get(n) || []) {
    physZeroChecked++;
    if (Math.abs(m.position[0]) > 1e-6 || Math.abs(m.position[1]) > 1e-6 || Math.abs(m.position[2]) > 1e-6) physicsPosAllZero = false;
  }
}

// 动作骨原样保留：源非物理帧 → 输出同骨同帧 position/rotation/interpolation 一致
const rawByBone = new Map();
for (const m of raw.motions) {
  if (physNameSet.has(m.boneName)) continue;
  if (!rawByBone.has(m.boneName)) rawByBone.set(m.boneName, new Map());
  rawByBone.get(m.boneName).set(m.frameNum, m);
}
let checked = 0;
let missingAction = 0;
let maxPosDiff = 0;
let maxRotDiff = 0;
let interpDiff = 0;
for (const [boneName, frames] of rawByBone) {
  const outBone = byBone.get(boneName) || [];
  for (const m of frames.values()) {
    checked++;
    const o = outBone.find((x) => x.frameNum === m.frameNum);
    if (!o) {
      missingAction++;
      continue;
    }
    for (let i = 0; i < 3; i++) maxPosDiff = Math.max(maxPosDiff, Math.abs(m.position[i] - o.position[i]));
    for (let i = 0; i < 4; i++) maxRotDiff = Math.max(maxRotDiff, Math.abs(m.rotation[i] - o.rotation[i]));
    const a = m.interpolation || [];
    const b = o.interpolation || [];
    for (let i = 0; i < 64; i++) if ((a[i] || 0) !== (b[i] || 0)) interpDiff++;
  }
}

console.log(
  JSON.stringify({
    parseable: true,
    maxFrame,
    physicsBoneCount: physOriginalNames.length,
    tolerantNameCount: physTolerantNames.length,
    expectedFrames,
    missingPhysicsBones: missing,
    wrongFrameCount: wrongFrameCount,
    physicsPosAllZero,
    physZeroChecked,
    physicsContractOK: missing.length === 0 && wrongFrameCount.length === 0 && physicsPosAllZero,
    actionChecked: checked,
    missingActionFrames: missingAction,
    maxPosDiff,
    maxRotDiff,
    interpolationDiffCount: interpDiff,
    actionPreserved: missingAction === 0 && maxPosDiff <= 1e-6 && maxRotDiff <= 1e-6 && interpDiff === 0,
    morphCount: out.morphs.length,
  })
);
