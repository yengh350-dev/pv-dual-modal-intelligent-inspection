from copy import deepcopy
from fastapi import HTTPException


def default_details():
    return {
        "reviewer": "", "requirements": "", "notes": "",
        "checklist": [
            {"id": "safety", "label": "完成现场作业安全确认", "done": False},
            {"id": "measure", "label": "记录现场复测结果", "done": False},
            {"id": "evidence", "label": "核对处置前后证据", "done": False},
            {"id": "resolution", "label": "填写处置结论与遗留问题", "done": False},
        ],
    }


def validate_update(order, details, payload):
    if order.status in {"已关闭", "已取消"} and payload.model_dump(exclude_none=True).keys() - {"expected_revision"}:
        raise HTTPException(409, "终态工单不可直接修改")
    updated = deepcopy(details)
    for field in ("reviewer", "notes"):
        value = getattr(payload, field)
        if value is not None:
            updated[field] = value
    if payload.checklist is not None:
        supplied = {item.id: item.model_dump() for item in payload.checklist}
        expected = {item["id"] for item in details["checklist"]}
        if len(supplied) != len(payload.checklist) or set(supplied) != expected:
            raise HTTPException(422, "作业清单项目不能删除或重复")
        updated["checklist"] = [
            {**item, "done": supplied[item["id"]]["done"]} for item in details["checklist"]
        ]
    resolution = (payload.resolution if payload.resolution is not None else order.resolution or "").strip()
    if payload.status in {"待验收", "已关闭"}:
        if not all(item["done"] for item in updated["checklist"]) or not resolution:
            raise HTTPException(422, "提交验收前须完成全部作业清单并填写处置结论")
        if not updated["reviewer"].strip():
            raise HTTPException(422, "请指定验收负责人")
        owner = payload.owner if payload.owner is not None else order.owner
        if updated["reviewer"] == owner:
            raise HTTPException(422, "执行负责人和验收负责人不能为同一人")
    if payload.status == "已取消" and not resolution:
        raise HTTPException(422, "取消工单必须填写原因")
    return updated
