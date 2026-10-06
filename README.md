# Sentinel RGBT 光伏双模态智能巡检平台

面向光伏场站、无人机飞手、运维工程师和算法研究人员的 RGB-Thermal 巡检参考平台。系统把任务、航线、RGB/热红外证据、异常复核、工单、资产、模型实验、报告、权限和审计组织在同一条可追溯链路中。

> 重要边界：当前交付是可运行的研究与工程原型。演示数据和概念影像不构成真实故障诊断；平台默认不向无人机发送飞控指令。

## 已实现

- React 19 + TypeScript + Vite 响应式前端，13 个业务入口
- 地图主导的运行总览、场站/任务上下文、无人机连接诊断和任务创建向导
- 场站联动的概念底图、独立计划/实际航迹、设备与环境参数，以及任务级九项飞行与证据质量门控
- 实时任务控制台：安全检查、RGB-Thermal 载荷、链路延迟、离线续传、队列、团队、活动与系统健康
- RGB/Thermal 滑杆对照、帧播放、检测/组件网格叠加、类别概率、配准与测温依据、人工判定和复飞/工单闭环
- 异常中心、工单看板、资产台账、报告与数据管理
- 已训练并接入的热红外 YOLO、可见光缺陷 YOLO、航拍组件分割、电池片 EL 分类、功率回归和并网波形分类模型
- 模型目录、独立测试指标、模型卡、训练可视化与六类上传/输入推理工具
- RGB-Thermal 融合实验仍保留“待运行”边界，不把热红外单模态结果冒充双模态结果
- FastAPI + SQLAlchemy + SQLite 参考后端
- JWT 登录/刷新、bcrypt 密码哈希、RBAC、限流、安全响应头和审计日志
- Axios 请求实例、统一错误信封、请求追踪号、401 处理和可读错误反馈
- 系统运行诊断：数据库、认证、无人机适配器、AI、证据存储与业务数据一致性
- 异常/工单状态机、重复工单拦截、关联状态联动和关闭结论约束
- OpenAI-compatible AI 适配器，可配置 GPT、DeepSeek、豆包兼容网关或本地模型
- 无人机任务清单校验 API 与项目内 Codex 插件
- Docker Compose、本地启动脚本、API/无人机/安全/AI 文档

## 本地启动

要求：Node.js 20+、Python 3.9+。

### 推荐：双击打开

在“平台系统_完整版”文件夹中双击 `打开平台.command`。脚本会自动启动前端和后端、避让已占用端口，并打开最新版“新能源巡检联合指挥大屏”。启动后请保留弹出的终端窗口；关闭该窗口即停止平台。

如果 macOS 第一次阻止运行，请右键 `打开平台.command`，选择“打开”，再确认一次。

### 手动启动

```bash
cd frontend
npm install
npm run dev
```

另开一个终端：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m pip install -r backend/requirements-ml.txt
cd backend
../.venv/bin/uvicorn app.main:app --reload --port 8000
```

访问：

- 平台主入口：`http://localhost:5173/command-center`
- API 文档：`http://localhost:8000/api/docs`
- 健康检查：`http://localhost:8000/health`

演示账号：`admin@sentinel-rgbt.com` / `Sentinel123!`

模型实验页提供真实训练指标和热红外检测、可见光缺陷检测、航拍组件分割、电致发光分类、电气波形分类、功率样本域回归等专用工具。第一次视觉推理会加载权重，速度会比后续请求慢。平台按数据模态路由模型，不把不同任务的分数横向比较；任何模型输出都必须结合原始证据和人工复核，不得直接当作现场故障结论。

## Docker 启动

```bash
docker compose up --build
```

访问 `http://localhost:8080`。生产部署前必须修改 `JWT_SECRET`、数据库、CORS、TLS、对象存储和演示账号。

## 目录

```text
frontend/                     React 前端
backend/                      FastAPI 后端
docs/                         接口、无人机、AI、安全和功能文档
plugins/pv-rgbt-ingestion/    任务包校验 Codex 插件
assets/plates/                项目视觉素材
legacy/                       原始静态原型备份
design-system/                设计系统决策
training_pipeline_v2/         六类数据的清洗、去泄漏划分、训练、评估与模型卡
```

## 关键资料

- [无人机接入](docs/无人机接入.md)
- [API 规范](docs/API规范.md)
- [AI 模型接入](docs/AI模型接入.md)
- [安全与部署](docs/安全与部署.md)
- [功能与验收](docs/功能与验收.md)
- [工业指标与判读边界](docs/工业指标与判读边界.md)

第三方动效使用了 Motion、Anime.js 以及 React Bits 的项目内组件副本。React Bits 许可见 `REACT_BITS_LICENSE.md`。
