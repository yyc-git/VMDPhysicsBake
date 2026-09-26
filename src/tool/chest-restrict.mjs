// chest-restrict.mjs — 胸部物理限制纯函数（判定来源 + 排除集合），供 bake-physics.mjs 与单测复用。
// 「胸部物理限制」(chestPhysicsRestrict)：启用且（VMD 文件名 或 Sit/Crawl 技能动作名）命中 pattern 时，
// 从物理骨集合中剔除胸骨（骨名命中 胸/乳/breast），使这些骨不烘焙物理。

/**
 * 判定来源：命中返回 'vmd' / 'skill' / 'vmd+skill'，未命中返回 null（enabled=false 直接 null）。
 * skillName 为 v2 补判定（动作名，如 Skill_Giantess_Sit_TightenLeg），缺省 = 仅按文件名。
 * vmdName / skillName 用同一个 vmdPattern（默认 /sit|crawl/i，可被 config 覆盖）。
 */
export function chestRestrictSource({ enabled, vmdName = '', skillName = '', vmdPattern = 'sit|crawl' }) {
  if (!enabled) return null;
  const re = new RegExp(vmdPattern, 'i');
  const byVmd = vmdName ? re.test(vmdName) : false;
  const bySkill = skillName ? re.test(skillName) : false;
  if (byVmd && bySkill) return 'vmd+skill';
  if (byVmd) return 'vmd';
  if (bySkill) return 'skill';
  return null;
}

/** 是否对当前 VMD 启用胸部物理限制（skillName 可选，缺省 = 现行为） */
export function isChestRestrictActive(opts) {
  return chestRestrictSource(opts) !== null;
}

/** 从 physicsBoneNames(Set) 中就地剔除命中 bonePattern 的骨，返回被排除的骨名数组 */
export function excludeChestBones(physicsBoneNames, bonePattern = '胸|乳|breast') {
  const re = new RegExp(bonePattern, 'i');
  const excluded = [];
  for (const name of [...physicsBoneNames]) {
    if (re.test(name)) { physicsBoneNames.delete(name); excluded.push(name); }
  }
  return excluded;
}
