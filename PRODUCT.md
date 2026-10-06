# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: React + TypeScript + Vite for the web client, FastAPI + SQLAlchemy + SQLite for the reference backend, Axios for HTTP requests, and a typed OpenAPI contract. The user explicitly requested React Bits-style motion and a complete frontend/backend system.

## Users

- 无人机飞手与现场巡检人员：创建任务、检查天气与载荷、采集并上传 RGB/Thermal 数据。
- 光伏运维工程师：查看异常证据、复核热斑风险、创建工单并跟踪闭环。
- 算法研究人员：管理数据集、模型、实验、阈值、版本和可复现报告。
- 场站负责人和审计人员：查看资产健康、任务完成率、风险趋势、权限与操作日志。

## Product Purpose

把无人机 RGB 与热红外巡检数据组织成可追溯的证据链，让用户能够从飞行任务进入数据质量检查、双模态分析、人工复核、工单处置和报告归档。成功不等于“界面展示了 AI”，而是关键流程可以操作、状态可以追踪、模拟与真实数据可以区分、接口和错误都有明确反馈。

## Positioning

平台把弱配准 RGB-Thermal 证据、数据质量门控、组件级定位、模型解释和运维闭环放在同一条工作流中；任何自动结论都保留来源、版本和人工复核边界。

## Operating Context

用户在场站、办公室和研究环境中使用桌面浏览器或平板浏览器。典型输入包括无人机任务元数据、RGB/Thermal 图像、温度矩阵、GPS/姿态、标注、模型预测和人工处置记录。典型输出包括异常事件、组件档案、工单、对比报告、实验指标和审计日志。

## Capabilities and Constraints

- 必须覆盖总览、任务、实时飞行、证据浏览、异常中心、工单、资产、模型实验、报告、数据管理、用户权限、系统设置和 AI 助手。
- 使用 Axios 访问版本化 REST API；接口规范、错误结构、鉴权、分页、过滤和幂等约定必须文档化。
- 参考后端提供成熟的角色权限、密码哈希、JWT、审计日志、限流/安全头说明和开箱即用的数据管理接口。
- 没有真实无人机和模型服务时，使用可切换的演示适配器，并在 UI 与文档中显式标记。
- 不把模型概率直接等同于设备故障结论；高风险事件需要人工复核。
- 设计必须响应式、键盘可用、支持减少动态效果，并避免把高动效堆叠在持续操作界面。

## Brand Commitments

产品名使用 `Sentinel RGBT`，中文副标题为“光伏双模态智能巡检平台”。品牌语气专业、克制、清晰，避免营销夸张。视觉可以有强识别度，但主要工作台保持安静、密集和高效。

## Evidence on Hand

- 旧版静态原型保存在 `legacy/`，只可作为功能和内容线索，不作为新视觉约束。
- 论文资料包和演示 CSV 位于桌面同名资料包；演示数据不能被表述为真实实验结果。
- 当前没有可核查的真实无人机连接日志、真实用户账号、生产数据库或真实模型推理服务。

## Product Principles

1. 证据先于结论：每个异常都能回到 RGB、Thermal、位置、时间、模型和人工操作。
2. 操作闭环优先：关键状态必须能继续行动，而不是停在图表展示。
3. 风险透明：自动化边界、模拟状态、数据质量和置信度始终可见。
4. 专业效率：高频任务减少跳转和重复输入，信息层级服务扫描与比较。
5. 可扩展但不过度承诺：真实无人机、模型和第三方 AI 通过适配器接入。

## Accessibility & Inclusion

目标遵循 WCAG 2.2 AA 的可感知、可操作和键盘访问原则；交互目标至少 44px，颜色不是唯一状态编码，动效支持 `prefers-reduced-motion`，表单错误就地显示。
