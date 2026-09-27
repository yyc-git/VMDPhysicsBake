// 胸部物理限制（chestPhysicsRestrict）纯函数单测。
// 与 bake-physics.steps.ts 一致：通过子进程 helper 运行真实模块，避免 ts->mjs 直连的 babel 互操作问题。
import { execSync } from 'child_process';
import * as path from 'path';

describe('chestPhysicsRestrict 纯函数', () => {
    let facts: any;

    beforeAll(() => {
        const helper = path.resolve(__dirname, '..', 'helpers', 'chest-restrict-check.mjs');
        facts = JSON.parse(execSync(`node "${helper}"`, { encoding: 'utf-8' }).trim());
    });

    test('默认（enabled=false）不启用', () => {
        expect(facts.disabledCrawl).toBe(false);
    });

    test('enabled=true 且 vmd 名命中 sit/crawl（大小写不敏感）时启用', () => {
        expect(facts.enabledCrawl).toBe(true);
        expect(facts.enabledKeepSit).toBe(true);
        expect(facts.enabledWalk).toBe(false);
    });

    test('pick 扩展：Pick 相关 vmd / 动作名同样启用，非 pick vmd 不受影响', () => {
        expect(facts.enabledPickup).toBe(true);
        expect(facts.enabledPickdown).toBe(true);
        expect(facts.enabledKeepPick).toBe(true);
        expect(facts.enabledPickDisabled).toBe(false);
        expect(facts.enabledStandNotPick).toBe(false);
        expect(facts.pickSkillHit).toBe(true);
        expect(facts.pickSourceVmd).toBe('vmd');
        expect(facts.pickSourceSkill).toBe('skill');
        expect(facts.pickSourceNone).toBe(null);
    });

    test('自定义 vmdPattern 可覆盖默认', () => {
        expect(facts.customWalk).toBe(true);
    });

    test('v2：skillName 命中 sit/crawl 动作名时启用（文件名不含 sit/crawl 亦可）', () => {
        expect(facts.skillHit).toBe(true);
        expect(facts.skillMiss).toBe(false);
        expect(facts.skillDisabled).toBe(false);
    });

    test('v2：chestRestrictSource 返回判定来源 vmd/skill/vmd+skill/null', () => {
        expect(facts.sourceVmd).toBe('vmd');
        expect(facts.sourceSkill).toBe('skill');
        expect(facts.sourceBoth).toBe('vmd+skill');
        expect(facts.sourceNone).toBe(null);
    });

    test('excludeChestBones 剔除胸/乳/breast 骨、其余保留并返回被排除列表', () => {
        expect(facts.excluded).toEqual(['breast_L', '左胸', '乳摇', '右胸'].sort());
        expect(facts.remaining).toEqual(['右手首', '头'].sort());
    });
});
