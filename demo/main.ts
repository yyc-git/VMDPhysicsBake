// demo 可视化烘焙页面 — 独立仓库内 webpack 版（蓝本 view-bake.orig.html 移植）
// import 全部仓库内路径，无外部游戏项目引用
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// @ts-ignore — lib/MMDLoader.js 为无类型 ESM，用 transpileOnly 容忍
import { MMDLoader } from '../lib/MMDLoader.js';
// @ts-ignore
import { MMDAnimationHelper } from '../lib/MMDAnimationHelper.js';
// @ts-ignore — three 自带 mmdparser 无 .d.ts
import { MMDParser } from 'three/examples/jsm/libs/mmdparser.module.js';
import pako from 'pako';

// 游戏侧 MMDLoader 注入（validExpressions 表情过滤 / isUseSimpleMaterial 材质开关），
// 独立仓库无此业务，设 null/false 保持默认行为（null → 跳过过滤保留全部 morph，与 bake-physics 空 morph 一致）
// 全局类型见 src/types/global.d.ts
globalThis.validExpressions = null;
globalThis.isUseSimpleMaterial = false;

// ---- 参数区 ----
// URL 参数覆盖：?fixed=60&interval=1&solver=10&warmup=0&speed=10
//   &pmx=<仓库内相对路径>&char=<别名>&vmds=pickup,idle,walk,run
//   （默认即最高档 interval=1/solver=10；URL 可覆盖）
const qp0 = new URLSearchParams(location.search);
// 动画基目录：dev-server 静态映射 demo/assets → /assets（VMD 默认 assets/pickup.vmd）
const VMD_BASE = '/assets/';
const CFG = {
  // 模型（默认 HMS，可用 ?pmx= 切换人物，仓库内 demo/assets 相对路径）
  pmx: qp0.get('pmx') || '/assets/Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx',
  // 人物别名（用于导出文件名 view-bake-bone-log-<char>-<anim>-*.json）
  char: qp0.get('char') || 'hms',
  // 多动画（逗号分隔，默认 pickup；按顺序逐动画烘焙）
  vmds: (qp0.get('vmds') || 'pickup').split(',').map(s => s.trim()).filter(Boolean),
  // 物理配置（默认最高档 interval=1/solver=10，与 oneclick 一致；URL 可覆盖）
  physicsUpdateInterval: parseInt(qp0.get('interval') || '1', 10),
  solverIterations: parseInt(qp0.get('solver') || '10', 10),
  // warmup（默认 60 = 游戏一致；可覆盖 warmup=0 去掉）
  warmup: parseInt(qp0.get('warmup') || '60', 10),
  // 游戏默认物理参数（MMDAnimationHelper add 默认值对齐）
  unitStep: 1 / 65,
  maxStepNum: 3,
  gravity: new THREE.Vector3(0, -98, 0),
  // ★ 加速倍数：fixed 模式下每渲染帧循环 K 次 helper.update(1/FIXED_FPS)
  //   物理步进序列与 speed=1 逐位一致 → 物理效果逐位相同，墙钟快 K 倍
  speed: parseFloat(qp0.get('speed') || '1'),
  autoPlay: true
};

const hud = document.getElementById('hud') as HTMLElement;
const msg = document.getElementById('msg') as HTMLElement;
const container = document.getElementById('container') as HTMLElement;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x444466);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 40, 120);
camera.lookAt(0, 30, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 30, 0);
controls.update();

// 灯光（MMD 卡通材质需要）
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(50, 100, 80);
scene.add(dirLight);
const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
dirLight2.position.set(-50, 60, -60);
scene.add(dirLight2);

// 地面参考网格
const grid = new THREE.GridHelper(200, 20, 0x888888, 0x555555);
grid.position.y = -0.01;
scene.add(grid);

