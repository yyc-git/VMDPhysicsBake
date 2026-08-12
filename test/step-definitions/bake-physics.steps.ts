import { defineFeature, loadFeature } from 'jest-cucumber';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const feature = loadFeature('test/features/bake-physics.feature');

function runHelper(name: string): any {
    const helper = path.resolve(__dirname, '..', 'helpers', name);
    const out = execSync(`node "${helper}"`, { encoding: 'utf-8' });
    return JSON.parse(out.trim());
}

let facts: any;
let report: any;
let config: any;

defineFeature(feature, (test) => {
    test('163 物理骨 position 全 0（fix1 契约）', ({ given, when, then, and }) => {
        given(/^已存在的烘焙产物 output\/pickup_bake\.vmd$/, () => {
            facts = null;
        });
        given(/^源 VMD demo\/assets\/pickup\.vmd$/, () => {
            facts = null;
        });
        when(/^解析烘焙产物与 PMX$/, () => {
            facts = runHelper('bake-check.mjs');
        });
        then(/^物理骨数量为 163$/, () => {
            expect(facts.physicsBoneCount).toBe(163);
            expect(facts.tolerantNameCount).toBe(163);
        });
        and(/^物理骨每骨 91 帧且 position 全为 0$/, () => {
            expect(facts.expectedFrames).toBe(91);
            expect(facts.missingPhysicsBones).toEqual([]);
            expect(facts.wrongFrameCount).toEqual([]);
            expect(facts.physicsPosAllZero).toBe(true);
            expect(facts.physicsContractOK).toBe(true);
        });
    });

    test('动作骨原样保留', ({ given, when, then }) => {
        given(/^已存在的烘焙产物 output\/pickup_bake\.vmd$/, () => {
            facts = null;
        });
        given(/^源 VMD demo\/assets\/pickup\.vmd$/, () => {
            facts = null;
        });
        when(/^对比源 VMD 与烘焙产物的动作骨$/, () => {
            facts = runHelper('bake-check.mjs');
        });
        then(/^动作骨 position\/rotation\/interpolation 与源逐帧一致$/, () => {
            expect(facts.actionChecked).toBeGreaterThan(0);
            expect(facts.missingActionFrames).toBe(0);
            expect(facts.maxPosDiff).toBeLessThanOrEqual(1e-6);
            expect(facts.maxRotDiff).toBeLessThanOrEqual(1e-6);
            expect(facts.interpolationDiffCount).toBe(0);
            expect(facts.actionPreserved).toBe(true);
        });
    });

    test('morph 全部保留', ({ given, then }) => {
        given(/^已存在的烘焙产物 output\/pickup_bake\.vmd$/, () => {
            facts = null;
        });
        given(/^源 VMD demo\/assets\/pickup\.vmd$/, () => {
            facts = null;
        });
        then(/^烘焙产物 morph 数量为 78$/, () => {
            facts = runHelper('bake-check.mjs');
            expect(facts.morphCount).toBe(78);
        });
    });

    test('确定性输出（两次 bake 字节一致）', ({ given, then }) => {
        given(/^已存在的烘焙产物 output\/pickup_bake\.vmd$/, () => {
            facts = null;
        });
        given(/^源 VMD demo\/assets\/pickup\.vmd$/, () => {
            facts = null;
        });
        given(/^源验证报告 output\/verify-report\.json$/, () => {
            report = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../output/verify-report.json'), 'utf-8'));
        });
        then(/^V6 确定性断言 pass 为 true$/, () => {
            expect(report.assertions.V6_deterministic.pass).toBe(true);
            expect(report.assertions.V6_deterministic.detail.bytesEqual).toBe(true);
        });
    });

    test('物理参数写入', ({ given, then, and }) => {
        given(/^已存在的烘焙产物 output\/pickup_bake\.vmd$/, () => {
            facts = null;
        });
        given(/^源 VMD demo\/assets\/pickup\.vmd$/, () => {
            facts = null;
        });
        given(/^src\/tool\/bake-config\.json$/, () => {
            config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/tool/bake-config.json'), 'utf-8'));
        });
        then(/^solverIterations 为 50 且 springStiffnessScale 为 1000$/, () => {
            expect(config.physicsParams.solverIterations).toBe(50);
            expect(config.physicsParams.springStiffnessScale).toBe(1000);
        });
        and(/^springDamping 为 0\.85$/, () => {
            expect(config.physicsParams.springDamping).toBe(0.85);
        });
    });

    test('离线装配复刻 MMDLoader 约束 type 规则（呆毛1 type=1）', ({ given, when, then, and }) => {
        given(/^已存在的烘焙产物 output\/pickup_bake\.vmd$/, () => {
            facts = null;
        });
        given(/^源 VMD demo\/assets\/pickup\.vmd$/, () => {
            facts = null;
        });
        when(/^读取离线装配参数 dump$/, () => {
            facts = runHelper('bake-assembly-check.mjs');
        });
        then(/^呆毛1 刚体 type 为 1$/, () => {
            expect(facts.ahoge1Index).toBe(48);
            expect(facts.ahoge1Type).toBe(1);
            expect(facts.ahoge1RawType).toBe(2);
        });
        and(/^其余 490 个刚体 type 与原始 PMX 一致$/, () => {
            expect(facts.totalRigidBodies).toBe(491);
            expect(facts.typeDiffCount).toBe(1);
            expect(facts.typeDiffNames).toEqual(['呆毛1']);
        });
    });
});
