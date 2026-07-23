# 本地器件模型接入能力

## 文档状态

- 调研日期：2026-07-23。
- 当前结论：存在可行的 EDA 器件引用链路和外部库扩展机制，但本工程尚未实现本地器件模型绑定。
- 当前动作：只保留方案和验证门槛，本地模型能力不进入 `0.5.9`；`0.5.9` 仅调整现有库存总览的列顺序，现有功能测试继续进行。
- 实现前置条件：必须先在真实嘉立创 EDA 桌面端完成本文的引用稳定性试验，不能仅凭 TypeScript 类型定义宣布支持。

## 结论

嘉立创 EDA 提供的公开 API 能支持以下候选链路：

1. 从原理图或 PCB 中已经放置的器件读取 `libraryUuid + uuid`。
2. 使用同一组标识通过 `LIB_Device.get()` 回读器件。
3. 将同一组标识传给 `SCH_PrimitiveComponent.placeComponentWithMouse()`，把器件绑定到鼠标。

该链路不要求器件具有 C 编号。C 编号是物料身份信息，`libraryUuid + uuid` 才是 EDA 器件模型引用；个人库、工程库或外部库中的器件都可能有或没有 C 编号。

但官方文档没有承诺 `libraryUuid` 或器件 `uuid` 在客户端重启、切换工作区、切换工程、外部库提供者卸载后仍然有效。因此当前只能得出“同一会话内存在可行调用链”，不能得出“可以把任意本地器件永久绑定到库存”的结论。

对于不在 EDA 系统库、个人库或工程库中的模型，官方还提供 `LIB_LibrariesList.registerExtendLibrary()`。扩展可以注册一个外部库提供者，由提供者返回器件列表、符号/封装载荷和可选 3D 模型索引。调用方不能指定注册后的库 UUID。这个机制可以作为真正本地模型接入的技术候选，但它不是“传入本地文件路径即可绑定”的接口；模型载荷保存、稳定 ID、每次激活时重新注册、失败恢复和跨重启解析都需要由本插件自行完成。

因此后续实现必须分成两种绑定，不能继续统称为“个人库绑定”：

- **EDA 现有器件引用**：器件已经由 EDA 管理，插件只保存并验证引用，不导出、不复制模型。
- **插件外部器件**：器件不属于可稳定引用的 EDA 库，插件托管模型清单和载荷，并在运行时注册外部库提供者。

## 术语边界

| 名称 | 含义 | 是否依赖 C 编号 |
| --- | --- | --- |
| 库存身份 | 名称、厂家型号、C 编号、供应商编号等，用于库存匹配 | 可选 |
| EDA 器件 | EDA 中由符号、封装、可选 3D 模型和属性组成的完整 device | 否 |
| EDA 现有器件引用 | `libraryUuid + deviceUuid`，指向 EDA 已能解析的 device | 否 |
| 插件外部器件 | 由本插件注册外部库并提供模型载荷的 device | 否 |
| 符号引用 | `libraryUuid + symbolUuid`，只表示符号，不等同于完整器件 | 否 |

“无 C 编号”不能作为进入本地模型绑定的条件。有 C 编号的自绘器件同样可能需要本地模型；没有 C 编号的器件也可能已经存在于个人库或工程库。真正的分流条件是 EDA 能否返回并重新解析完整 device 引用。

## 官方能力核对

### 已确认

| 能力 | 官方接口 | 已确认的行为 |
| --- | --- | --- |
| 读取原理图器件引用 | `ISCH_PrimitiveComponent.getState_Component()` | 返回 `libraryUuid`、`uuid` 和可选名称，或 `undefined` |
| 读取 PCB 器件引用 | `IPCB_PrimitiveComponent.getState_Component()` | 返回相同结构 |
| 回读指定器件 | `LIB_Device.get(deviceUuid, libraryUuid)` | 可按器件 UUID 和库 UUID 获取器件；未传库 UUID 时默认系统库 |
| 原理图鼠标放置 | `SCH_PrimitiveComponent.placeComponentWithMouse()` | 接受 `libraryUuid + uuid`；返回 `true` 只表示器件已绑定到鼠标，不表示用户完成画布放置 |
| 获取库作用域 | `getSystemLibraryUuid()`、`getPersonalLibraryUuid()`、`getProjectLibraryUuid()` | 个人库属于当前工作区；未打开工程时工程库返回 `undefined` |
| 获取上下文 | `DMT_Workspace.getCurrentWorkspaceInfo()`、`DMT_SelectControl.getCurrentDocumentInfo()` | 可记录当前工作区 UUID 和文档所属工程 UUID |
| 注册外部库 | `LIB_LibrariesList.registerExtendLibrary()` | 扩展可注册器件、符号、封装、复用模块及 3D 模型提供者，返回运行时库 UUID |
| 提供外部符号/封装载荷 | `ILIB_ExtendLibraryItem` | 外部库条目可以提供 `url`，或提供 `Blob`/Data URL 形式的 `data`；不代表任意原始文本或绝对文件路径均可用 |

