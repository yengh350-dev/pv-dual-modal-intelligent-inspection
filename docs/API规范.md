# API 书写规范

## 1. 基本约定

- 基础路径：`/api/v1`
- 资源名使用复数名词和 kebab-case，例如 `/work-orders`
- GET 查询，POST 创建或执行明确动作，PATCH 局部更新，DELETE 删除
- JSON 字段对外使用 camelCase；数据库字段可使用 snake_case
- 时间使用带时区的 ISO 8601，例如 `2026-09-05T09:57:24.182+08:00`
- 经纬度使用 WGS84；温度使用摄氏度；高度必须注明基准
- 每个请求可发送 `X-Request-ID`，响应始终回传该值

## 2. 统一响应

成功：

```json
{
  "data": {"id": "MSN-240905-042"},
  "meta": {"page": 1, "pageSize": 20, "total": 42}
}
```

参数错误：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不符合接口约定",
    "details": []
  },
  "requestId": "..."
}
```

## 3. 认证与权限

- `POST /auth/login` 登录
- `POST /auth/refresh` 刷新访问令牌
- `GET /auth/me` 获取当前身份
- 受保护接口使用 `Authorization: Bearer <accessToken>`
- 角色：`admin`、`operator`、`pilot`、`researcher`、`auditor`、`viewer`
- 权限必须由后端执行，前端隐藏按钮不能替代授权检查

## 4. 主要接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/missions` | 任务分页与状态筛选 |
| POST | `/missions` | 创建计划任务 |
| GET | `/missions/{id}/quality-gate` | 读取任务级航迹、定位、双模态配对与热检查环境质量门控 |
| GET | `/anomalies` | 异常查询 |
| PATCH | `/anomalies/{id}?status=` | 人工复核状态更新 |
| GET/POST | `/work-orders` | 查询/创建工单 |
| PATCH | `/work-orders/{id}` | 更新处置状态 |
| GET | `/integrations/drone/status` | 查询无人机接入边界 |
| GET | `/system/readiness` | 检查数据库、认证、设备适配、AI、存储和业务一致性 |
| POST | `/ingestion/manifests/validate` | 校验双模态任务清单 |
| POST | `/ai/chat` | 基于页面上下文的专业助手 |
| GET | `/ai/providers` | 返回可选模型、服务端配置状态与默认路由，不返回密钥或 Base URL |
| POST | `/ai/providers/{providerId}/test` | 管理员实际调用一次指定模型并返回模型名与延迟 |
| GET | `/models/current` | 返回当前检测权重的模型卡、独立测试指标、数据划分与运行状态 |
| POST | `/models/current/predict` | 上传一张 JPEG/PNG 热红外图像，返回归一化检测框；15 MB 上限，需登录并限流 |
| GET | `/models` | 返回全部已注册模型、产物可用状态、指标与适用边界 |
| POST | `/models/visible-defect/predict` | 上传可见光组件图像，返回 Crack/Grid/Spot 归一化候选框 |
| POST | `/models/panel-segmentation/predict` | 上传航拍场站图像，返回组件归一化多边形轮廓 |
| POST | `/models/cell-anomaly/predict` | 上传单片 EL 图像，返回 poly wafer/crack/inactive 多标签概率 |
| POST | `/models/power/predict` | 输入环境温度、辐照度、组件温度、倾角、湿度和小时，返回样本域功率估计 |
| POST | `/models/grid-fault/predict` | 上传至少 512 行标准字段 CSV 波形，返回仿真工况分类概率 |
| GET | `/audit-logs` | 审计日志 |

完整参数与在线试调以 `/api/docs` 生成的 OpenAPI 为准。

## 5. Axios 规范

前端只保留一个 `api` 实例：统一 Base URL、超时、JSON、请求 ID、Bearer Token 和 401 处理。页面组件不拼接主机地址、不读取供应商密钥、不自行发裸 `fetch` 请求。

## 6. 版本与幂等

- 破坏性字段变更进入 `/api/v2`；新增可选字段留在 v1
- 生产环境的任务包提交和工单创建应支持 `Idempotency-Key`
- Webhook 必须 HMAC 签名、限制时间窗并保存投递结果

## 7. 状态与一致性约束

- 异常状态只允许：`待复核`、`已确认`、`已转工单`、`已排除`、`需复飞`，非法跳转返回 `409`。
- 工单按 `待排程 → 已派发 → 处理中 → 待验收 → 已关闭` 流转，可在允许阶段取消；关闭前必须填写处置结论。
- 同一异常只能关联一张未关闭工单，重复创建返回 `409` 和已有工单号。
- 关联异常必须先经人工复核进入“已确认”，才能创建处置工单；模型候选不能绕过人工确认直接派单。
- 创建关联工单后，异常状态由后端同步为 `已转工单`，不能只靠前端修改显示。
- 任务号和工单号使用日期加随机短标识，避免按行数编号产生并发碰撞。
- 清单校验除缺失模态和时间漂移外，还阻止重复 `pairId + modality` 与重复文件路径。

## 8. 飞行与证据质量门控

- 质量接口只接受已存在的任务号；未知任务返回 `404`，不能用客户端传入结果覆盖服务端计算。
- 响应包含横向航迹偏差、RTK FIX 有效率、高度稳定性、地理标记精度、RGB-Thermal 配对率、时间差、视角、样本数、计算时间、来源，以及服务端计算的任务门控结论、分项分数和可分析状态。
- 当前原型返回明确标记的历史演示基线。生产实现必须从遥测、相机时间戳、媒体清单和质量计算任务生成，不得信任浏览器提交的“通过”状态。
- 项目门槛与设备厂商规格、IEC 验收要求分开存储；接口通过不等于适航、计量校准或设备故障最终结论。

## 9. AI 网关约束

- 提供商只能从服务端白名单中选择，客户端不能提交任意 Base URL，避免把后端变成 SSRF 转发器。
- API Key 只从 FastAPI 环境变量读取；提供商目录仅返回是否配置、模型名和默认路由。
- 页面上下文最多 6000 字符，会话历史最多保留最近 8 条；原始巡检影像默认不发送给通用对话模型。
- 每次调用受 JWT、频率限制、请求超时和审计日志约束。模型不可直接确认异常、创建工单或发送飞控指令。
