# AI 模型接入

## 支持方式

后端使用带白名单的 OpenAI-compatible `chat/completions` 模型网关，可连接 OpenAI、DeepSeek、豆包火山方舟、通义千问百炼和企业自建兼容网关。浏览器只保存用户选择，不保存或回显 API Key，也不能从请求中指定任意 Base URL。

```env
AI_DEFAULT_PROVIDER=deepseek

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra

DEEPSEEK_API_KEY=replace-me
DEEPSEEK_MODEL=deepseek-v4-flash

DOUBAO_API_KEY=
DOUBAO_MODEL=doubao-seed-2-1-pro-260628

QWEN_API_KEY=
QWEN_MODEL=qwen-plus
```

完整字段见 `backend/.env.example`。修改 `.env` 后重启 FastAPI，使用“集成与设置 -> AI 模型 -> 实际调用一次并测试连接”验证。外部模型调用需要使用平台账号安全登录；直接进入纯前端演示环境时只提供本地降级提示。

官方兼容接口参考：

- OpenAI：`https://platform.openai.com/docs/api-reference/chat`
- DeepSeek：`https://api-docs.deepseek.com/api/create-chat-completion/`
- 火山方舟：`https://docs.volcengine.com/docs/ark/compatible-with-openai-sdk`
- 阿里云百炼：`https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope`

## 上下文边界

前端发送当前路由、模块、场站、任务摘要和页面专属证据，以及用户输入的短会话历史；后端把页面上下文截断在 6000 字符、会话历史限制为最近 8 条。证据页会附带事件编号、组件位置、温差、配准误差、时间同步偏差和跨帧持续性；原始影像默认不传给通用对话模型。系统提示明确把页面上下文视为数据而不是指令，并拒绝密钥泄露、越权和飞控操作。

## 必须遵守

- AI 回答是复核辅助，不是维修结论
- AI 不直接确认异常、不自动关闭工单、不发送飞控指令
- 每次回答记录提供商、模型、演示/在线模式和请求追踪信息
- 关键建议要求人工确认
- 用固定测试集评估幻觉、越权、提示注入、敏感信息泄露和拒答行为

## 视觉模型流水线建议

`数据质检 -> 双模态配准 -> 组件定位 -> RGB/Thermal 特征融合 -> 缺陷/热斑检测 -> 跨帧聚合 -> 不确定性估计 -> 人工复核`

模型实验页已接入 `sentinel_rgbt_yolo11n_v1` 热红外基线：权重、模型卡、训练曲线、独立测试混淆矩阵和上传推理接口均来自同一次可追溯运行。该数据集不含成对 RGB 图像，因此结果只能写作“热红外单模态基线”，RGB-Thermal 融合实验继续保持“待运行”，不可用单模态数字冒充双模态结果。

新增的六类数据按任务分别训练，平台不做错误的“六类数据混合训练”：`defect_yolo11n_v1` 处理可见光 Crack/Grid/Spot，`distributed_pv_yolo11n_v1` 定位航拍场景中的组件，`panel_segmentation_yolo11n_v1` 输出组件多边形轮廓，`cell_anomaly_cnn_v1` 处理单片 EL 图像，`pv_power_hgb_v1` 处理环境与功率表格，`grid_fault_rf_v1` 处理连续电气波形。接口返回模型版本、耗时、适用边界和 `reviewRequired`，前端将候选结果与工程结论明确分开。
