// register-hooks.mjs — 同时注册 resolve-ext（.js 补全）与 pako ESM shim
// 用法：
//   node --import ./src/tool/register-hooks.mjs src/tool/bake-physics.mjs
// ⚠️ 注册时序要求：本 hook 必须在 import 任何 three/examples 模块之前注册——
//   CCDIKSolver 等 three/examples 模块内部为无扩展名 import，依赖 resolve-ext.mjs 的 .js 后缀补全。
//   因此 bake 脚本（bake-physics.mjs 等）必须在模块顶层先 `await import('./register-hooks.mjs')` 再 import three/examples；
//   verify-bake.mjs 的 V6（确定性 rebake）用 `node --import` 提前注册。若在 three 模块已加载后注册，会 ERR_MODULE_NOT_FOUND。
// 说明：lib/MMDAnimationHelper.js 用 webpack 风格无扩展名 import（"./MMDPhysics"、"three/examples/jsm/animation/CCDIKSolver"），
//       lib/MMDLoader.js 用 ESM 命名导入 "pako" 的 ungzip；直接 node 运行会 ERR_MODULE_NOT_FOUND / 缺 named export。
//       本文件在模块加载期注册两个 resolve/load hook，解决这两类问题（不改任何 lib 代码）。
import { register } from 'node:module';

// 解析失败时追加 .js 后缀重试（bake-game 也用）
register('./resolve-ext.mjs', import.meta.url);

// pako ESM shim（提供 ungzip/gzip 等命名导出）
register('./pako-esm-hook.mjs', import.meta.url);
