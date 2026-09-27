// 胸部物理限制（chestPhysicsRestrict）纯函数检测 helper。
// 与 bake-physics.steps.ts 一致：以子进程运行，stdout 输出 JSON 供 jest 断言。
import { isChestRestrictActive, chestRestrictSource, excludeChestBones } from '../../src/tool/chest-restrict.mjs';

const set = new Set(['头', '左胸', '右胸', 'breast_L', '右手首', '乳摇']);
const excluded = excludeChestBones(set);

const facts = {
    disabledCrawl: isChestRestrictActive({ enabled: false, vmdName: 'crawl_beat' }),
    enabledCrawl: isChestRestrictActive({ enabled: true, vmdName: 'crawl_beat' }),
    enabledKeepSit: isChestRestrictActive({ enabled: true, vmdName: 'Keep_Sit' }),
    enabledWalk: isChestRestrictActive({ enabled: true, vmdName: 'walk' }),
    customWalk: isChestRestrictActive({ enabled: true, vmdName: 'walk', vmdPattern: 'walk' }),
    // pick 扩展（2026-09-27）：Pick 相关动画同样移除胸骨物理烘焙
    enabledPickup: isChestRestrictActive({ enabled: true, vmdName: 'pickup' }),
    enabledPickdown: isChestRestrictActive({ enabled: true, vmdName: 'pickdown_fromIdle' }),
    enabledKeepPick: isChestRestrictActive({ enabled: true, vmdName: 'keep_pick' }),
    enabledPickDisabled: isChestRestrictActive({ enabled: false, vmdName: 'pickup' }),
    enabledStandNotPick: isChestRestrictActive({ enabled: true, vmdName: 'stand' }),
    pickSkillHit: isChestRestrictActive({ enabled: true, vmdName: 'shoe', skillName: 'Skill_Giantess_PickupShoe' }),
    pickSourceVmd: chestRestrictSource({ enabled: true, vmdName: 'ub_to_pick' }),
    pickSourceSkill: chestRestrictSource({ enabled: true, vmdName: 'shoe', skillName: 'Skill_Giantess_PickupShoe' }),
    pickSourceNone: chestRestrictSource({ enabled: true, vmdName: 'walk', skillName: 'Skill_Giantess_BreastPress' }),
    // v2：skillName 补判定
    skillHit: isChestRestrictActive({ enabled: true, vmdName: 'tighten_leg', skillName: 'Skill_Giantess_Sit_TightenLeg' }),
    skillMiss: isChestRestrictActive({ enabled: true, vmdName: 'walk', skillName: 'Skill_Giantess_BreastPress' }),
    skillDisabled: isChestRestrictActive({ enabled: false, vmdName: 'walk', skillName: 'Skill_Giantess_Sit_TightenLeg' }),
    sourceVmd: chestRestrictSource({ enabled: true, vmdName: 'crawl_death' }),
    sourceSkill: chestRestrictSource({ enabled: true, vmdName: 'tighten_leg', skillName: 'Skill_Giantess_Sit_TightenLeg' }),
    sourceBoth: chestRestrictSource({ enabled: true, vmdName: 'sit_death', skillName: 'Skill_Giantess_Sit_Death' }),
    sourceNone: chestRestrictSource({ enabled: true, vmdName: 'walk', skillName: 'Skill_Giantess_BreastPress' }),
    excluded: excluded.sort(),
    remaining: [...set].sort(),
};

console.log(JSON.stringify(facts));
