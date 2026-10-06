from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader, Dataset


SEED = 20260922
CLASSES = ["poly_wafer", "crack", "inactive"]


class CellDataset(Dataset):
    def __init__(self, rows: list[dict[str, str]], augment: bool) -> None:
        self.rows = rows
        self.augment = augment

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int):
        row = self.rows[index]
        image = Image.open(row["filename"]).convert("L").resize((128, 128))
        array = np.asarray(image, dtype=np.float32) / 255.0
        if self.augment:
            if random.random() < 0.5:
                array = np.fliplr(array)
            if random.random() < 0.5:
                array = np.flipud(array)
        array = np.ascontiguousarray((array - 0.5) / 0.5)
        target = np.asarray([float(row[name]) for name in CLASSES], dtype=np.float32)
        return torch.from_numpy(array).unsqueeze(0), torch.from_numpy(target)


class CellAnomalyNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 16, 3, padding=1), nn.BatchNorm2d(16), nn.SiLU(), nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1), nn.BatchNorm2d(32), nn.SiLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.SiLU(), nn.MaxPool2d(2),
            nn.Conv2d(64, 96, 3, padding=1), nn.BatchNorm2d(96), nn.SiLU(), nn.AdaptiveAvgPool2d(1),
        )
        self.classifier = nn.Linear(96, len(CLASSES))

    def forward(self, image):
        return self.classifier(self.features(image).flatten(1))


def scores(logits: torch.Tensor, truth: torch.Tensor) -> dict:
    prediction = (logits.sigmoid() >= 0.5).int().numpy()
    target = truth.int().numpy()
    per_class = {}
    f1_values = []
    for index, name in enumerate(CLASSES):
        tp = int(((prediction[:, index] == 1) & (target[:, index] == 1)).sum())
        fp = int(((prediction[:, index] == 1) & (target[:, index] == 0)).sum())
        fn = int(((prediction[:, index] == 0) & (target[:, index] == 1)).sum())
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class[name] = {"precision": precision, "recall": recall, "f1": f1, "support": int(target[:, index].sum())}
        f1_values.append(f1)
    return {
        "macro_f1": float(np.mean(f1_values)),
        "exact_match_accuracy": float((prediction == target).all(axis=1).mean()),
        "per_class": per_class,
    }


def evaluate(model: nn.Module, loader: DataLoader) -> tuple[float, dict]:
    model.eval(); logits = []; truth = []; total_loss = 0.0
    criterion = nn.BCEWithLogitsLoss()
    with torch.no_grad():
        for image, target in loader:
            output = model(image); total_loss += float(criterion(output, target)) * len(image)
            logits.append(output.cpu()); truth.append(target.cpu())
    metric = scores(torch.cat(logits), torch.cat(truth))
    metric["loss"] = total_loss / len(loader.dataset)
    return metric["macro_f1"], metric


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepared", type=Path, default=Path(__file__).parent / "prepared")
    parser.add_argument("--artifacts", type=Path, default=Path(__file__).parent / "artifacts")
    parser.add_argument("--epochs", type=int, default=20)
    args = parser.parse_args()
    random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
    with (args.prepared / "cell_anomaly" / "labels.csv").open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    split_rows = {split: [row for row in rows if row["split"] == split] for split in ("train", "val", "test")}
    loaders = {
        split: DataLoader(CellDataset(values, split == "train"), batch_size=64, shuffle=split == "train", num_workers=0)
        for split, values in split_rows.items()
    }
    model = CellAnomalyNet()
    positives = torch.tensor([[float(row[name]) for name in CLASSES] for row in split_rows["train"]]).sum(0)
    pos_weight = (len(split_rows["train"]) - positives) / positives.clamp_min(1)
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    best_state = None; best_f1 = -1.0; patience = 0; history = []
    for epoch in range(1, args.epochs + 1):
        model.train(); running = 0.0
        for image, target in loaders["train"]:
            optimizer.zero_grad(); output = model(image); loss = criterion(output, target)
            loss.backward(); optimizer.step(); running += float(loss) * len(image)
        val_f1, val_metric = evaluate(model, loaders["val"])
        history.append({"epoch": epoch, "train_loss": running / len(loaders["train"].dataset), "val": val_metric})
        print(f"epoch={epoch} train_loss={history[-1]['train_loss']:.4f} val_macro_f1={val_f1:.4f}", flush=True)
        if val_f1 > best_f1 + 1e-4:
            best_f1 = val_f1; best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}; patience = 0
        else:
            patience += 1
            if patience >= 6:
                break
    model.load_state_dict(best_state)
    _, test_metric = evaluate(model, loaders["test"])
    artifact = args.artifacts / "cell_anomaly_cnn_v1"; artifact.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), artifact / "model_state.pt")
    model.eval(); scripted = torch.jit.trace(model, torch.zeros(1, 1, 128, 128)); scripted.save(str(artifact / "model.torchscript.pt"))
    card = {
        "model_id": "cell_anomaly_cnn_v1", "task": "multilabel_classification", "architecture": "4-block compact CNN",
        "classes": CLASSES, "input": {"channels": 1, "size": [128, 128]}, "seed": SEED,
        "best_validation_macro_f1": best_f1, "test": test_metric, "epochs_completed": len(history),
        "boundary": "电致发光电池片图像模型，不适用于无人机 RGB 或热红外场景。",
    }
    (artifact / "model_card.json").write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    (artifact / "history.json").write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(card, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
