# 架构说明

## 依赖规则

```text
src/index.ts
  -> platform/jlceda-v3/bootstrap
    -> platform/jlceda-v3 adapters
      -> features ports and application services
        -> features domain
```

`src/features` 不得引用全局 `eda` 对象或 `ILIB_*` 类型。所有官方 API 调用必须放在 `src/platform/jlceda-v3` 下。这样可以把 SDK 升级影响限制在平台适配层，并让库存、导入和排序规则能够在 Node.js 环境中执行单元测试。

## 官方基线边界

- `build/` 和 `config/` 继承自官方 SDK 模板。
- `extension.json`、`src/index.ts`、`locales/`、`images/`、README 和 CHANGELOG 由本扩展维护。
- 主机端构建产物继续使用官方模板要求的浏览器 IIFE，名称为 `edaEsbuildExportName`。
- 扩展入口保持为 `./dist/index`。

具体版本见[官方 SDK 基线](official-baseline.md)。

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `features/inventory` | 版本化库存文档、身份归一化、数量规则、重复合并和 CRUD |
| `features/component-catalog` | 与平台无关的 EDA 器件模型查询契约 |
| `features/marketplace-catalog` | 商城证据与导航契约 |
| `features/order-import` | 立创订单 Excel 与 CSV/JSON 解析、表头定位、订单号提取、SHA-256 文件身份、列名别名和数量规则 |
| `features/common-library` | 与平台无关的常用库复制契约 |
| `features/inventory-search` | 精确/部分匹配，以及兼顾相关性与库存状态的排序 |
| `platform/jlceda-v3/eda` | 官方器件库、文件系统、国际化和原理图 API 适配 |
| `platform/jlceda-v3/persistence` | 基于 `SYS_Storage` 的库存仓储实现 |
| `platform/jlceda-v3/iframe` | 编译为自包含资源的独立标准 HTML 表单 |
| `platform/jlceda-v3/presentation` | IFrame 会话协议与适配、原生命令对话框和诊断 |

## 持久化

当前仓储使用既有键 `inventory.v1.document` 保存 schema-v4 文档。schema-v4 在 schema-v3 的用户分类和条目分类引用之外增加订单导入批次历史；批次只保存文件名、订单号、SHA-256 指纹、行数、数量和导入结果，不保存工作簿内容或收件信息。读取 schema-v1/v2/v3 文档时会迁移到 schema-v4，旧分类与条目保持不变，旧文档的批次历史初始化为空，存储键和扩展清单 UUID 均保持不变。

所有用户可见的库存文本都会经过领域层归一化。身份匹配、订单解析和持久化之前会移除不安全的不可见格式字符及控制字符，同时保留换行、制表符和多语言排版需要的 ZWNJ/ZWJ。读取既有 schema-v1/v2 文档时只在内存中迁移和清理文本，不改变条目 ID、数量、revision 或时间戳；后续发生正常写入时，再按通常的 revision 规则保存结果。

库存规则只依赖 `InventoryRepository`，不直接依赖 EDA 存储。当前主存储选择 `SYS_Storage`，因为它无需用户配置路径，并能兼容 Web 与桌面客户端；代价是物理存储位置不透明，而且官方没有承诺跨设备同步、容量和冲突行为。

后续不会直接把本地文件变成第二个可独立修改的主数据源。计划在桌面端增加“指定路径自动备份 + 校验恢复”，继续由 EDA 用户配置承担运行时主存储，避免双主写入造成数据分叉。详细方案见[后续功能路线](roadmap.md)。

## 商城商品与 EDA 模型边界

商城商品信息属于库存身份数据。EDA 器件模型是可选的设计期引用，包含系统库 device UUID 和 library UUID。没有 EDA 模型的商城商品仍可保存、计数、标记用完、导入和参与库存搜索；复制到常用库和在原理图中放置则必须具有模型引用。

