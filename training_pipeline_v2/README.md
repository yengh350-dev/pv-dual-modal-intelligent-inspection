# Multi-task training pipeline v2

This pipeline treats the six supplied datasets as separate tasks. It never edits source data and records deterministic splits with seed `20260922`.

- `defect`: visible-light Crack/Grid/Spot object detection. Rotations sharing the same source index stay in one split; publisher validation is retained as the independent test set.
- `panel_segmentation`: solar-panel polygon segmentation. Roboflow variants from the same source image stay in one split.
- `distributed_pv`: aerial solar-panel object detection using the publisher split.
- `cell_anomaly`: multi-label cell classification with stratification by label combination.
- `pv_power_hgb_v1`: chronological power regression baseline.
- `grid_fault_rf_v1`: waveform-window grid fault classification baseline.

The data are predominantly visible-light, electroluminescence, tabular, or electrical waveform data. They are not paired RGB-Thermal observations and cannot substantiate a dual-modal fusion claim.

## Reproducible commands

```bash
.venv/bin/python training_pipeline_v2/prepare_multitask.py --source "/absolute/path/to/AI+新能源光伏领域数据集"
.venv/bin/python training_pipeline_v2/train_yolo.py --task defect --epochs 45 --imgsz 416
.venv/bin/python training_pipeline_v2/train_yolo.py --task distributed_pv --epochs 15 --imgsz 320
.venv/bin/python training_pipeline_v2/train_yolo.py --task panel_segmentation --epochs 8 --imgsz 256 --batch 48
.venv/bin/python training_pipeline_v2/train_cell_classifier.py --epochs 20
.venv/bin/python training_pipeline_v2/train_tabular.py --source "/absolute/path/to/AI+新能源光伏领域数据集"
```

## Completed independent-test results

| Model | Task | Test result | Engineering boundary |
|---|---|---|---|
| `defect_yolo11n_v1` | Visible Crack/Grid/Spot detection | precision 0.8868, recall 0.7730, mAP50 0.8384, mAP50-95 0.4046 | No temperature information; not a hotspot verdict |
| `distributed_pv_yolo11n_v1` | Aerial solar-panel detection | precision 0.6921, recall 0.6776, mAP50 0.7034, mAP50-95 0.4495 | Panel localization only; not a defect verdict |
| `panel_segmentation_yolo11n_v1` | Aerial solar-panel polygon segmentation | mask precision 0.6736, recall 0.4861, mAP50 0.5129, mAP50-95 0.2763 | 8-epoch CPU baseline; validate altitude, view angle and site shift |
| `cell_anomaly_cnn_v1` | EL cell multi-label classification | macro F1 0.7425, exact-match accuracy 0.7781 | Single-cell EL images only; inactive class remains weak |
| `pv_power_hgb_v1` | Sample-domain power regression | MAE 6.2994, RMSE 12.2430, R2 0.9858 | Must be calibrated before cross-site use or settlement |
| `grid_fault_rf_v1` | Simulated waveform classification | accuracy 0.8009, macro F1 0.7646 | Same-source simulation test; not cross-inverter validation |

Each artifact directory contains a model card and the fitted weight/model. YOLO runs additionally retain training curves, confusion matrices, and held-out predictions under `training_pipeline_v2/runs`.
