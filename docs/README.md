# 项目文档

本目录收录开发入口、项目架构、数据格式、产品决策和验证记录。代码标识符、API 名称、协议字段和必须保持准确的官方术语保留英文。

## 开发入口

- [开发指南](开发指南.md)：中文开发入口，包含环境准备、验证命令、构建产物、工程边界、测试和商城发布检查。
- [Development Guide](development-guide.md)：English development entry covering setup, validation, architecture boundaries, testing, and release checks.
- [官方 SDK 基线](official-baseline.md)：模板版本、工具链基线和升级流程。

## 架构与设计

- [架构说明](architecture.md)：模块边界、持久化、UI 决策和 BETA API 隔离。
- [库存总览、分类管理与子窗口边界](inventory-overview-boundary.md)：常驻总览、双栏分类管理、详情、编辑、已取消模型重匹配边界以及长会话协议。
- [元器件统一添加表单与窗口层级边界](component-entry-boundary.md)：按 C 编号与自定义添加统一为一次性多字段表单，以及父窗口和上层小窗口的交互规则。
- [EDA 分类导入与菜单边界](eda-category-import-and-entry.md)：个人库/收藏库分类导入的 API 限制、降级读取边界和菜单边界。
- [本地器件模型接入能力](local-device-model-integration.md)：EDA 现有器件引用与插件外部库候选路线、官方 API 边界和实机准入门槛。
- [库存总览“相关性”排序待决策记录](relevance-sorting-decision.md)：当前临时规则、待确认的产品问题、候选方向和验收样例。

## 数据格式

- [订单导入格式](order-import-format.md)：立创订单 Excel、CSV/JSON、批量预览、订单防重复和批次记录。

## 测试与规划

- [手动测试指南](手动测试指南.md)：按 W0、P0、F0-F3、F5-F9 整理的宿主实际操作步骤、测试数据和预期结果，以及 F4 无需测试的最终结论。
- [跨设备验证清单](cross-device-validation.md)：EDA 用户配置在 Web、桌面端和多设备间的验证矩阵。
- [可靠性路线](roadmap.md)：已实现的本地自动备份与恢复边界，以及仍待完成的跨设备验证方向。
- [插件功能调研与实现状态](插件功能调研.md)：相似插件调研、F1-F9 已采用规格、明确限制、风险边界和实机验收顺序。
