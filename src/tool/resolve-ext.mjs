// resolve-ext.mjs — ESM resolve hook：失败时追加 .js 后缀重试
// 解决 lib/ 内 webpack 风格的无扩展名 import（"three/examples/jsm/animation/CCDIKSolver"、"./MMDPhysics" 等）。
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && !specifier.endsWith('.js') && !specifier.startsWith('node:') && !specifier.startsWith('file:') && !specifier.startsWith('data:')) {
      try {
        return await nextResolve(specifier + '.js', context);
      } catch (_) { /* 保留原始错误 */ }
    }
    throw e;
  }
}
