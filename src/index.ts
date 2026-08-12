/**
 * vmd-physics-bake — VMD 物理烘焙库入口
 *
 * 核心链路在 src/tool/ 下的独立 CLI 工具（node 直接运行，零游戏项目依赖）：
 *   - bake-physics.mjs：PMX + 动作 VMD → 逐帧烘焙物理骨 VMD（Ammo.js / Bullet）
 *   - verify-bake.mjs：V1-V6 断言 + MMM 粗对比 + verify-report.json
 *
 * 本入口以「CLI 转发」方式暴露同等的编程接口：
 *   import { bakePhysics, verifyBake } from 'vmd-physics-bake'
 * 每个函数内部 spawn 对应 CLI 脚本并返回结构化结果。
 * 完整能力（多档物理参数、zone rules、helperDriver 等）请直接使用 CLI 与 src/tool/bake-config*.json。
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** 包根目录：dist/index.js 上溯 1 级 = 包根 */
function packageRoot(): string {
  return path.resolve(__dirname, '..');
}

function toolScript(name: string): string {
  return path.join(packageRoot(), 'src', 'tool', name);
}

function runNode(script: string, args: string[]): string {
  return execFileSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    cwd: packageRoot(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 与 src/tool/bake-config.json 对应的物理参数结构（常用子集） */
export interface PhysicsParams {
  unitStep?: number;
  maxStepNum?: number;
  gravity?: [number, number, number];
  warmupFrames?: number;
  frameRate?: number;
  springDamping?: number;
  solverIterations?: number;
  springStiffnessScale?: number;
  physicsUpdateInterval?: number;
  equilibriumPoint?: 'all' | 'spring' | 'none';
}

/** 烘焙入口参数（对应 bake-physics.mjs 的 CLI 参数） */
export interface BakeOptions {
  /** 配置文件路径（相对包根或绝对路径；默认 src/tool/bake-config.json） */
  config?: string;
  /** 覆盖 PMX 路径 */
  pmx?: string;
  /** 覆盖原始动作 VMD 路径 */
  vmd?: string;
  /** 覆盖输出 VMD 路径 */
  output?: string;
  /** 仅自检不落盘 */
  selfCheck?: boolean;
}

/** 烘焙结果 */
export interface BakeResult {
  /** 输出 VMD 绝对路径 */
  outputPath: string;
  /** 输出 VMD 字节数 */
  bytes: number;
  /** CLI stdout */
  stdout: string;
}

/** 验证结果（verify-bake.mjs 的 verify-report.json 结构化摘要） */
export interface VerifyResult {
  /** 是否所有断言通过（V1-V6） */
  allPass: boolean;
  /** 各断言结果表 */
  assertions: Record<string, { pass: boolean | null; detail: unknown }>;
  /** 与 MMM 参考的粗对比（informational，不判 FAIL） */
  compareWithMmm: unknown;
  /** 原始报告内容 */
  raw: unknown;
}

const resolveInput = (p: string): string =>
  path.isAbsolute(p) ? p : path.resolve(packageRoot(), p);

/** 运行 bake-physics.mjs 完成离线物理烘焙 */
export function bakePhysics(options: BakeOptions = {}): BakeResult {
  const args: string[] = [];
  if (options.config) args.push('--config', resolveInput(options.config));
  if (options.pmx) args.push('--pmx', resolveInput(options.pmx));
  if (options.vmd) args.push('--vmd', resolveInput(options.vmd));
  if (options.output) args.push('--output', resolveInput(options.output));
  if (options.selfCheck) args.push('--self-check');

  const stdout = runNode(toolScript('bake-physics.mjs'), args);
  const m = stdout.match(/written: (.+?) \((\d+) bytes\)/);
  if (!m) throw new Error(`bake 输出无法解析:\n${stdout}`);
  return { outputPath: m[1], bytes: Number(m[2]), stdout };
}

/** 运行 verify-bake.mjs 对产物做 V1-V6 验证 */
export function verifyBake(options: { config?: string; noRebake?: boolean } = {}): VerifyResult {
  const args: string[] = [];
  if (options.config) args.push('--config', resolveInput(options.config));
  if (options.noRebake) args.push('--no-rebake');

  runNode(toolScript('verify-bake.mjs'), args);

  const reportPath = path.join(packageRoot(), 'output', 'verify-report.json');
  if (!fs.existsSync(reportPath)) throw new Error(`验证报告缺失: ${reportPath}`);
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as {
    assertions: Record<string, { pass: boolean | null; detail: unknown }>;
    compareWithMmm: unknown;
    summary: { allPass: boolean };
  };
  return {
    allPass: raw.summary.allPass,
    assertions: raw.assertions,
    compareWithMmm: raw.compareWithMmm,
    raw,
  };
}

/** 解析 PMX 的物理部件数量（rigidBody / joint / 物理骨数） */
export interface PhysicsCount {
  model: string;
  vertices: number;
  bones: number;
  morphs: number;
  materials: number;
  rigidBodies: number;
  joints: number;
  /** rigidBody type 分布：0(follow) / 1(physics dyn) / 2(physics stat) */
  rigidBodyType: { follow: number; physicsDynamic: number; physicsStatic: number };
}

export function countPhysics(pmxPath: string): PhysicsCount {
  const stdout = runNode(toolScript('count-physics.mjs'), [resolveInput(pmxPath)]);
  const grab = (re: RegExp): number => {
    const m = stdout.match(re);
    return m ? Number(m[1]) : 0;
  };
  return {
    model: stdout.match(/== (.+?) ==/)![1],
    vertices: grab(/vertices=(\d+) /),
    bones: grab(/bones=(\d+) /),
    morphs: grab(/morphs=(\d+) /),
    materials: grab(/materials=(\d+)/),
    rigidBodies: grab(/rigidBodies=(\d+) /),
    joints: grab(/joints=(\d+)/),
    rigidBodyType: {
      follow: grab(/0\(follow\)=(\d+)/),
      physicsDynamic: grab(/1\(physics dyn\)=(\d+)/),
      physicsStatic: grab(/2\(physics stat\)=(\d+)/),
    },
  };
}

export default { bakePhysics, verifyBake, countPhysics };
