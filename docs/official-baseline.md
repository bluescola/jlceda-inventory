# 官方 SDK 基线

本仓库从官方 `easyeda/pro-api-sdk` 模板起步，并始终把官方构建/打包布局与功能代码分开维护。

| 项目 | 基线 |
| --- | --- |
| 模板提交 | `3cbb4005f9293e7df2baea93de132b6945a8f641` |
| 模板版本 | `1.3.2` |
| `@jlceda/pro-api-types` | `0.3.6` |
| EDA 引擎 | `^3.0.0` |
| Node.js | `>=20.17.0` |
| 主机构建格式 | 浏览器 IIFE，`edaEsbuildExportName` |
| 扩展入口 | `./dist/index` |

官方类型包同时包含主机声明和 DOM 声明，在完整检查依赖声明时可能发生冲突。`skipLibCheck` 只跳过依赖声明文件的检查，项目源码仍启用严格 TypeScript 检查。

## 升级流程

1. 比较新版官方 `build/`、`config/`、TypeScript、ESLint 和 package 基线。
2. 将构建基线更新与功能改动分开提交。
3. 重新执行所有适配器契约测试，并对全部 BETA API 进行 V3 实机验证。
4. 保持既有 `extension.json` UUID 不变。
5. 执行 `npm run lint`、`npm run typecheck`、`npm test` 和 `npm run build`。
