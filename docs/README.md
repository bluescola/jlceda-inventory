# 项目文档

本目录收录项目架构、后续路线、验证清单、SDK 基线和数据格式说明。代码标识符、API 名称、协议字段和必须保持准确的官方术语保留英文。

## 文档索引

- [架构说明](architecture.md)：模块边界、持久化、UI 决策和 BETA API 隔离。
- [库存总览、分类管理与子窗口边界](inventory-overview-boundary.md)：已确认的常驻总览、双栏分类管理、详情、编辑与 EDA 模型重匹配子流程以及长会话协议边界。
- [库存总览“相关性”排序待决策记录](relevance-sorting-decision.md)：当前临时规则、待确认的产品问题、候选方向和下一轮验收样例。
- [EDA 分类导入与菜单边界](eda-category-import-and-entry.md)：个人库/收藏库分类导入的 API 限制、降级读取边界，以及保持既有分组菜单的清单边界。
- [元器件统一添加表单与窗口层级边界](component-entry-boundary.md)：按 C 编号与自定义添加统一为一次性多字段表单，以及父窗口和上层小窗口的通用交互规则。
- [后续功能路线](roadmap.md)：本地自动备份、恢复、跨设备验证等后续方向。
- [跨设备验证清单](cross-device-validation.md)：EDA 用户配置在 Web/桌面端和多设备间的验证矩阵。
- [官方 SDK 基线](official-baseline.md)：模板版本、工具链基线和升级流程。
- [订单导入格式](order-import-format.md)：立创订单 Excel、CSV/JSON、批量预览、订单防重复和批次记录。