// ---- 加载 ----
const loader = new MMDLoader();
const helper = new MMDAnimationHelper();
let mesh: THREE.SkinnedMesh | null = null;
let curClip: THREE.AnimationClip | null = null;
let curAnimIdx = 0;
let animDuration = 0;

// 固定步长模式：?fixed=97 → setInterval 按 1/97s 驱动（模拟游戏 97fps，绕开 rAF 60fps 锁）
const qp = new URLSearchParams(location.search);
const FIXED_FPS = parseFloat(qp.get('fixed') || '0');

function load() {
  hud.textContent = '加载 PMX: ' + CFG.pmx + '\n…';
  loader.load(CFG.pmx, (m: THREE.SkinnedMesh) => {
    mesh = m;
    mesh.position.y = 0;
    scene.add(mesh);
    hud.textContent = 'PMX 加载完成: ' + mesh.geometry.attributes.position.count + ' 顶点\n加载动画…';
    loadAnim(0);
  }, undefined, (e: any) => {
    hud.textContent = '加载失败: ' + (e && e.message ? e.message : e);
  });
}

// ---- 多动画：按顺序加载/播放/导出 ----
function loadAnim(idx: number) {
  if (!mesh) return;
  if (idx >= CFG.vmds.length) {
    hud.textContent += '\n\n🎉 全部动画完成 (' + CFG.vmds.length + ' 个)';
    return;
  }
  const animName = CFG.vmds[idx];
  const vmdUrl = VMD_BASE + animName + '.vmd';
  hud.textContent += '\n[' + (idx + 1) + '/' + CFG.vmds.length + '] 加载 VMD: ' + vmdUrl + ' (speed=' + CFG.speed + 'x)…';

  fetch(vmdUrl).then(r => r.arrayBuffer()).then(ab => {
    const parser = new MMDParser.Parser();
    const vmd = parser.parseVmd(ab, true);
    const clip = loader.animationBuilder.build(vmd, mesh);
    curClip = clip;
    animDuration = clip.duration;
    hud.textContent += '\nVMD 加载完成: ' + animName + ' ' + clip.tracks.length + ' tracks, duration=' + clip.duration.toFixed(2) + 's' +
      '\n动画帧数(30fps): ' + Math.round(clip.duration * 30) +
      '\n物理: interval=' + CFG.physicsUpdateInterval + ' solver=' + CFG.solverIterations +
      '\nURL: ?fixed=60&interval=1&solver=10&warmup=60&speed=10 → 最高档物理' +
      '\n产物: 播放完自动 POST /api/save-bone-log → output/view-bake-bone-log-' + CFG.char + '-<anim>-<ts>.json（采样）；转 VMD: node src/tool/bake-from-view.cjs <json> → output/' + CFG.char + '_<anim>_view.vmd（默认）' +
      '\n初始化物理(warmup=' + CFG.warmup + ')…';

    // 上一动画若已挂到 helper，先移除（重建 mixer + physics，保证每动画从干净状态开始）
    if (helper.objects.has(mesh)) {
      const disposeClipAndMixerFunc = (c: any, mixer: any) => {
        if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(mesh); }
        if (c && c.tracks) c.tracks.length = 0;
      };
      helper.remove(mesh, disposeClipAndMixerFunc);
    }

    // ---- helper 驱动（游戏同款）：animation 用 [name,clip] 元组 ----
    helper.add(mesh, {
      animation: [[animName, clip]],
      physics: true,
      unitStep: CFG.unitStep,
      maxStepNum: CFG.maxStepNum,
      gravity: CFG.gravity,
      solverIterations: CFG.solverIterations,
      warmup: CFG.warmup,
      physicsUpdateInterval: CFG.physicsUpdateInterval
    } as any);
    helper.configuration.pmxAnimation = true;

    // 物理状态检查
    const obj = helper.objects.get(mesh);
    const physics: any = obj && obj.physics;
    hud.textContent += '\nphysics 创建: ' + (!!physics) +
      (physics ? ' (bodies=' + physics.bodies.length + ' constraints=' + physics.constraints.length + ')' : '');
    if (physics && physics.world && physics.world.getSolverInfo) {
      const si = physics.world.getSolverInfo();
      hud.textContent += '\nsolver iterations(读回): ' + si.get_m_numIterations();
      hud.textContent += '\nphysicsUpdateInterval: ' + physics.physicsUpdateInterval;
    }

    // 重置本动画记录状态
    viewBakeLog = [];
    viewBakeFrame = 0;
    sampleSeq = 0;
    exported = false;

    helper.play(mesh, animName, true);
    hud.textContent += '\n\n▶ 播放 ' + animName + ' — ' + CFG.vmds.length + ' 个动画中的第 ' + (idx + 1) + ' 个';
  }).catch(e => {
    hud.textContent += '\n❌ VMD 加载失败: ' + e.message;
  });
}

