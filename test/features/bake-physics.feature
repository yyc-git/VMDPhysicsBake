Feature: bake-physics — 离线物理烘焙产物契约

  Background:
    Given 已存在的烘焙产物 output/pickup_bake.vmd
    And 源 VMD demo/assets/pickup.vmd

  Scenario: 163 物理骨 position 全 0（fix1 契约）
    When 解析烘焙产物与 PMX
    Then 物理骨数量为 163
    And 物理骨每骨 91 帧且 position 全为 0

  Scenario: 动作骨原样保留
    When 对比源 VMD 与烘焙产物的动作骨
    Then 动作骨 position/rotation/interpolation 与源逐帧一致

  Scenario: morph 全部保留
    Then 烘焙产物 morph 数量为 78

  Scenario: 确定性输出（两次 bake 字节一致）
    Given 源验证报告 output/verify-report.json
    Then V6 确定性断言 pass 为 true

  Scenario: 物理参数写入
    Given src/tool/bake-config.json
    Then solverIterations 为 50 且 springStiffnessScale 为 1000
    And springDamping 为 0.85

  Scenario: 离线装配复刻 MMDLoader 约束 type 规则（呆毛1 type=1）
    When 读取离线装配参数 dump
    Then 呆毛1 刚体 type 为 1
    And 其余 490 个刚体 type 与原始 PMX 一致