外部器件提供者的列表结果可以同时关联符号、封装、可选 3D 模型索引和属性。由该官方类型结构可以推断它具备表达 device 关联关系的候选能力，而不是只能提供一个符号名称；但这只是类型层面的推断，不能替代实际放置、回读和跨重启验证。当前锁定类型中 3D 只有索引和调整参数，没有明确载荷契约，因此不能把完整 3D 器件支持列为已确认能力。

### 尚未由官方保证

- 个人库器件引用是否在客户端重启后保持不变。
- 工程库器件是否只能在原工程内解析，切换工程后会得到 `undefined` 还是仍能访问。
- 离线 `.elib` 或其他本地库中的器件能否被 `LIB_Device.get()` 按原引用稳定回读。
- `registerExtendLibrary()` 每次激活返回的库 UUID 是否稳定。
- `LIB_Device.get(uuid, libraryUuid)` 是否能够解析 `registerExtendLibrary()` 注册的外部库；公开签名允许传库 UUID，但官方没有明确承诺覆盖该场景。
- 外部库器件放置后，`getState_Component()` 返回的是提供者稳定 ID、EDA 生成的临时 ID，还是其他映射结果。
- 外部库提供者未注册、扩展重载或客户端重启时，已经保存的引用如何表现。
- 外部库 `getDetail()` 的实际详情契约，以及符号、封装和 3D 模型文件所需格式、MIME、URL 协议、跨域规则和离线缓存行为。
- 外部器件列表中的 3D 模型只有索引和调整信息，是否必须再注册独立 3D 模型提供者，以及放置后能否保留关联。
- 当前锁定 SDK 没有外部库注销接口；扩展重复激活是否产生重复库或遗留运行时句柄。
- 仅有符号和封装、但没有完整 device 的已放置对象，能否无损重建为相同器件。
- Web、桌面在线模式和桌面离线模式是否具有相同的外部库行为。

`LIB_Device.get()`、`placeComponentWithMouse()` 和 `registerExtendLibrary()` 当前都标为 BETA。后续必须把它们继续限制在 `src/platform/jlceda-v3` 适配层，并保留能力检测、诊断和降级路径。

## 当前工程缺口

当前 `EdaModelReference` 已保存 `deviceUuid + libraryUuid`，放置适配器也按这两个字段调用官方 API，但模型来源只有系统库搜索结果。

当前选中器件读取器虽然会调用 `getState_Component()` 和 `getState_Footprint()`，却只保留名称，丢弃了 `libraryUuid` 和 `uuid`；接口中也没有 `getState_Symbol()`。因此现有的“选中设计器件”链路不能用于模型绑定，后续必须新增独立的模型绑定快照，不能把库存校验 DTO 强行扩成宿主模型对象。

当前未实现以下能力：

- 从选中的原理图或 PCB 器件捕获完整 device 引用。
- 判断引用属于系统库、个人库、工程库还是外部库。
- 保存工作区、工程和外部提供者作用域。
- 保存或注册本插件自有的本地模型载荷。
- 放置前使用 `LIB_Device.get()` 重新验证引用。
- 失效引用的重新绑定、迁移或明确禁用状态。

## 候选接入路线

### 路线 A：引用 EDA 已管理的完整器件

适用对象：系统库、个人库、工程库，以及已经由其他扩展注册且经实测引用稳定的外部库器件。

调用链：