// 每物理步进记录 1 条（不按动画帧去重）
// ★ 加速时每渲染帧循环 K 次 stepPhysics → K 条采样；采样密度 = 物理步进数，与 speed 无关
//   物理步进序列（每步 1/60s）与 speed=1 逐位一致 → 采样点相同 → 烘焙结果一致
//   frame = 唯一采样序号（能量法主段判定依赖相邻采样差异，不能用 floor(t*30) 取整——
//   同帧多条采样会分散能量导致主段判不出）
let exported = false;
let sampleSeq = 0;
// 记录状态（模块级，非全局）：纯页面内部状态，无外部脚本读取（FIX-4：__viewBakeLog/__viewBakeFrame 收敛）
let viewBakeLog: any[] = [];
let viewBakeFrame = 0;

function recordPhysicsFrame() {
  const obj = helper.objects.get(mesh!);
  const physics: any = obj && obj.physics;
  if (!physics || !physics.bodies || !physics.bodies.length) return;
  const t = obj.mixer ? obj.mixer.time : 0;
  const entry: any = { meshName: mesh!.name || 'unnamed', frame: sampleSeq++, bones: {} };
  for (const b of physics.bodies) {
    const bn = b.bone && b.bone.name;
    if (bn) entry.bones[bn] = { q: b.bone.quaternion.toArray() };
  }
  viewBakeLog.push(entry);
}

function stepPhysics(dt: number) {
  // ★ 2026-08-10 还原：直接调 helper.update（调试期曾复刻其内部 _animateMesh 逻辑 + 强制
  //   matrixWorld 同步，新旧采样逐位一致证明该改动无影响——matrixWorld 冻结理论已推翻）
  helper.update(dt);
  recordPhysicsFrame();
  tryExportLog();
}

function tryExportLog() {
  if (exported || !mesh || !curClip) return;
  const cur = helper.objects.get(mesh);
  if (!cur || !cur.mixer) return;
  // 播放结束判定：mixer.time 到达 clip.duration - 0.05（各动画时长不同，不硬编码 2.9）
  if (cur.mixer.time < curClip.duration - 0.05) return;
  exported = true;
  const log = viewBakeLog || [];
  const animName = CFG.vmds[curAnimIdx];
  hud.textContent += '\n\n📤 记录完成: ' + log.length + ' 条采样 (' + animName + ')' + (FIXED_FPS ? `（固定${FIXED_FPS}fps × speed${CFG.speed}）` : '（rAF）') + '，导出中…';
  const payload = { entries: log, char: CFG.char, anim: animName, vmdDir: qp0.get('vmdDir') || 'assets', pmx: CFG.pmx };
  fetch('/api/save-bone-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.text()).then(t => {
    hud.textContent += '\n✅ 已导出 ' + animName + ': ' + t;
    // 播放下一个动画（最后一个完成后不再继续）
    curAnimIdx++;
    loadAnim(curAnimIdx);
  }).catch(e => {
    hud.textContent += '\n❌ 导出失败: ' + e.message;
  });
}

