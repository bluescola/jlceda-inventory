# 嘉立创 EDA 个人元器件库存

面向嘉立创 EDA 专业版 V3 的个人库存扩展。它用于记录手头元器件、从嘉立创器件库补全 C 编号等信息，并在原理图设计时优先使用已有库存。

当前版本为 `0.1.0` 的可安装 MVP。扩展不需要开发者自建服务器；源码、CI 和发行文件放在 GitHub，库存写入嘉立创 EDA 的扩展用户配置。

## 已实现

- 按立创商城 C 编号查询官方器件库，并保存供应商、厂家型号、封装及库引用。
- 添加自定义元器件，数量支持真实数量、大概数量和未知数量。
- 修改数量、标记已用完、恢复库存和删除记录。
- 将有官方库引用的库存元器件复制到收藏库，失败时自动尝试个人库。
- 按 C 编号、厂家型号和名称进行库存优先推荐。
- 在原理图中选择在库元器件并绑定到鼠标放置。
- 导入 CSV/JSON 订单文件，支持数量、估算类型、是否用完、仓位和重复项策略。
- 导出版本化 JSON 备份。
- 简体中文和英文界面及菜单。

## 同步与服务器

本扩展没有自建后端，也不要求用户配置数据库。库存使用 `SYS_Storage.setExtensionUserConfig()` 保存。

官方文档将其描述为“扩展用户配置”，但没有承诺跨电脑同步、容量、传播延迟或并发冲突规则。因此仓库当前把跨电脑同步标为 **待 V3 双设备验证**，不把它宣传为已经得到官方保证的云数据库。验证步骤见 [跨设备验证清单](docs/cross-device-validation.md)。在验证完成前，请定期使用“导出库存备份”。

GitHub 只能托管源码、CI 构建和 Release 文件，不能直接充当运行时数据库。

## 安装

1. 从 Release 或 CI 构建产物中取得 `jlceda-inventory_v0.1.0.eext`。
2. 打开嘉立创 EDA 专业版 V3。
3. 进入“高级 -> 扩展管理器 -> 导入”，选择 `.eext` 文件。
4. 从顶部“元器件库存”菜单开始使用。

## 开发

需要 Node.js `>=20.17.0`。

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

打包文件输出到 `build/dist/`。

## 目录

```text
src/
  features/                 纯业务功能，不直接访问 eda
    inventory/              库存模型、规则、仓储端口
    component-catalog/      元器件查询端口
    order-import/           CSV/JSON 订单解析
    common-library/         常用库复制端口
    stock-recommendation/   库存优先排序
  platform/jlceda-v3/       嘉立创专业版 V3 官方 API 适配
    bootstrap/              依赖组装
    eda/                    器件库、文件、国际化、放置等适配器
    persistence/            官方用户配置存储
    presentation/           官方原生对话框工作流
  index.ts                  官方扩展唯一入口
build/                      官方 SDK 打包基线
config/                     官方 SDK esbuild 基线
locales/                    运行时与 extension.json 多语言
tests/                      纯业务单元测试
docs/                       架构、官方基线和验证说明
```

依赖方向和 SDK 升级规则见 [架构说明](docs/architecture.md)，订单列名见 [订单导入格式](docs/order-import-format.md)。

## 当前边界

- 嘉立创目前没有公开的商城订单读取 API，因此订单通过 CSV/JSON 文件导入。
- `LIB_Device`、`LIB_Device.copy()`、文件选择和鼠标放置属于官方 BETA API，已集中隔离在平台层，仍需在浏览器版和客户端实测。
- 官方 iframe 没有公开扩展主运行时通信契约。首版写操作使用官方原生对话框；完整表格 UI 会在通信方案通过 V3 实机验证后接入。
- 鼠标放置成功仅表示元器件已绑定到鼠标，不表示用户完成放置，因此不会自动扣减库存。

## License

[Apache-2.0](LICENSE)