```text
用户在 SCH/PCB 选中一个已放置器件
  -> 读取 getState_Component()
  -> 同时读取 workspaceUuid / projectUuid
  -> LIB_Device.get(deviceUuid, libraryUuid) 回读校验
  -> 用户确认绑定到指定库存条目
  -> 持久化器件引用和作用域证据
  -> 每次放置前再次 LIB_Device.get()
  -> SCH_PrimitiveComponent.placeComponentWithMouse()
```

绑定时必须满足：

1. 只选择一个器件图元；多选时先由用户明确选定目标。
2. `getState_Component()` 同时返回非空 `libraryUuid` 和 `uuid`。
3. `LIB_Device.get(uuid, libraryUuid)` 能回读同一器件。
4. 记录当前工作区；工程库还必须记录当前工程。
5. 用户确认库存条目与该器件的绑定关系，不按名称或 C 编号静默推断。

放置时重新验证，不能因为库存中存在 UUID 就直接认为模型可用。工程作用域不一致、库不存在或回读失败时，将绑定标为不可解析并提示重新绑定，不自动改用名称相似的器件。

### 路线 B：由插件提供本地外部器件库

适用对象：不在任何可稳定引用 EDA 库中的自定义器件模型。

候选调用链：

```text
用户导入或选择格式兼容的本地器件模型资产
  -> 插件校验器件、符号、封装及可选 3D 模型清单
  -> 为器件生成插件域内稳定 providerId + itemId + assetRevision + assetHash
  -> 将清单和模型载荷保存到受控存储
  -> 扩展激活时 registerExtendLibrary()
  -> 外部库回调按稳定 itemId 返回详情、列表及符号/封装 data/url
  -> 试验运行时 libraryUuid + item uuid 的解析方式
  -> 放置并回读 getState_Component() 验证映射
```

这条路线中，`registerExtendLibrary()` 返回的运行时 `libraryUuid` 不能在实机证明稳定前作为唯一持久化主键。库存应保存插件自己的稳定 `providerId + itemId + assetRevision`；每次激活后重新注册并建立“稳定 ID -> 当前运行时 EDA 引用”映射。

模型载荷不能直接塞进库存条目。库存条目只保存绑定标识；模型清单、符号、封装和 3D 文件由独立资产仓储管理，以便做容量限制、哈希校验、去重、迁移和备份。

官方 API 没有提供“把任意绝对文件路径直接变成可放置器件”的承诺。`url` 会由宿主发起请求，但官方未承诺支持 `file://`、绝对本地路径、鉴权、跨域或离线缓存；原型应先验证 `Blob`，再分别验证 Data URL 和远程 URL，不把本地路径直接当作可用 URL。

外部库也不是从当前画布或现有 EDA 器件提取模型的接口。公开 API 没有把图元反向导出成外部库载荷的调用，因此路线 B 必须已经持有兼容的符号/封装资产，不能用来自动修复任意 `getState_Component() === undefined` 的图元。本路线是否采用，取决于外部库实机试验，而不是只验证目录选择或文件能否读取。

### 不接受的替代路线

- 不按“有 C 编号/无 C 编号”决定模型来源。
- 不要求用户先把自定义器件复制到个人库，除非外部库路线被实机否决且用户明确接受该降级。
- 不把 `placeSymbolWithMouse()` 当作完整器件放置。符号引用不保证封装、3D 模型和器件属性仍然关联。
- 不通过名称、封装名或厂家型号猜测另一个模型并自动绑定。
- 不导出或复制 EDA 已能稳定引用的现有器件。
- 不把其他扩展注册的外部库当作本插件可以控制或永久访问的资产仓储。

## 数据结构草案

以下只用于约束后续迁移，不是当前代码接口：

```ts
type LocalDeviceBinding
	= | {
		kind: 'eda-device-reference';
		libraryUuid: string;
		deviceUuid: string;
		sourceScope: 'system' | 'personal' | 'project' | 'external' | 'unknown';
		workspaceUuid?: string;
		projectUuid?: string;
		deviceName?: string;
		symbolName?: string;
		footprintName?: string;
		capturedAt: string;
	}
	| {
		kind: 'plugin-external-device';
		providerId: string;
		itemId: string;
		assetRevision: string;
		assetHash: string;
		deviceName?: string;
		symbolName?: string;
		footprintName?: string;
		capturedAt: string;
	};
```

