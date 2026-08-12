#!/usr/bin/env node
// verify-bake.mjs — VMD 物理烘焙验证脚本（V1-V6 断言 + MMM 粗对比 + verify-report.json）
// 独立验证 bake-physics.mjs 产物 output/pickup_bake.vmd，依据 solution.md §5.1/§5.2
// 与 bake-output-contract.json 的验收断言（含单元1修正口径：SJIS 不可编码骨用 0x3F 占位宽容名）。
// 失败态：任一 V1-V6 断言 FAIL → 退出码非 0 + verify-report.json 记录 FAIL；脚本本身不崩溃。
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { MMDParser } from 'three/examples/jsm/libs/mmdparser.module.js';
import { sanitizeSjis, CharsetEncoder } from '../vmd-generator/vmd-writer.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../../../../../../');
const resolveFrom = (base, p) => (path.isAbsolute(p) ? p : path.resolve(base, p));

const MMM_DEFAULT = path.join(PROJECT_ROOT, 'mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/vmd_bake_physics/pickup.vmd');
const PMX_DEFAULT = path.join(PROJECT_ROOT, 'mods/mmd-character-extend/src/asset/Tda 夏夜1 HMS illustrious Prom Dress Ver1.00 [Silver]/Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx');
const VMD_RAW_DEFAULT = path.join(PROJECT_ROOT, 'packages/frontend/src/resource_girl/city/vmd_160/pickup.vmd');

// ---- CLI（--config/--output/--raw/--mmm/--pmx/--no-rebake）----
function parseCli(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--raw') args.raw = argv[++i];
    else if (a === '--mmm') args.mmm = argv[++i];
    else if (a === '--pmx') args.pmx = argv[++i];
    else if (a === '--no-rebake') args.noRebake = true;
  }
  return args;
}
const cli = parseCli(process.argv);

// ---- 路径：从 bake-config.json 读（pmx/vmdRaw/output），缺省用默认值 ----
let config = {};
const configPath = resolveFrom(SCRIPT_DIR, cli.config || 'bake-config.json');
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { config = {}; }

const PMX_PATH = cli.pmx ? resolveFrom(SCRIPT_DIR, cli.pmx) : config.pmx ? resolveFrom(SCRIPT_DIR, config.pmx) : PMX_DEFAULT;
const VMD_RAW_PATH = cli.raw ? resolveFrom(SCRIPT_DIR, cli.raw) : config.vmdRaw ? resolveFrom(SCRIPT_DIR, config.vmdRaw) : VMD_RAW_DEFAULT;
const VMD_OUT_PATH = cli.output ? resolveFrom(SCRIPT_DIR, cli.output) : config.output ? resolveFrom(SCRIPT_DIR, config.output) : path.join(SCRIPT_DIR, 'output', 'pickup_bake.vmd');
const MMM_PATH = cli.mmm ? resolveFrom(SCRIPT_DIR, cli.mmm) : MMM_DEFAULT;
const REPORT_PATH = path.join(path.dirname(VMD_OUT_PATH), 'verify-report.json');

