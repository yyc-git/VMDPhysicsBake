Feature: resample-physics — 物理骨抽帧映射（源 maxFrame 驱动，非硬编码 90）

  Scenario: 短动画 walk（32 帧）抽帧到 0..32 不被拉长
    Given 物理骨记录 64 条（32 帧 × 2 子步）
    And 源 VMD maxFrame 为 32
    When 调用 resamplePhysicsFrames
    Then 输出帧号最小为 0 且最大为 32
    And 输出帧号全部落在 0..32 范围内

  Scenario: 长动画 keep_crawl（120 帧）抽帧到 0..120 不被截断
    Given 物理骨记录 240 条（120 帧 × 2 子步）
    And 源 VMD maxFrame 为 120
    When 调用 resamplePhysicsFrames
    Then 输出帧号最小为 0 且最大为 120
    And 输出包含大于 90 的帧号

  Scenario: pickup（90 帧）抽帧到 0..90 行为不变
    Given 物理骨记录 180 条（90 帧 × 2 子步 = maxFrame × 2）
    And 源 VMD maxFrame 为 90
    When 调用 resamplePhysicsFrames
    Then 输出帧号最小为 0 且最大为 90
    And 输出帧号包含 0 与 90

  Scenario: SKIP_HEAD 删除帧 1（walk 32 帧）
    Given 物理骨记录 64 条（32 帧 × 2 子步）
    And 源 VMD maxFrame 为 32
    When 调用 resamplePhysicsFrames
    Then 输出帧号不包含 1
    And 输出帧号包含 0（SKIP_HEAD 删除后补帧回填）

  Scenario: 补帧 0 的 rotation 等于第一条剩余记录（非单位四元数验证 rotation 语义）
    Given 物理骨记录 64 条且 rotation 为非单位四元数
    And 源 VMD maxFrame 为 32
    When 调用 resamplePhysicsFrames
    Then 帧号 0 的 rotation 与第一条剩余记录一致
    And 帧号 0 的 rotation 非单位四元数（非 recs[0] 的 [0,0,0,1]）

  Scenario: 记录数不足 2 条时返回空数组
    Given 物理骨记录 1 条
    When 调用 resamplePhysicsFrames
    Then 输出为空数组
