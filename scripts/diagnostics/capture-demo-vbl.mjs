// capture-demo-vbl.mjs — 用 playwright 驱动 demo(8093)，逐个动画抓 window.__vbl，
// 计算 hair 骨逐物理步摆角（相对首样本），输出 JSON + 文本摘要。
import fs from 'fs';

const pwMod = await import('file:///C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.js');
const pw = pwMod.default || pwMod;

const ANIMS = (process.env.ANIMS || 'keep_stomp,stomp_rub,walk').split(',');
const OUT = process.env.OUT || 'D:/Github/VMDPhysicsBake/scripts/diagnostics/demo-vbl.json';
const BASE = 'http://localhost:8093/';

const quatAngle = (a, b) => {
  let dot = 0;
  for (let i = 0; i < 4; i++) dot += a[i] * b[i];
  dot = Math.max(-1, Math.min(1, dot));
  return (Math.acos(Math.abs(dot)) * 2 * 180) / Math.PI;
};

function analyze(vbl) {
  const hairBones = new Set();
  for (const e of vbl) for (const bn of Object.keys(e.bones || {})) if (/髪|hair/i.test(bn)) hairBones.add(bn);
  const perBone = {};
  for (const bn of hairBones) {
    const q0 = (vbl[0].bones[bn] || {}).q;
    if (!q0) continue;
    perBone[bn] = vbl.map((e) => {
      const q = (e.bones[bn] || {}).q;
      return q ? +quatAngle(q, q0).toFixed(2) : null;
    });
  }
  const n = vbl.length;
  const maxSeries = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const bn of Object.keys(perBone)) { const v = perBone[bn][i]; if (v != null && v > m) m = v; }
    maxSeries.push(+m.toFixed(2));
  }
  const sorted = [...maxSeries].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const peak = maxSeries.length ? Math.max(...maxSeries) : 0;
  // all-physics-bone single-step (angle between consecutive recorded samples) + top bone attribution
  const allBones = Object.keys(vbl[0].bones || {});
  const stepSeries = [];
  const topBone = [];
  for (let i = 1; i < n; i++) {
    let m = 0, tb = '';
    for (const bn of allBones) {
      const qa = (vbl[i - 1].bones[bn] || {}).q, qb = (vbl[i].bones[bn] || {}).q;
      if (!qa || !qb) continue;
      const a = quatAngle(qa, qb);
      if (a > m) { m = a; tb = bn; }
    }
    stepSeries.push(+m.toFixed(2));
    topBone.push(tb);
  }
  return { steps: n, peak, median, head15: maxSeries.slice(0, 15), tail15: maxSeries.slice(-15), perBone,
    allStepHead15: stepSeries.slice(0, 15), allTopBoneHead15: topBone.slice(0, 15) };
}

const browser = await pw.chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const result = { url_base: BASE, anims: {} };

for (const anim of ANIMS) {
  const url = `${BASE}?fixed=60&interval=1&solver=10&warmup=60&speed=10&vmds=${anim}`;
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => {
      const h = document.getElementById('hud');
      return (window.__vbl && window.__vbl.length > 3) || (h && /记录完成/.test(h.textContent || ''));
    }, { timeout: 120000 });
    // 等物理序列稳定收尾
    await page.waitForTimeout(1500);
    const vbl = await page.evaluate(() => (window.__vbl || []).map((e) => ({ frame: e.frame, bones: e.bones })));
    const hud = await page.evaluate(() => (document.getElementById('hud') || {}).textContent || '');
    result.anims[anim] = { ok: true, analysis: analyze(vbl), hudTail: hud.slice(-300), errors: logs.slice(0, 5) };
  } catch (e) {
    const hud = await page.evaluate(() => (document.getElementById('hud') || {}).textContent || '').catch(() => '');
    result.anims[anim] = { ok: false, error: e.message, hudTail: hud.slice(-500), errors: logs.slice(0, 5) };
  } finally {
    await page.close();
  }
}

await browser.close();
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));

for (const [anim, r] of Object.entries(result.anims)) {
  if (!r.ok) { console.log(`\n[${anim}] FAILED: ${r.error}`); continue; }
  const a = r.analysis;
  console.log(`\n[${anim}] steps=${a.steps} peak=${a.peak} median=${a.median}`);
  console.log(`  head15=${JSON.stringify(a.head15)}`);
  console.log(`  tail15=${JSON.stringify(a.tail15)}`);
  console.log(`  hairBones=${Object.keys(a.perBone).join(',')}`);
}
console.log('\nJSON ->', OUT);
