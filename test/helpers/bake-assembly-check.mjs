// bake-assembly-check.mjs — BDD 辅助：读取离线装配参数 dump，对比 PMX 原始刚体 type
// 断言：呆毛1 type=1（MMDLoader 约束 type 规则复刻），其余 490 个 rb type 与原始 PMX 一致
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { MMDParser } = require('three/examples/jsm/libs/mmdparser.module.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const TOOL_DIR = path.join(PKG, 'src/tool');

const config = JSON.parse(fs.readFileSync(path.join(TOOL_DIR, 'bake-config.json'), 'utf8'));
const resolveFrom = (base, p) => (path.isAbsolute(p) ? p : path.resolve(base, p));
const PMX_PATH = resolveFrom(TOOL_DIR, config.pmx);
const DUMP_PATH = path.join(PKG, 'output', 'bake-params-dump.json');

const readBuf = (p) => {
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

if (!fs.existsSync(DUMP_PATH)) {
  console.log(JSON.stringify({ error: 'dump 缺失: ' + DUMP_PATH }));
  process.exit(1);
}

const parser = new MMDParser.Parser();
const pmx = parser.parsePmx(readBuf(PMX_PATH), true);
const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8'));

const rawTypes = pmx.rigidBodies.map((rb) => rb.type);
const dumpTypes = dump.rigidBodies.map((rb) => rb.type);
const total = dump.rigidBodies.length;
const diffs = [];
for (let i = 0; i < total; i++) {
  if (rawTypes[i] !== dumpTypes[i]) {
    diffs.push({ i, name: dump.rigidBodies[i].name, raw: rawTypes[i], dump: dumpTypes[i] });
  }
}
const ahoge1Idx = dump.rigidBodies.findIndex((r) => r.name === '呆毛1');

console.log(
  JSON.stringify({
    totalRigidBodies: total,
    ahoge1Index: ahoge1Idx,
    ahoge1Type: ahoge1Idx !== -1 ? dump.rigidBodies[ahoge1Idx].type : null,
    ahoge1RawType: ahoge1Idx !== -1 ? rawTypes[ahoge1Idx] : null,
    typeDiffCount: diffs.length,
    typeDiffNames: diffs.map((d) => d.name),
    typeDiffEntries: diffs,
  })
);
