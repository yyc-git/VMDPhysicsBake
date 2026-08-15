import { defineFeature, loadFeature } from 'jest-cucumber';
import { resamplePhysicsFrames } from '../../src/tool/resample-physics.mjs';

const feature = loadFeature('test/features/resample-physics.feature');

function makeRecs(n: number): { frame: number; rotation: number[] }[] {
  return Array.from({ length: n }, (_, i) => ({ frame: i, rotation: [0, 0, 0, 1] }));
}

// 非单位四元数：rotation = [i+1, 0, 0, 1]（norm² = (i+1)²+1 ≠ 1），用于验证补帧/覆盖的 rotation 语义
function makeRecsNonUnit(n: number): { frame: number; rotation: number[] }[] {
  return Array.from({ length: n }, (_, i) => ({ frame: i, rotation: [i + 1, 0, 0, 1] }));
}

let recs: { frame: number; rotation: number[] }[] = [];
let maxFrame = 0;
let out: { frameNum: number; rotation: number[] }[] = [];

defineFeature(feature, (test) => {
  test('短动画 walk（32 帧）抽帧到 0..32 不被拉长', ({ given, and, when, then }) => {
    given(/^物理骨记录 64 条（32 帧 × 2 子步）$/, () => {
      recs = makeRecs(64);
    });
    and(/^源 VMD maxFrame 为 32$/, () => {
      maxFrame = 32;
    });
    when(/^调用 resamplePhysicsFrames$/, () => {
      out = resamplePhysicsFrames(recs, maxFrame);
    });
    then(/^输出帧号最小为 0 且最大为 32$/, () => {
      const frames = out.map((o) => o.frameNum);
      expect(Math.min(...frames)).toBe(0);
      expect(Math.max(...frames)).toBe(32);
    });
    and(/^输出帧号全部落在 0\.\.32 范围内$/, () => {
      const frames = out.map((o) => o.frameNum);
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every((f) => f >= 0 && f <= 32)).toBe(true);
    });
  });

  test('长动画 keep_crawl（120 帧）抽帧到 0..120 不被截断', ({ given, and, when, then }) => {
    given(/^物理骨记录 240 条（120 帧 × 2 子步）$/, () => {
      recs = makeRecs(240);
    });
    and(/^源 VMD maxFrame 为 120$/, () => {
      maxFrame = 120;
    });
    when(/^调用 resamplePhysicsFrames$/, () => {
      out = resamplePhysicsFrames(recs, maxFrame);
    });
    then(/^输出帧号最小为 0 且最大为 120$/, () => {
      const frames = out.map((o) => o.frameNum);
      expect(Math.min(...frames)).toBe(0);
      expect(Math.max(...frames)).toBe(120);
    });
    and(/^输出包含大于 90 的帧号$/, () => {
      const frames = out.map((o) => o.frameNum);
      expect(frames.some((f) => f > 90)).toBe(true);
    });
  });

  test('pickup（90 帧）抽帧到 0..90 行为不变', ({ given, and, when, then }) => {
    given(/^物理骨记录 180 条（90 帧 × 2 子步 = maxFrame × 2）$/, () => {
      recs = makeRecs(180);
    });
    and(/^源 VMD maxFrame 为 90$/, () => {
      maxFrame = 90;
    });
    when(/^调用 resamplePhysicsFrames$/, () => {
      out = resamplePhysicsFrames(recs, maxFrame);
    });
    then(/^输出帧号最小为 0 且最大为 90$/, () => {
      const frames = out.map((o) => o.frameNum);
      expect(Math.min(...frames)).toBe(0);
      expect(Math.max(...frames)).toBe(90);
    });
    and(/^输出帧号包含 0 与 90$/, () => {
      const frames = out.map((o) => o.frameNum);
      expect(frames).toContain(0);
      expect(frames).toContain(90);
    });
  });

  test('SKIP_HEAD 删除帧 1（walk 32 帧）', ({ given, and, when, then }) => {
    given(/^物理骨记录 64 条（32 帧 × 2 子步）$/, () => {
      recs = makeRecs(64);
    });
    and(/^源 VMD maxFrame 为 32$/, () => {
      maxFrame = 32;
    });
    when(/^调用 resamplePhysicsFrames$/, () => {
      out = resamplePhysicsFrames(recs, maxFrame);
    });
    then(/^输出帧号不包含 1$/, () => {
      const frames = out.map((o) => o.frameNum);
      expect(frames).not.toContain(1);
    });
    and(/^输出帧号包含 0（SKIP_HEAD 删除后补帧回填）$/, () => {
      const frames = out.map((o) => o.frameNum);
      expect(frames).toContain(0);
    });
  });

  test('补帧 0 的 rotation 等于第一条剩余记录（非单位四元数验证 rotation 语义）', ({ given, and, when, then }) => {
    given(/^物理骨记录 64 条且 rotation 为非单位四元数$/, () => {
      recs = makeRecsNonUnit(64);
    });
    and(/^源 VMD maxFrame 为 32$/, () => {
      maxFrame = 32;
    });
    when(/^调用 resamplePhysicsFrames$/, () => {
      out = resamplePhysicsFrames(recs, maxFrame);
    });
    then(/^帧号 0 的 rotation 与第一条剩余记录一致$/, () => {
      const f0 = out.find((o) => o.frameNum === 0);
      expect(f0).toBeDefined();
      const firstRemaining = out.find((o) => o.frameNum !== 0);
      expect(firstRemaining).toBeDefined();
      expect(f0!.rotation).toEqual(firstRemaining!.rotation);
    });
    and(/^帧号 0 的 rotation 非单位四元数（非 recs\[0\] 的 \[0,0,0,1\]）$/, () => {
      const f0 = out.find((o) => o.frameNum === 0);
      expect(f0).toBeDefined();
      // 非单位四元数：w² + x² + y² + z² ≠ 1；[0,0,0,1] 为单位四元数（recs[0] 的值）
      const q = f0!.rotation;
      const norm2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
      expect(Math.abs(norm2 - 1)).toBeGreaterThan(0.01);
      expect(f0!.rotation).not.toEqual([0, 0, 0, 1]);
    });
  });

  test('记录数不足 2 条时返回空数组', ({ given, when, then }) => {
    given(/^物理骨记录 1 条$/, () => {
      recs = makeRecs(1);
    });
    when(/^调用 resamplePhysicsFrames$/, () => {
      out = resamplePhysicsFrames(recs, 32);
    });
    then(/^输出为空数组$/, () => {
      expect(Array.isArray(out)).toBe(true);
      expect(out.length).toBe(0);
    });
  });
});