约束：

- `sourceScope` 来自库 UUID 与当前系统库、个人库、工程库及已注册外部库的比对，不能依据器件名称推断。
- `projectUuid` 只约束工程库引用；在其他工程中默认禁用，除非实机证明可安全解析。
- `workspaceUuid` 用于防止把工作区局部引用误当成全局引用。
- 插件外部器件不把运行时 `libraryUuid` 作为长期事实。
- 现有 schema 必须提供显式迁移；旧 `EdaModelReference` 先归为 `unknown`，经回读确认后再补作用域。
- 备份需同时覆盖绑定元数据；若采用插件外部器件，资产仓储必须另行定义可恢复格式，不能只备份库存 JSON 后留下失效绑定。

## 实现阶段与准入门槛

### 阶段 0：只读能力探针

先实现内部诊断探针，不写库存：

- 读取选中器件的 component、symbol、footprint 引用是否存在。
- 读取当前 workspace、project 以及系统/个人/工程库 UUID。
- 调用 `LIB_Device.get()` 验证 component 引用。
- 记录库作用域、是否回读成功和错误类别，不记录完整 UUID、本地路径或模型内容。

阶段 0 通过后，才能开放路线 A 的绑定 UI。

### 阶段 1：EDA 现有器件绑定

先支持实机已经证明稳定的库作用域。绑定入口放在库存总览的条目操作中，调用现有 EDA 选择读取适配层；保存前显示器件名称、符号、封装和作用域供用户确认。

如果只有个人库通过，就只发布个人库支持；工程库和外部库保持禁用并显示未验证原因，不能用同一个“本地模型已支持”状态掩盖差异。

### 阶段 2：插件外部库原型

使用最小固定测试资产，在已打包扩展中验证注册、搜索、放置、回读、扩展重载和客户端重启；`registerExtendLibrary()` 在独立脚本环境会抛错，不能用独立脚本替代该试验。不接入真实库存，不让用户导入任意文件。

只有同时满足以下条件才进入正式资产设计：

1. 外部器件能以 device 放置；API 返回 `true` 后实际点击画布，符号和封装均正确。
2. 放置后能回读到可重建的稳定条目标识。
3. 扩展停用再启用后，旧绑定可重新解析。
4. 客户端重启后，旧绑定可重新解析。
5. 提供者缺失或资产损坏时只禁用放置，不破坏库存主数据。
6. 重复激活不会产生重复外部库，或插件能可靠识别并收敛重复注册。
7. 放置后的 component、symbol、footprint、BOM 属性和转 PCB 结果均正确。

3D 模型单独设门槛。在 3D 详情契约、载荷格式、放置关联和重启恢复全部通过前，路线 B 只能声明支持符号与封装，不能声明支持完整 3D 模型。

### 阶段 3：资产仓储与备份

定义模型格式白名单、单文件和总容量限制、SHA-256、原子写入、去重、清理引用和备份恢复。完成这些能力前，不开放任意本地模型导入。

## 实机验证矩阵

| 样本 | 同会话回读/放置 | 重载扩展 | 重启客户端 | 切换工程/工作区 | 预期处理 |
| --- | --- | --- | --- | --- | --- |
| 系统库器件 | 必测 | 必测 | 必测 | 必测 | 作为现有基线 |
| 个人库自绘器件，有 C 编号 | 必测 | 必测 | 必测 | 必测 | 不因 C 编号走系统库逻辑 |
| 个人库自绘器件，无 C 编号 | 必测 | 必测 | 必测 | 必测 | 与上一行使用相同引用逻辑 |
| 工程库自绘器件 | 必测 | 必测 | 必测 | 必测 | 默认限制在原工程 |
| 已加载的本地/离线 EDA 库器件 | 必测 | 必测 | 必测 | 必测 | 先识别真实库作用域 |
| 其他扩展提供的外部器件 | 必测 | 必测 | 必测 | 必测 | 提供者缺失时必须失效 |
| 本插件固定外部库测试器件 | 必测 | 必测 | 必测 | 必测 | 决定路线 B 是否成立 |
| 只有 symbol、没有 component 引用的对象 | 只读检查 | 不适用 | 不适用 | 不适用 | 不作为完整器件绑定 |

