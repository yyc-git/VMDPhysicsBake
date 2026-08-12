const path = require('path');

module.exports = {
    testEnvironment: 'node',
    rootDir: '.',
    testMatch: [
        '<rootDir>/test/step-definitions/**/*.steps.ts',
    ],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: '<rootDir>/tsconfig.json',
                diagnostics: false,
                isolatedModules: true,
            },
        ],
        // three 的 examples/jsm 是 ESM-only，用 babel 转译后才能被 jest 的 CJS 运行时加载
        '^.+\\.js$': ['babel-jest', { configFile: path.join(__dirname, 'babel.config.js') }],
        // .mjs（工具纯函数模块）同样用 babel 转译为 CJS，供 jest 直接 import
        '^.+\\.mjs$': ['babel-jest', { configFile: path.join(__dirname, 'babel.config.js') }],
    },
    // 只对 three 包放行 node_modules 忽略（其余仍忽略），让 mmdparser 等 ESM 模块可解析
    transformIgnorePatterns: ['/node_modules/(?!three/)'],
    verbose: true,
};
