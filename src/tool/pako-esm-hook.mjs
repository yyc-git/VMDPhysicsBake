// pako-esm-hook.mjs — resolve/load hook：把 'pako'（CJS 1.x）包装成 ESM wrapper，提供命名导出
// lib/MMDLoader.js 里 `import { ungzip } from "pako"` 依赖它；Node 的 cjs-module-lexer
// 无法静态识别 pako 的 `module.exports = pako` 动态属性，命名导入会缺导出。
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const pakoPath = require.resolve('pako');

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'pako') {
    return { url: pathToFileURL(pakoPath).href + '?esm-shim', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('?esm-shim')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
import pako from ${JSON.stringify(pathToFileURL(pakoPath).href)};
export const ungzip = pako.ungzip;
export const gzip = pako.gzip;
export const inflate = pako.inflate;
export const deflate = pako.deflate;
export default pako;
`
    };
  }
  return nextLoad(url, context);
}
