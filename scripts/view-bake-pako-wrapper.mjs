// pako 1.0.11 CJS → ESM wrapper（浏览器 import map 用）
// 时序要求：依赖 <script> 标签先加载 pako（globalThis.pako 存在），仅在浏览器环境使用；
// pako.min.js 已通过 <script> 全局加载，这里只转发命名导出
const pako = globalThis.pako;
if (!pako) throw new Error('pako 未加载：请先 <script src="pako.min.js">');

export const ungzip = pako.ungzip;
export const inflate = pako.inflate;
export const deflate = pako.deflate;
export const gzip = pako.gzip;
export const deflateRaw = pako.deflateRaw;
export const inflateRaw = pako.inflateRaw;
export default pako;