无服务器版本会先查询 EDA 系统器件库。模型未命中或查询失败时，才允许打开立创商城官方页面供用户人工核对；手工填写的商品字段不冒充已自动读取的商城证据，订单文件仍可提供订单来源证据。扩展不抓取商城 HTML。LCSC 受支持的商品 API 需要获批凭据、请求签名和 IP 授权，商城页面也没有提供 `SYS_ClientUrl` 所需的跨域策略。未来如增加自动商城适配，必须使用获得授权的集成，且不得在扩展中嵌入共享密钥。

## UI 决策

“按立创 C 编号添加”和“添加自定义元器件”通过 `InventoryCreatePanel` 复用同一套身份、库存、分类、位置和备注表单。EDA 查询、商城导航、重复预览和最终合并由宿主操作处理器执行；浏览器表单只持有草稿和一次性令牌，不持有仓储写权限。正常入口不再串联数量、精度和位置的多个原生弹窗，也不在 IFrame 启动失败时静默切换成另一套输入语义。具体边界见[元器件统一添加表单与窗口层级边界](component-entry-boundary.md)。

分类浏览、主搜索、组合筛选和分页使用长生命周期 `InventoryOverviewPanel`。分类管理在总览 IFrame 内采用左侧一级、右侧二级的模态窗口；详情、完整编辑、删除确认、重复比对和重新匹配 EDA 模型也由同一 DOM 模态栈承载，不依赖 V3 未提供的独立 IFrame 置顶能力。模型重匹配覆盖查询、结果确认、未命中、失败、重试和取消状态。具体交互边界见[库存总览、分类管理与子窗口边界](inventory-overview-boundary.md)。

长会话适配器仍通过 `SYS_Storage` 交换带版本、请求作用域和操作 ID 的信封数据，并由 `SYS_Timer` 轮询请求与响应。普通业务意图不再是关闭 IFrame 的终态；适配器处理后把成功、取消、失败和最新快照返回同一总览会话，只有用户显式关闭总览才清理会话。分类和库存写入继续由应用服务执行 revision 校验，IFrame 不拥有仓储修改权限。详情与编辑优先在同一总览 IFrame 的模态承载层中复用现有模块；宿主并行 IFrame 只能在 Web 和桌面端实测可靠后作为可选实现，不能成为保持总览的必要条件。诊断只记录模式、字段名、长度、操作 ID 和结果类别。

所有较大的业务窗口都遵循“父窗口保持挂载、子窗口位于上方、关闭后恢复父窗口草稿与位置”的通用规则。统一添加表单中的模型确认和重复项比对、完整编辑中的模型建议、库存总览中的详情和分类管理都使用相同的模态栈语义。同一时刻只允许一个活动决策窗口；最终保存前，子流程只更新草稿，不直接写库存主文档。

官方主机构建产物仍是 SDK 兼容的单一 `dist/index.js` IIFE。独立构建步骤会把各浏览器模块编译为 IIFE，并将 CSS 内联到 `iframe/product-details.html`、`iframe/inventory-item.html`、`iframe/inventory-overview.html` 和 `iframe/inventory-create.html`。这些资源均为自包含文件，因此自定义 UI 不会改变官方主机入口配置，也不依赖嵌套资源解析。

## BETA API 隔离

以下官方 API 视为不稳定接口，只能由平台适配层调用：

- `LIB_Device.get/search/getByLcscIds/copy`
- 用于打开官方商城的 `SYS_Window.open`
- 用于商品与库存多字段面板的 `SYS_IFrame`、`SYS_Storage` 和 `SYS_Timer`
- `SYS_FileSystem.openReadFileDialog`
- `SYS_FileSystem.readFileFromFileSystem/saveFileToFileSystem`
- `SCH_PrimitiveComponent.placeComponentWithMouse`

所有相关功能在发布前都必须完成嘉立创 EDA V3 Web 端和桌面端的适用性验证；仅桌面端可用的能力必须提供明确降级行为。
