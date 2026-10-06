"""Explicitly test a LOCAL demo API; creates a marked test task and work order."""
import argparse
import hashlib
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8018/api/v1")
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if urlsplit(args.base).hostname not in {"127.0.0.1", "localhost"}:
        raise ValueError("This smoke test is restricted to a local demo API")
    with httpx.Client(base_url=args.base + "/", timeout=60, trust_env=False) as client:
        login = client.post("auth/login", json={"email":"admin@sentinel-rgbt.com", "password":"Sentinel123!"})
        login.raise_for_status()
        client.headers["Authorization"] = "Bearer " + login.json()["data"]["accessToken"]
        mission = client.post("missions", json={"name":"分析闭环回归 · 非现场任务", "site":"测试数据集场站",
            "aircraft":"未连接设备", "payload":"THERMAL 测试数据"})
        mission.raise_for_status()
        mission_id = mission.json()["data"]["id"]
        raw = args.image.read_bytes()
        fields = {"mission_id":mission_id, "modality":"THERMAL", "idempotency_key":str(uuid4()),
                  "metadata":json.dumps({"source_name":"数据集闭环验证 · 非实时飞行"}, ensure_ascii=False)}
        first = client.post("analysis/tasks", data=fields, files={"image":("frame.jpg", raw, "image/jpeg")})
        first.raise_for_status()
        task_id = first.json()["data"]["id"]
        duplicate = client.post("analysis/tasks", data=fields, files={"image":("frame.jpg", raw, "image/jpeg")})
        assert duplicate.json()["data"]["id"] == task_id and duplicate.json()["existing"]
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            response = client.get("analysis/tasks/" + task_id)
            response.raise_for_status()
            task = response.json()["data"]
            if task["state"] in {"succeeded", "failed", "cancelled"}:
                break
            time.sleep(.5)
        assert task["state"] == "succeeded", task
        assert task["result"]["lineage"][0]["sha256"] == hashlib.sha256(raw).hexdigest()
        prediction = task["observation"]["prediction"]
        assert prediction["parameters"]["profile"] == "precision"
        assert prediction["parameters"]["imgsz"] == 416
        assert prediction["weightsSha256"]
        assert prediction["count"] > 0, "Choose a test image with above-threshold candidates to exercise dispatch"
        observation_id = task["observationId"]
        dispatch_fields = {"detection_index":0,"location":"测试数据集样本 · 仅流程验证，不是现场定位",
            "review_note":"回归测试确认流程可执行，不能据此确认现场故障。", "owner":"测试执行", "reviewer":"测试验收",
            "priority":"低", "due_at":(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()}
        dispatch = client.post("live/observations/" + observation_id + "/dispatch", json=dispatch_fields)
        dispatch.raise_for_status()
        again = client.post("live/observations/" + observation_id + "/dispatch", json=dispatch_fields)
        assert again.json()["data"]["id"] == dispatch.json()["data"]["id"] and again.json()["data"]["existing"]
        exported = client.get("analysis/tasks/" + task_id + "/export")
        exported.raise_for_status()
        assert exported.json()["review"]["workOrderId"] == dispatch.json()["data"]["id"]
        report = {"taskId":task_id,"missionId":mission_id,"observationId":observation_id,
            "workOrderId":dispatch.json()["data"]["id"],"state":task["state"],"count":prediction["count"],
            "weightsSha256":prediction["weightsSha256"],"timing":task["result"]["timing"],
            "checks":["enqueue", "idempotent submission", "real inference", "image hash", "native profile",
                      "review to work order", "idempotent dispatch", "versioned export"],"boundary":"本地演示库测试；无真实飞行、温度或位置结论。"}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
