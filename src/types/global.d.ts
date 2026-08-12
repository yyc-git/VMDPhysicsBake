// 全局类型声明（独立仓库：Node 端烘焙工具 + web 可视化页共用）
// Ammo：three.js MMD 模块（lib/MMDPhysics.js 等）依赖全局 Ammo；
//   Node 端 bake 脚本在模块加载期注入 globalThis.Ammo；浏览器端 /ammo/ammo.wasm.js <script> 加载后同名全局。
declare var Ammo: any;

// 游戏侧 MMDLoader 注入钩子（validExpressions 表情过滤 / isUseSimpleMaterial 材质开关）：
//   独立仓库无此业务，demo 页设 null/false 保持默认行为（见 demo/main.ts）。
declare var validExpressions: any;
declare var isUseSimpleMaterial: any;