// ---- 主循环 ----
// 固定步长模式：setInterval 按 1/FIXED_FPS 驱动物理（headless 下不节流），rAF 只渲染
//   ★ speed=K：每渲染帧循环 K 次 stepPhysics(1/FIXED_FPS)（K 次小步，禁止一次大 dt）
// rAF 模式：与游戏一致 helper.update(delta) 驱动
let fixedTimer: ReturnType<typeof setInterval> | null = null;

function animate() {
  // ★ FIX-3：animate() 可能被多次调用（btnReset → load() → animate()），
  //   若旧 timer 未清会叠加多个 stepPhysics 驱动 → 物理步进翻倍。开头一律先清。
  if (fixedTimer) { clearInterval(fixedTimer); fixedTimer = null; }
  if (FIXED_FPS > 0) {
    const dt = 1 / FIXED_FPS;
    fixedTimer = setInterval(() => {
      if (mesh && playing) {
        for (let i = 0; i < CFG.speed; i++) stepPhysics(dt);
      }
    }, dt * 1000);
    // rAF 仅渲染（不驱动物理，避免双驱动）
    const renderLoop = () => { requestAnimationFrame(renderLoop); if (mesh) renderer.render(scene, camera); };
    renderLoop();
    return;
  }
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  if (mesh && playing) {
    const d = delta * parseFloat((document.getElementById('speed') as HTMLInputElement).value);
    stepPhysics(d);
  }
  if (mesh) {
    renderer.render(scene, camera);
  }
}

let playing = CFG.autoPlay;
const clock = new THREE.Clock();

(document.getElementById('btnPlay') as HTMLButtonElement).onclick = () => {
  playing = !playing;
  msg.textContent = playing ? '播放中' : '已暂停';
};
(document.getElementById('btnReset') as HTMLButtonElement).onclick = () => {
  if (!mesh) return;
  // FIX-3 双保险：reset → load() → animate() 前也清理固定步长 timer，防叠加驱动
  if (fixedTimer) { clearInterval(fixedTimer); fixedTimer = null; }
  // 游戏版 remove 需要 disposeClipAndMixerFunc 回调释放动画资源；验证页直接销毁 mixer + 清空 tracks
  const disposeClipAndMixerFunc = (clip: any, mixer: any) => {
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(mesh); }
    if (clip && clip.tracks) clip.tracks.length = 0;
  };
  helper.remove(mesh, disposeClipAndMixerFunc);
  scene.remove(mesh);
  mesh = null;
  curClip = null;
  curAnimIdx = 0;
  load();
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 等 Ammo 就绪：ammo.wasm.js 是 MODULARIZE 工厂，调用后 Ammo.ready 即模块实例
async function boot() {
  const AmmoGlobal = globalThis.Ammo;
  if (typeof AmmoGlobal === 'undefined') {
    hud.textContent = 'Ammo 加载失败！';
    return;
  }
  let ammoLib = null;
  try {
    if (typeof AmmoGlobal.ready !== 'undefined') {
      ammoLib = await AmmoGlobal.ready;
    } else if (typeof AmmoGlobal === 'function') {
      ammoLib = await AmmoGlobal();
    }
  } catch (e: any) {
    hud.textContent = 'Ammo 初始化失败: ' + e.message;
    return;
  }
  if (ammoLib) globalThis.Ammo = ammoLib; // 替换为实例（MMDPhysics 用全局 Ammo）
  // ★ 烘焙钩子：自定义全量记录（按动画帧，speed 无关）
  //   格式对齐游戏抓取：{ meshName, frame: 动画帧, bones: { 骨名: { q: [...] } } }
  viewBakeLog = [];
  viewBakeFrame = 0;
  load();
  animate();
}

boot();

// pako 引用保留（webpack 依赖解析锚点，MMDLoader 内部使用 ungzip）
void pako;