每个样本至少记录：

- `getState_Component()` 是否返回完整引用。
- `LIB_Device.get()` 是否能以原库 UUID 回读。
- `placeComponentWithMouse()` 是否返回 `true`，实际符号和封装是否正确。
- 重启或切换上下文前后，库作用域和解析结果是否一致。
- 模型失效时库存是否仍可浏览、编辑、备份和恢复。

准入判定：

- **A0，同会话可用**：只允许作为诊断结论，不允许持久化宣传。
- **A1，同工作区跨重启可用**：可支持系统库或个人库长期绑定。
- **A2，同工程跨重启可用**：可支持带 `projectUuid` 限制的工程库绑定。
- **B1，外部提供者跨重载可重建**：可以继续设计插件外部资产仓储。
- **B2，外部提供者跨重启且故障可恢复**：才允许对用户开放本地外部器件导入。

## 用户可见失败行为

- 绑定时无法获得完整 component 引用：提示该对象不是可绑定的完整 EDA 器件，不自动退化为符号。
- 回读失败：不保存新绑定；已有绑定标为“模型引用失效”，保留库存数据。
- 工程或工作区不匹配：显示来源作用域，并要求回到原上下文或重新绑定。
- 外部提供者未加载：禁用放置，允许查看、编辑和解除绑定。
- 放置 API 返回 `false`：恢复库存总览并显示模型不可解析，不修改库存数量。
- API 抛错：写诊断错误类别，不记录 UUID、模型内容和本地路径。

## 本轮明确不做

- 不实现任何模型绑定按钮、资产导入或外部库注册。
- 不修改 `0.5.9` 的库存 schema、放置流程或本地模型相关手动测试范围。
- 不把现有无 C 编号边界样本作为本功能已经支持的证据。
- 不为本地模型能力构建实现包；`0.5.9` 安装包不包含该能力。

## 官方资料

- [嘉立创 EDA 专业版器件概念](https://prodocs.lceda.cn/cn/introduction/introduction/)
- [ISCH_PrimitiveComponent.getState_Component()](https://prodocs.lceda.cn/cn/api/reference/pro-api.isch_primitivecomponent.getstate_component.html)
- [IPCB_PrimitiveComponent.getState_Component()](https://prodocs.lceda.cn/cn/api/reference/pro-api.ipcb_primitivecomponent.getstate_component.html)
- [LIB_Device.get()](https://prodocs.lceda.cn/cn/api/reference/pro-api.lib_device.get.html)
- [SCH_PrimitiveComponent.placeComponentWithMouse()](https://prodocs.lceda.cn/cn/api/reference/pro-api.sch_primitivecomponent.placecomponentwithmouse.html)
- [SCH_PrimitiveComponent.placeSymbolWithMouse()](https://prodocs.lceda.cn/cn/api/reference/pro-api.sch_primitivecomponent.placesymbolwithmouse.html)
- [LIB_LibrariesList.getPersonalLibraryUuid()](https://prodocs.lceda.cn/cn/api/reference/pro-api.lib_librarieslist.getpersonallibraryuuid.html)
- [LIB_LibrariesList.getProjectLibraryUuid()](https://prodocs.lceda.cn/cn/api/reference/pro-api.lib_librarieslist.getprojectlibraryuuid.html)
- [DMT_Workspace.getCurrentWorkspaceInfo()](https://prodocs.lceda.cn/cn/api/reference/pro-api.dmt_workspace.getcurrentworkspaceinfo.html)
- [LIB_LibrariesList.registerExtendLibrary()](https://prodocs.lceda.cn/cn/api/reference/pro-api.lib_librarieslist.registerextendlibrary.html)
- [ILIB_ExtendLibraryItem](https://prodocs.lceda.cn/cn/api/reference/pro-api.ilib_extendlibraryitem.html)
- [ILIB_ExtendLibraryDeviceFunctions](https://prodocs.lceda.cn/cn/api/reference/pro-api.ilib_extendlibrarydevicefunctions.html)
- [扩展 API 接口稳定性](https://prodocs.lceda.cn/cn/api/guide/stability.html)
