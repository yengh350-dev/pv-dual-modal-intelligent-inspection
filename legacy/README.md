# RGB-Thermal Sentinel

这是面向本科研究和答辩演示的静态平台原型，不是已经连接真实无人机的生产系统。演示数据和图像均为 synthetic/demo，不能用来宣称模型精度。

## 打开方式

直接双击 `index.html`，或在当前目录运行一个静态服务器：

```bash
python3 -m http.server 8080
```

然后打开 `http://localhost:8080`。

## 演示路径

1. 总览：展示场站健康、覆盖率、异常地图和飞行链路。
2. 点击“导入巡检数据”：模拟导入 RGB、Thermal、视频帧、R-JPEG/TIFF 和元数据。
3. 点击异常列表或地图上的点：查看组件位置、RGB/Thermal 证据、热差、质量分和解释。
4. 在证据浏览中点击“创建维修工单”：进入运维闭环。
5. 在侧边栏切换“飞行任务”和“运维工单”：展示任务质量、责任人、状态和处置结果。

## 真正接无人机时的接口边界

### V1：离线导入，最适合你的第一版论文

无人机负责拍摄；飞行结束后导出 RGB、Thermal、视频或图片以及元数据；平台后端负责读取 EXIF/厂商元数据，完成时间配对、质量门控和推理。需要保留：

```json
{
  "mission_id": "Sentinel-042",
  "rgb_uri": "rgb/frame_01842.jpg",
  "thermal_uri": "thermal/frame_01842_R.JPG",
  "timestamp": "2026-09-05T09:57:24.182+08:00",
  "latitude": 31.0426,
  "longitude": 120.6982,
  "altitude_m": 42.3,
  "gimbal": {"yaw": 91.2, "pitch": -74.5, "roll": 0.8},
  "irradiance_w_m2": 784,
  "wind_speed_m_s": 2.6,
  "camera_model": "Mavic 3T",
  "provenance": {"source": "uav_export", "sha256": "..."}
}
```

### V2：空间定位

把 EXIF/GPS 结果和电站的方阵/组件 GIS 图层关联，使用 GPS、相机姿态、阵列几何和图像相似度把多帧检测合并为一个 `AnomalyEvent`。输出的不只是框，而是 `station_id / array_id / row / module_id / lat / lon / evidence_uris`。

### V3：实时视频

用厂商 SDK、RTSP 或 RTMP 把视频流送到边缘网关。网关用 FFmpeg/OpenCV 解码，模型只回传异常摘要和低分辨率预览，原始数据可在本地缓存。若使用 DJI 体系，具体能力必须按机型和载荷查官方 SDK；DJI Liveview 文档提供 H.264/RGB 流获取接口，DJI Thermal SDK 用于 R-JPEG 红外数据和温度测量。

### V4：复飞闭环

当模型发现“热图热点但模态冲突”或“GPS 可信度低”时，不直接生成高优先级工单，而生成一个 `reacquisition_request`，包括目标坐标、建议高度、云台角度、复飞半径和需要补拍的模态。飞控/任务规划功能必须在机型、空域和安全条件明确后再实现。

## 建议的后端拆分

- `ingestion-service`：文件/视频/SDK 接入，元数据和哈希。
- `quality-service`：清晰度、曝光、热图有效性、时间差、GPS 和环境门控。
- `inference-service`：组件检测、RGB-Thermal 融合、缺陷识别、版本管理。
- `geo-service`：GPS 投影、组件 ID、轨迹跟踪、地理去重。
- `asset-service`：资产历史、健康优先级、复测。
- `workorder-service`：人工复核、维修工单、闭环报告。
- `web-console`：本目录的界面，后续用 API 替换 demo 数据。

## 绝对不能省略的工程约束

- 伪彩热图不能代替辐射温度数据。
- 图片名相同不能证明 RGB 与 Thermal 已配准，必须记录时间差和设备元数据。
- 相邻视频帧不能随机切分到训练集和测试集。
- 辐照度、风速、云层、发射率、距离和视角会影响热异常解释。
- “健康分/优先级”不等同于真实剩余寿命；寿命模型需要长期历史数据。
- 真实飞行、自动控制和电站作业必须遵守当地法规和现场安全制度。
