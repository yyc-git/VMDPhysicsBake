// chest-restrict.mjs — 胸部物理限制纯函数（参数解析 + 排除集合），供 bake-physics.mjs 与单测复用。
// 「胸部物理限制」(chestPhysicsRestrict)：启用且 VMD 文件名命中 sit/crawl 时，
// 从物理骨集合中剔除胸骨（骨名命中 胸/乳/breast），使这些骨不烘焙物理。

/** 是否对当前 VMD 启用胸部物理限制（enabled=false 直接 false；vmdName 不含扩展名） */
export function isChestRestrictActive({ enabled, vmdName, vmdPattern = 'sit|crawl' }) {
  if (!enabled) return false;
  return new RegExp(vmdPattern, 'i').test(vmdName);
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
