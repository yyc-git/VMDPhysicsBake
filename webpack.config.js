// webpack 打包 demo 可视化烘焙页面（独立仓库内，无外部游戏项目路径）
const path = require('path');

const ROOT = __dirname;

module.exports = {
  mode: 'development',
  devtool: 'source-map',
  entry: './demo/main.ts',
  output: {
    path: path.resolve(ROOT, 'dist-demo'),
    filename: 'bundle.js',
    publicPath: '/'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: { transpileOnly: true }
        }
      }
    ]
  },
  devServer: {
    port: 8093,
    open: false,
    static: [
      {
        // 仓库 demo 目录 → 根路径：让 index.html 与 /assets/* (PMX/VMD) 可访问
        directory: path.resolve(ROOT, 'demo'),
        publicPath: '/'
      },
      {
        // lib/ammo → /ammo：ammo.wasm.js + ammo.wasm.wasm 同目录可访问
        directory: path.resolve(ROOT, 'lib', 'ammo'),
        publicPath: '/ammo'
      }
    ]
  }
};
