// resample-physics.mjs — 物理骨抽帧纯函数（从 bake-physics.mjs 8b 段抽出，v31）
//
// 语义与原版 bake-from-view 抽帧完全一致：
//   - 采样 i → animF = round(i * maxFrame / (N-1))，同 animF 后写覆盖（Map.set 语义）
//   - SKIP_HEAD=2：删除 animF ≤ cutF（cutF = round(1 * maxFrame / (N-1))）
//   - 补帧 0：frames[0] !== 0 时用第一条剩余 rotation 顶 0 帧
//   - 补尾帧：frames 末帧 !== maxFrame 时用最后一条 rotation 顶 maxFrame 帧
//
// 返回值：[{ frameNum, rotation }] 数组，顺序与 bake-physics.mjs 原 8b 段输出一致
//（先补 0、再补 maxFrame、最后全部帧）。maxFrame 由调用方传源 VMD 实际值，
// 不再硬编码 90 —— 修复短动画（<90帧）被拉长、长动画（>90帧）被截断丢帧的问题。

export function resamplePhysicsFrames(recs, maxFrame) {
  const N = recs.length; // 物理步数（如 178）
  if (N < 2) return [];
  const frameMap = new Map();
  for (let i = 0; i < N; i++) {
    const animF = Math.round((i * maxFrame) / (N - 1));
    frameMap.set(animF, recs[i].rotation); // 同 animF 后写覆盖
  }
  const cutF = Math.round(((2 - 1) * maxFrame) / (N - 1)); // SKIP_HEAD=2
  for (const k of [...frameMap.keys()]) if (k <= cutF) frameMap.delete(k);
  const frames = [...frameMap.keys()].sort((a, b) => a - b);
  const out = [];
  if (frames[0] !== 0) {
    const firstQ = frameMap.get(frames[0]);
    if (firstQ) {
      out.push({ frameNum: 0, rotation: [...firstQ] });
    }
  }
  if (frames[frames.length - 1] !== maxFrame) {
    const lastQ = frameMap.get(frames[frames.length - 1]);
    if (lastQ) {
      out.push({ frameNum: maxFrame, rotation: [...lastQ] });
    }
  }
  for (const k of frames) {
    out.push({ frameNum: k, rotation: [...frameMap.get(k)] });
  }
  return out;
}
