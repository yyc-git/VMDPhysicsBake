// bake-view-oneclick.cjs — 一键可视化烘焙（headless 全自动，仓库 demo/assets 单模型/多动画/加速）
// 链路：静态 server（带 /api/save-bone-log）→ headless Chromium 打开 demo 可视化页
//       → 逐动画播放（固定 60fps + interval=1 + solver=10 + warmup=60 + speed=K）
//       → 每动画帧记录物理骨 → 自动导出 JSON（带 char+anim）→ bake-from-view 逐动画生成 VMD
// 用法：
//   node bake-view-oneclick.cjs --vmds pickup --speed 10 --out <输出目录>
//   无参数 = 默认行为：vmds=pickup + speed=10
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..'); // 仓库根（src/tool 上 2 级）
const PORT = 8123;
const SAVE_DIR = path.join(ROOT, 'output');
const ASSET_DIR = path.join(ROOT, 'demo', 'assets');

// ---- 参数解析 ----
function getArg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const CHAR = getArg('char', 'hms'); // 仅作导出文件名标签
const VMDS = getArg('vmds', 'pickup').split(',').map(s => s.trim()).filter(Boolean);
const SPEED = parseFloat(getArg('speed', '10'));
const WARMUP = parseInt(getArg('warmup', '60'), 10); // 物理预热帧数（默认 60；warmup=0 时 frame0=绑定姿态对齐 MMM 金标准）
const OUT_DIR = path.resolve(getArg('out', SAVE_DIR)); // --out 相对路径自动规范化（bake 步骤 cwd=ROOT）
const PMX_OVERRIDE = getArg('pmx', ''); // 覆盖主模型路径（相对仓库根）；空 = 自动扫描 demo/assets

// 扫描 demo/assets 下 .pmx，取主模型（排除 武器/大剑/副件/副本/lite/knife）
const dirPmx = fs.readdirSync(ASSET_DIR).filter(f => /\.pmx$/i.test(f));
const mainPmx = dirPmx.filter(f => !/武器|大剑|副本|lite|knife|166/i.test(f));
const pmxName = (mainPmx.length ? mainPmx : dirPmx).sort()[0];
if (!pmxName) { console.error('未在 demo/assets 下找到 .pmx'); process.exit(1); }
let pmxRel = '/demo/assets/' + encodeURIComponent(pmxName);
if (PMX_OVERRIDE) pmxRel = PMX_OVERRIDE; // --pmx 覆盖：直接用指定 PMX

// URL：fixed 固定步长 + speed 加速 + vmds 多动画 + 仓库内 demo/assets 模型
// warmup 默认 60（头发预下落）；warmup=0 时 frame0=绑定姿态（对齐 MMM 金标准 frame0≈identity）
const PAGE = `http://localhost:${PORT}/demo/view-bake.html?fixed=60&interval=1&solver=10&warmup=${WARMUP}&speed=${SPEED}&char=${encodeURIComponent(CHAR)}&vmds=${encodeURIComponent(VMDS.join(','))}&vmdDir=assets&pmx=${pmxRel}`;

function portAlive() {
  try {
    const out = execSync(`netstat -ano | findstr ":${PORT}.*LISTENING"`, { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch (e) { return false; }
}

async function main() {
  console.log('参数: char=' + CHAR + ' vmds=' + VMDS.join(',') + ' speed=' + SPEED + ' out=' + OUT_DIR);
  console.log('模型: ' + pmxName);

  // 1. 确保 server 在跑
  let serverProc = null;
  if (!portAlive()) {
    console.log('[1/4] 启动静态 server :' + PORT);
    serverProc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'view-bake-server.cjs')], {
      cwd: ROOT, stdio: 'ignore', detached: true
    });
    serverProc.unref(); // 不阻塞主进程退出
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (portAlive()) break;
    }
    if (!portAlive()) { console.error('server 启动失败'); process.exit(1); }
  } else {
    console.log('[1/4] server 已在 :' + PORT);
  }

  // 2. headless 抓取（Playwright），逐动画导出
  console.log('[2/4] headless 抓取物理骨: ' + PAGE);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(PAGE, { waitUntil: 'load', timeout: 30000 });
  // 等所有动画导出完成（HUD 出现「全部动画完成」），最多 60s/动画*动画数
  let hud = '';
  const maxWait = 60 * VMDS.length;
  for (let i = 0; i < maxWait; i++) {
    await page.waitForTimeout(1000);
    hud = await page.textContent('#hud').catch(() => '');
    if (hud.includes('全部动画完成')) break;
    if (i === maxWait - 1) { console.error('抓取超时。HUD:\n' + hud); await browser.close(); process.exit(1); }
  }
  await browser.close();
  console.log('    HUD 摘要: ' + hud.split('\n').filter(l => /记录|导出|完成/.test(l)).join(' | '));
  if (errs.length) console.log('    pageerrors: ' + errs.slice(0, 3).join('; '));

  // 检查是否有 0 采样（模型无物理骨时 recordPhysicsFrame 空转）
  const zeroSampled = /记录完成: 0 条/.test(hud);
  if (zeroSampled) {
    console.error('❌ 模型无物理骨（physics.bodies 为空），无法烘焙物理。');
    if (serverProc) { try { process.kill(-serverProc.pid); } catch (e) {} }
    process.exit(1);
  }

  // 3. 找到本次 char 的抓取 JSON（每个动画一个；按修改时间只取最近 VMDS.length 个，避免旧残留）
  const prefix = 'view-bake-bone-log-' + CHAR + '-';
  let logs = fs.readdirSync(SAVE_DIR).filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .map(f => ({ f, t: fs.statSync(path.join(SAVE_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, VMDS.length)
    .map(x => x.f)
    .sort();
  console.log('[3/4] 本次抓取数据: ' + logs.length + ' 个');
  if (!logs.length) { console.error('未找到抓取 JSON'); process.exit(1); }

  // 4. 逐动画生成 VMD → out/<char>_<anim>_view.vmd
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of logs) {
    const mAnim = f.match(/^view-bake-bone-log-([^-]+)-([^-]+)-[\dTZ-]+\.json$/);
    const anim = mAnim ? mAnim[2] : 'pickup';  // mAnim[1]=char, mAnim[2]=anim
    const capture = path.join(SAVE_DIR, f);
    const outVmd = path.join(OUT_DIR, `${CHAR}_${anim}_view.vmd`);
    console.log(`[4/4] 生成 VMD ${anim} → ${outVmd}`);
    const r = execSync(`node "${path.join(__dirname, 'bake-from-view.cjs')}" "${capture}" "${outVmd}"`, {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    console.log(r.split('\n').filter(l => /written|物理骨|动画骨|self-check/.test(l)).join('\n'));
  }

  console.log('\n✅ 完成: ' + logs.length + ' 个 VMD → ' + OUT_DIR);
  if (serverProc) { try { process.kill(-serverProc.pid); } catch (e) {} }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