const readBuf = (p) => {
  const buf = fs.readFileSync(p);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const parser = new MMDParser.Parser();
const decoder = new CharsetEncoder();

// 与 bake-physics.mjs 完全一致的宽容名规则（SJIS 不可编码字符 → '?' 0x3F）
const sjisSafeName = (name) =>
  [...name]
    .map((ch) => {
      const bytes = sanitizeSjis(ch);
      return bytes.length === 1 && bytes[0] === 0x3f ? '?' : ch;
    })
    .join('');

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const qDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const angleDeg = (a, b) => {
  const d = Math.abs(qDot(a, b));
  return (2 * Math.acos(Math.min(1, Math.max(0, d)))) * 180 / Math.PI;
};
const maxVecDiff = (a, b) => {
  let m = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) m = Math.max(m, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return m;
};

// 分组工具
const groupByBone = (motions) => {
  const map = new Map();
  for (const m of motions) {
    if (!map.has(m.boneName)) map.set(m.boneName, []);
    map.get(m.boneName).push(m);
  }
  return map;
};
const indexByFrame = (list) => {
  const map = new Map();
  for (const m of list) map.set(m.frameNum, m);
  return map;
};

function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    tool: 'verify-bake.mjs',
    inputFiles: { pmx: PMX_PATH, vmdRaw: VMD_RAW_PATH, outputVmd: VMD_OUT_PATH, mmmVmd: MMM_PATH },
    assertions: {},
    compareWithMmm: {},
    summary: {}
  };
  let anyFail = false;
  const fail = (key, detail) => { anyFail = true; report.assertions[key] = { pass: false, detail }; console.log(`[${key}] FAIL ${JSON.stringify(detail)}`); };
  const pass = (key, detail) => { report.assertions[key] = { pass: true, detail }; console.log(`[${key}] PASS ${JSON.stringify(detail)}`); };

  try {
    console.log('--- verify-bake.mjs 开始 ---');
    console.log(`output: ${VMD_OUT_PATH}`);
    console.log(`raw:    ${VMD_RAW_PATH}`);
    console.log(`mmm:    ${MMM_PATH}`);
    console.log(`pmx:    ${PMX_PATH}`);

    const pmx = parser.parsePmx(readBuf(PMX_PATH), true);
    const vmdRaw = parser.parseVmd(readBuf(VMD_RAW_PATH), true);
    const vmdOut = parser.parseVmd(readBuf(VMD_OUT_PATH), true);
    const vmdMmm = parser.parseVmd(readBuf(MMM_PATH), true);
    console.log(`PMX bones=${pmx.bones.length} rigidBodies=${pmx.rigidBodies.length}`);
    console.log(`raw motions=${vmdRaw.motions.length} morphs=${vmdRaw.morphs.length} maxFrame=${Math.max(...vmdRaw.motions.map(m => m.frameNum))}`);
    console.log(`out motions=${vmdOut.motions.length} distinctBones=${new Set(vmdOut.motions.map(m => m.boneName)).size} morphs=${vmdOut.morphs.length}`);
    console.log(`mmm motions=${vmdMmm.motions.length} distinctBones=${new Set(vmdMmm.motions.map(m => m.boneName)).size}`);

    // ---- 物理骨集合（type 1/2 && boneIndex !== -1）----
    const physIndices = new Set();
    for (const rb of pmx.rigidBodies) if ((rb.type === 1 || rb.type === 2) && rb.boneIndex !== -1) physIndices.add(rb.boneIndex);
    const physOriginalNames = [...physIndices].map(i => pmx.bones[i].name);
    const physTolerantNames = [...new Set(physOriginalNames.map(sjisSafeName))];
    const physNameSet = new Set(physOriginalNames);

    const maxFrame = Math.max(...vmdOut.motions.map(m => m.frameNum));
    const outByBone = groupByBone(vmdOut.motions);
    const rawByBone = groupByBone(vmdRaw.motions);
    const mmmByBone = groupByBone(vmdMmm.motions);
    const outNameSet = new Set(vmdOut.motions.map(m => m.boneName));

    // ================= V1 物理骨集合覆盖 =================
    {
      const expectedFrames = maxFrame + 1;
      const missing = physTolerantNames.filter(n => !outNameSet.has(n));
      const wrongFrameCount = physTolerantNames.filter(n => (outByBone.get(n) || []).length !== expectedFrames);
      const ok = missing.length === 0 && wrongFrameCount.length === 0 && physTolerantNames.length === physOriginalNames.length;
      const detail = {
        physicsBoneCount: physOriginalNames.length,
        tolerantNameCount: physTolerantNames.length,
        expectedFramesPerBone: expectedFrames,
        missing, wrongFrameCount
      };
      if (ok) pass('V1_physicsBoneCoverage', detail); else fail('V1_physicsBoneCoverage', detail);
    }

    // ================= V2 帧范围 + 总帧数 =================
    {
      const outOfRange = vmdOut.motions.filter(m => m.frameNum < 0 || m.frameNum > maxFrame);
      // 物理骨冲突规则：原始动作骨中属物理骨的同名关键帧丢弃，仅保留物理逐帧
      const actionMotions = vmdRaw.motions.filter(m => !physNameSet.has(m.boneName));
      const expectedTotal = actionMotions.length + physTolerantNames.length * (maxFrame + 1);
      const totalOk = vmdOut.motions.length === expectedTotal;
      const ok = outOfRange.length === 0 && totalOk;
      const detail = {
        frameRange: [Math.min(...vmdOut.motions.map(m => m.frameNum)), maxFrame],
        totalMotions: vmdOut.motions.length,
        expectedTotal,
        actionMotionsKept: actionMotions.length,
        physicsFrames: physTolerantNames.length * (maxFrame + 1),
        outOfRangeCount: outOfRange.length
      };
      if (ok) pass('V2_frameRangeAndCount', detail); else fail('V2_frameRangeAndCount', detail);
    }

    // ================= V3 动作骨保持（非物理骨）=================
    {
      let checked = 0, missingPairs = 0, maxPosDiff = 0, maxRotDiff = 0, interpDiff = 0;
      for (const m of vmdRaw.motions) {
        if (physNameSet.has(m.boneName)) continue;
        checked++;
        const o = outByBone.get(m.boneName)?.find(x => x.frameNum === m.frameNum);
        if (!o) { missingPairs++; continue; }
        maxPosDiff = Math.max(maxPosDiff, maxVecDiff(m.position, o.position));
        maxRotDiff = Math.max(maxRotDiff, maxVecDiff(m.rotation, o.rotation));
        const a = m.interpolation || [], b = o.interpolation || [];
        for (let i = 0; i < 64; i++) if ((a[i] || 0) !== (b[i] || 0)) { interpDiff++; break; }
      }
      // 非物理动作骨总帧数也应一致（无多余帧）
      const outActionCount = [...outByBone.entries()].reduce((s, [n, list]) => s + (physTolerantNames.includes(n) ? 0 : list.length), 0);
      const ok = missingPairs === 0 && maxPosDiff <= 1e-6 && maxRotDiff <= 1e-6 && interpDiff === 0 && outActionCount === checked;
      const detail = { actionFramesChecked: checked, missingPairs, maxPosDiff, maxRotDiff, interpolationDiffs: interpDiff, outActionFrames: outActionCount };
      if (ok) pass('V3_actionBonePreserved', detail); else fail('V3_actionBonePreserved', detail);
    }

    // ================= V4 可被游戏解析 + SJIS 往返 =================
    {
      // parseVmd 已在 main 开头成功（不抛错即通过），此处再显式校验
      let parseOk = true;
      try { parser.parseVmd(readBuf(VMD_OUT_PATH), true); } catch (e) { parseOk = false; }
      // 宽容口径：与 bake-physics 宽容名一致（SJIS 不可编码字符 → 0x3F 占位），
      // 校验「宽容名」能否 SJIS 往返；不再对原始名用严格 encodeSjis（避免未来出现非 SJIS 字符的非物理骨名时抛异常）
      const sjisFail = [];
      for (const n of outNameSet) {
        const safe = sjisSafeName(n);
        const enc = sanitizeSjis(n);
        let dec;
        try { dec = decoder.s2u(enc); } catch { dec = null; }
        if (dec !== safe) sjisFail.push(n);
      }
      const ok = parseOk && sjisFail.length === 0;
      const detail = { parseOk, distinctBoneNames: outNameSet.size, sjisRoundTripFail: sjisFail };
      if (ok) pass('V4_parseableAndSjisRoundTrip', detail); else fail('V4_parseableAndSjisRoundTrip', detail);
    }

    // ================= V5 morph 保留 =================
    {
      const rawM = vmdRaw.morphs.map(m => `${m.morphName}|${m.frameNum}|${m.weight}`);
      const outM = vmdOut.morphs.map(m => `${m.morphName}|${m.frameNum}|${m.weight}`);
      let diffCount = 0;
      for (let i = 0; i < Math.min(rawM.length, outM.length); i++) if (rawM[i] !== outM[i]) diffCount++;
      const ok = vmdOut.morphs.length === vmdRaw.morphs.length && diffCount === 0 && rawM.length === outM.length;
      const detail = { rawMorphCount: vmdRaw.morphs.length, outMorphCount: vmdOut.morphs.length, diffCount };
      if (ok) pass('V5_morphPreserved', detail); else fail('V5_morphPreserved', detail);
    }

    // ================= V6 可复跑确定性 =================
    {
      const origBytes = fs.readFileSync(VMD_OUT_PATH);
      if (cli.noRebake) {
        const detail = { skipped: true, note: '--no-rebake 跳过复跑，仅记录现有输出字节数', origSize: origBytes.length };
        report.assertions.V6_deterministic = { pass: null, detail };
        console.log('[V6] SKIP (--no-rebake)');
      } else {
        const tmpOut = path.join(os.tmpdir(), `pickup_bake_verify_${process.pid}_${Date.now()}.vmd`);
        let ok = false, detail = {}, errMsg = '';
        try {
          const t0 = Date.now();
          const cmd = `node ${JSON.stringify(path.join(SCRIPT_DIR, 'bake-physics.mjs'))} --output ${JSON.stringify(tmpOut)}`;
          execSync(cmd, { cwd: SCRIPT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60 * 1000 });
          const rebakeBytes = fs.readFileSync(tmpOut);
          ok = origBytes.equals(rebakeBytes);
          detail = { bytesEqual: ok, origSize: origBytes.length, rebakeSize: rebakeBytes.length, elapsedMs: Date.now() - t0 };
        } catch (e) {
          errMsg = String(e.message || e).slice(0, 500);
        } finally {
          try { fs.unlinkSync(tmpOut); } catch {}
        }
        if (ok) pass('V6_deterministic', detail); else fail('V6_deterministic', { ...detail, error: errMsg });
      }
    }

    // ================= MMM 粗对比 =================
    {
      const mmmNameSet = new Set(vmdMmm.motions.map(m => m.boneName));
      // 骨骼集合重合率：输出物理骨（宽容名）与 MMM 骨骼集合的交集 / 输出物理骨数
      const overlap = physTolerantNames.filter(n => mmmNameSet.has(n));
      const boneOverlapRate = physTolerantNames.length ? +(overlap.length / physTolerantNames.length).toFixed(4) : 0;

      // 物理骨旋转角差分布：共有骨中间帧 quaternion 点积→夹角（预期 12-86° 量级，不判 FAIL）
      const targetFrame = Math.floor(maxFrame / 2);
      const angles = [];
      for (const n of overlap) {
        const outList = outByBone.get(n) || [];
        const mmmList = mmmByBone.get(n) || [];
        if (!outList.length || !mmmList.length) continue;
        const pick = (list) => list.reduce((best, cur) => Math.abs(cur.frameNum - targetFrame) < Math.abs(best.frameNum - targetFrame) ? cur : best);
        const a = pick(outList), b = pick(mmmList);
        if (Number.isFinite(a.rotation[0]) && Number.isFinite(b.rotation[0])) angles.push(angleDeg(a.rotation, b.rotation));
      }
      const rotationAngleDiff = {
        sampledBones: angles.length,
        targetFrame,
        minDeg: angles.length ? +Math.min(...angles).toFixed(2) : null,
        medianDeg: angles.length ? +median(angles).toFixed(2) : null,
        maxDeg: angles.length ? +Math.max(...angles).toFixed(2) : null
      };

      // 动作骨一致性：MMM 版非物理骨动作骨与原始逐帧 position 对比（maxPosDiff<1e-3，报告引用）
      let checked = 0, maxPosDiff = 0;
      for (const n of mmmNameSet) {
        if (physNameSet.has(n) || !rawByBone.has(n)) continue;
        const rawIdx = indexByFrame(rawByBone.get(n));
        for (const m of mmmByBone.get(n)) {
          const r = rawIdx.get(m.frameNum);
          if (!r) continue;
          checked++;
          maxPosDiff = Math.max(maxPosDiff, maxVecDiff(r.position, m.position));
        }
      }
      const actionBoneConsistency = { actionFramesChecked: checked, maxPosDiff: +maxPosDiff.toExponential(6) };

      report.compareWithMmm = { boneOverlapRate, overlapCount: overlap.length, physicsBoneCount: physTolerantNames.length, rotationAngleDiff, actionBoneConsistency };
      console.log(`[MMM] 重合率=${boneOverlapRate} (${overlap.length}/${physTolerantNames.length})`);
      console.log(`[MMM] 旋转角差分布(deg): min=${rotationAngleDiff.minDeg} median=${rotationAngleDiff.medianDeg} max=${rotationAngleDiff.maxDeg} (样本${angles.length}骨, 中间帧=${targetFrame})`);
      console.log(`[MMM] 动作骨一致性: maxPosDiff=${actionBoneConsistency.maxPosDiff} (${checked} 帧)`);
    }

    // ================= 汇总 =================
    const failed = Object.entries(report.assertions).filter(([, v]) => v.pass === false).map(([k]) => k);
    report.summary = { allPass: !anyFail, failedAssertions: failed };
    if (anyFail) {
      console.log(`\n=== 验证失败: ${failed.join(', ')} ===`);
      process.exitCode = 1;
    } else {
      console.log('\n=== 全部断言 PASS ===');
    }
  } catch (e) {
    // 脚本本身不允许崩溃：任何意外异常优雅记录并 FAIL
    anyFail = true;
    report.summary = { allPass: false, fatalError: String(e && e.stack ? e.stack : e).slice(0, 2000) };
    console.error('verify-bake.mjs 内部异常（非断言失败，属脚本缺陷）:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nreport: ${REPORT_PATH}`);
  return report;
}

main();
