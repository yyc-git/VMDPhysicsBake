// 可视化烘焙验证 server：静态文件（仓库根）+ /api/save-bone-log 落盘 + 自动转 VMD
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 落盘后自动调用 bake-from-view 生成最终 VMD（子进程隔离，cwd=仓库根，120s 超时）
function bakeView(jsonPath, cb) {
  const child = spawn(process.execPath, ['src/tool/bake-from-view.cjs', jsonPath], {
    cwd: root,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024
  });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', cb);
  child.on('exit', (code, signal) => {
    if (code !== 0) {
      const reason = signal ? 'killed by signal ' + signal + ' (可能超时 120s)' : 'exit code ' + code;
      const detail = (err.trim() + ' ' + out.trim()).split('\n').filter(Boolean).slice(-6).join(' | ');
      cb(new Error(reason + (detail ? ' | ' + detail : '')));
      return;
    }
    cb(null, out);
  });
}

const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.pmx': 'application/octet-stream',
  '.vmd': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.tga': 'application/octet-stream', '.sph': 'text/plain',
  '.spa': 'text/plain', '.wasm': 'application/wasm', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.txt': 'text/plain', '.dds': 'application/octet-stream'
};
const root = path.resolve(__dirname, '..'); // 仓库根（scripts/ 上 1 级）
const SAVE_DIR = path.join(root, 'output');

http.createServer((req, res) => {
  // POST /api/save-bone-log — 保存可视化烘焙抓取数据
  if (req.method === 'POST' && req.url.startsWith('/api/save-bone-log')) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 200e6) req.destroy(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        fs.mkdirSync(SAVE_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        // 文件名带 人物标签-动画名：view-bake-bone-log-<char>-<anim>-<timestamp>.json
        const char = String(data.char || 'hms').replace(/[^\w\u4e00-\u9fa5-]/g, '');
        const anim = String(data.anim || 'pickup').replace(/[^\w\u4e00-\u9fa5-]/g, '');
        const file = path.join(SAVE_DIR, `view-bake-bone-log-${char}-${anim}-${ts}.json`);
        fs.writeFileSync(file, JSON.stringify(data, null, 1), 'utf8');
        const entries = (data.entries || []).length;
        const vmdRel = path.posix.join('output', `${char}_${anim}_view.vmd`);
        // JSON 已落盘（不丢数据），再自动转 VMD；失败返回 500 + stderr 摘要
        bakeView(file, (e) => {
          if (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('bake failed: ' + e.message + ' | json saved: ' + path.basename(file));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, vmd: vmdRel, entries, json: path.basename(file) }));
        });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('save failed: ' + e.message);
      }
    });
    return;
  }

  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/demo/index.html';
  // webpack 产物与静态资源路径映射（demo/index.html 依赖对齐）：
  //  - /bundle.js     → dist-demo/bundle.js（webpack 产物，仓库根无此文件）
  //  - /ammo/*        → lib/ammo/*（ammo.wasm.js + ammo.wasm.wasm）
  //  - /assets/*      → demo/assets/*（VMD 动画，页面按 /assets/<anim>.vmd 拉取）
  if (p === '/bundle.js') p = '/dist-demo/bundle.js';
  else if (p.startsWith('/ammo/')) p = '/lib' + p;
  else if (p.startsWith('/assets/')) p = '/demo' + p;
  const fp0 = path.normalize(path.join(root, p));
  let fp = fp0;
  // fallback: 无扩展名 import → 尝试补 .js / .mjs
  if (!fs.existsSync(fp) && !path.extname(fp)) {
    if (fs.existsSync(fp + '.js')) fp = fp + '.js';
    else if (fs.existsSync(fp + '.mjs')) fp = fp + '.mjs';
  }
  if (!fp.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); res.end('not found: ' + p); return; }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(d);
  });
}).listen(8123, () => console.log('server ok on 8123 (with save API)'));

process.on('uncaughtException', (e) => console.error('server err:', e.message));
