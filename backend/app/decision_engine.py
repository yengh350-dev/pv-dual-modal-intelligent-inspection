from typing import Any, Iterable


ALGORITHM_VERSION = "evidence-gate-2.0.0"


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _piecewise(value: float, points: Iterable[tuple[float, float]]) -> float:
    """Linear interpolation keeps thresholds explainable and monotonic."""
    ordered = list(points)
    if value <= ordered[0][0]:
        return ordered[0][1]
    for (left_x, left_y), (right_x, right_y) in zip(ordered, ordered[1:]):
        if value <= right_x:
            ratio = (value - left_x) / (right_x - left_x)
            return left_y + ratio * (right_y - left_y)
    return ordered[-1][1]


def _lower_is_better(value: float, best: float, warning: float, failure: float) -> float:
    return _piecewise(value, ((0, 100), (best, 100), (warning, 60), (failure, 0)))


def evaluate_evidence(payload: dict[str, Any]) -> dict[str, Any]:
    """Separate evidence reliability from review urgency and engineering diagnosis."""
    alignment = float(payload["alignment_quality"])
    registration = float(payload["registration_error_px"])
    sync_offset = float(payload["sync_offset_ms"])
    localization = float(payload["localization_accuracy_m"])
    persistent_frames = int(payload["persistent_frames"])
    persistent_seconds = float(payload["persistent_seconds"])
    calibrated = bool(payload["radiometric_calibrated"])
    environment_complete = bool(payload["environment_complete"])
    irradiance = payload.get("irradiance_w_m2")
    uncertainty = float(payload.get("temperature_uncertainty_c", 2.0))
    reflection_risk = float(payload.get("reflection_risk", 0.0))
    occlusion_ratio = float(payload.get("occlusion_ratio", 0.0))
    repeat_observations = int(payload.get("repeat_observations", 1))
    asset_criticality = float(payload.get("asset_criticality", 0.5))

    components = {
        "alignment": round(_piecewise(alignment, ((0.70, 0), (0.85, 60), (0.92, 90), (1.0, 100)))),
        "registration": round(_lower_is_better(registration, 1.0, 3.0, 5.0)),
        "synchronization": round(_lower_is_better(sync_offset, 40.0, 120.0, 250.0)),
        "localization": round(_lower_is_better(localization, 0.5, 2.0, 5.0)),
        "persistence": round(min(
            _piecewise(persistent_frames, ((0, 0), (2, 50), (4, 85), (6, 100))),
            _piecewise(persistent_seconds, ((0, 0), (1, 45), (2.5, 85), (4, 100))),
        )),
        "calibration": 100 if calibrated else 0,
        "environment": 100 if environment_complete else 35,
    }
    weights = {
        "alignment": 0.20,
        "registration": 0.18,
        "synchronization": 0.14,
        "localization": 0.10,
        "persistence": 0.15,
        "calibration": 0.15,
        "environment": 0.08,
    }
    quality_score = round(sum(components[key] * weights[key] for key in components))

    artifact_penalty = round(reflection_risk * 12 + occlusion_ratio * 18)
    reliability_score = round(_clamp((quality_score - artifact_penalty) / 100) * 100)

    blockers: list[str] = []
    warnings: list[str] = []
    if not calibrated:
        blockers.append("热像未完成辐射测温标定，温差不能用于工程分级")
    if alignment < 0.85:
        blockers.append(f"双模态对齐质量 {alignment:.2f} 低于 0.85 门槛")
    if registration > 5.0:
        blockers.append(f"重投影误差 {registration:.1f} px 超过 5.0 px 门槛")
    if sync_offset > 250:
        blockers.append(f"时间偏差 {sync_offset:.0f} ms 超过 250 ms 门槛")
    if persistent_frames < 2:
        blockers.append("热异常仅出现于单帧，缺少跨帧持续性证据")
    if occlusion_ratio >= 0.60:
        blockers.append(f"目标区域遮挡比例 {occlusion_ratio:.0%}，无法形成可复核证据")
    if irradiance is not None and irradiance < 300:
        blockers.append(f"现场辐照度 {irradiance:.0f} W/m² 过低，热异常对比不足")
    if localization > 3.0:
        warnings.append(f"定位误差约 ±{localization:.1f} m，现场查找范围需要扩大")
    if not environment_complete:
        warnings.append("环境温度或辐照度记录不完整，跨任务比较需降级")
    if persistent_frames < 4 or persistent_seconds < 2.5:
        warnings.append("跨帧持续时间偏短，建议补查相邻证据帧")
    if irradiance is not None and 300 <= irradiance < 600:
        warnings.append(f"现场辐照度仅 {irradiance:.0f} W/m²，温差解释需保守")
    if reflection_risk >= 0.35:
        warnings.append(f"反射干扰风险 {reflection_risk:.0%}，需核对视角变化与相邻帧")
    if occlusion_ratio >= 0.20:
        warnings.append(f"目标区域遮挡比例 {occlusion_ratio:.0%}，检测置信度已降权")

    gate_status = "blocked" if blockers else "review" if warnings or reliability_score < 85 else "pass"
    delta_t = float(payload["temperature_delta_c"])
    confidence = float(payload["model_confidence"])

    priority_components = {
        "thermalSeverity": round(_piecewise(max(delta_t, 0), ((0, 0), (3, 10), (5, 25), (10, 55), (15, 80), (20, 100)))),
        "modelSupport": round(_piecewise(confidence, ((0.45, 0), (0.65, 30), (0.80, 70), (0.95, 100)))),
        "persistence": components["persistence"],
        "repeatability": round(_piecewise(repeat_observations, ((0, 0), (1, 35), (2, 70), (3, 100)))),
        "assetCriticality": round(asset_criticality * 100),
    }
    base_priority = (
        priority_components["thermalSeverity"] * 0.42
        + priority_components["modelSupport"] * 0.18
        + priority_components["persistence"] * 0.18
        + priority_components["repeatability"] * 0.12
        + priority_components["assetCriticality"] * 0.10
    )
    uncertainty_penalty = min(25.0, uncertainty * 1.8 + reflection_risk * 10 + occlusion_ratio * 15)
    reliability_factor = 0.55 + 0.45 * reliability_score / 100
    review_priority_score = 0 if gate_status == "blocked" else round(_clamp((base_priority * reliability_factor - uncertainty_penalty) / 100) * 100)

    if gate_status == "blocked":
        priority, next_action = "unrated", "补齐采集条件或安排复飞，当前证据不进入故障分级"
    elif review_priority_score >= 75:
        priority, next_action = "critical_review", "优先人工复核；确认后创建现场电气复测工单"
    elif review_priority_score >= 55:
        priority, next_action = "high_review", "当班复核，并检查同组串相邻组件与连接器"
    elif review_priority_score >= 35:
        priority, next_action = "medium_review", "纳入本批次复核，结合污染、遮挡和反射情况判断"
    else:
        priority, next_action = "observe", "保留证据并观察趋势，暂不自动生成维修工单"

    effective_uncertainty = max(uncertainty, abs(delta_t) * (1 - reliability_score / 100) * 0.4)
    delta_interval = [round(delta_t - effective_uncertainty, 1), round(delta_t + effective_uncertainty, 1)]
    can_review = gate_status != "blocked"
    can_create_work_order = can_review and review_priority_score >= 35

    findings = [
        f"温差 ΔT {delta_t:.1f}°C，模型置信度 {confidence:.2f}",
        f"连续 {persistent_frames} 帧 / {persistent_seconds:.1f} 秒，配准误差 {registration:.1f} px",
        f"温差区间 {delta_interval[0]:.1f}–{delta_interval[1]:.1f}°C，复核紧迫度 {review_priority_score}/100",
    ]
    if blockers:
        findings.extend(blockers)
    else:
        findings.append("质量门控未发现阻断项；结果仍需人工工程复核")

    return {
        "algorithmVersion": ALGORITHM_VERSION,
        "qualityScore": quality_score,
        "reliabilityScore": reliability_score,
        "reviewPriorityScore": review_priority_score,
        "gateStatus": gate_status,
        "priority": priority,
        "components": components,
        "priorityComponents": priority_components,
        "temperatureDeltaIntervalC": delta_interval,
        "actionEligibility": {
            "canReview": can_review,
            "canCreateWorkOrder": can_create_work_order,
            "requiresReflight": gate_status == "blocked",
            "requiresHumanReview": True,
        },
        "findings": findings,
        "warnings": warnings,
        "blockers": blockers,
        "nextAction": next_action,
        "automaticFaultConclusion": False,
        "decisionBoundary": "质量分衡量证据是否可用，紧迫度只决定复核顺序；两者都不等同于电气故障概率，最终结论需结合现场复测。",
    }


def evaluate_mission_quality(payload: dict[str, Any]) -> dict[str, Any]:
    """Gate a flight batch before its frames enter defect analysis."""
    components = {
        "routeTracking": round(_lower_is_better(float(payload["crossTrackP95M"]), 0.25, 0.75, 1.50)),
        "rtkAvailability": round(_piecewise(float(payload["rtkFixRatePct"]), ((60, 0), (90, 60), (98, 90), (100, 100)))),
        "altitudeStability": round(_lower_is_better(float(payload["altitudeP95M"]), 0.8, 1.5, 3.0)),
        "geotagAccuracy": round(_lower_is_better(float(payload["geotagP95M"]), 0.10, 0.50, 2.0)),
        "pairCompleteness": round(_piecewise(float(payload["rgbThermalPairRatePct"]), ((90, 0), (95, 60), (98, 90), (100, 100)))),
        "pairSynchronization": round(_lower_is_better(float(payload["pairTimeSkewP95Ms"]), 40, 120, 250)),
        "viewGeometry": round(_piecewise(float(payload["minimumViewAngleDeg"]), ((45, 0), (55, 60), (65, 90), (75, 100)))),
    }
    weights = {
        "routeTracking": 0.18, "rtkAvailability": 0.16, "altitudeStability": 0.10,
        "geotagAccuracy": 0.12, "pairCompleteness": 0.18, "pairSynchronization": 0.14,
        "viewGeometry": 0.12,
    }
    score = round(sum(components[key] * weights[key] for key in components))
    blockers: list[str] = []
    warnings: list[str] = []
    if float(payload["crossTrackP95M"]) > 2.0:
        blockers.append("航迹横向偏差 P95 超过 2.0 m，组件定位关联不可靠")
    if float(payload["rtkFixRatePct"]) < 70:
        blockers.append("RTK 固定解占比低于 70%，无法稳定回写组件位置")
    if float(payload["rgbThermalPairRatePct"]) < 90:
        blockers.append("RGB-Thermal 完整配对率低于 90%")
    if float(payload["pairTimeSkewP95Ms"]) > 250:
        blockers.append("双模态时间偏差 P95 超过 250 ms")
    if float(payload["minimumViewAngleDeg"]) < 45:
        blockers.append("最小观测角小于 45°，反射与透视畸变风险过高")
    if 70 <= float(payload["rtkFixRatePct"]) < 95:
        warnings.append("部分航段未保持 RTK 固定解，需扩大现场定位搜索范围")
    if 90 <= float(payload["rgbThermalPairRatePct"]) < 97:
        warnings.append("双模态配对存在缺口，未配对帧不进入融合分析")
    if float(payload["crossTrackP95M"]) > 0.75:
        warnings.append("航迹偏差偏高，建议对偏离航段执行局部复飞")
    if float(payload["minimumViewAngleDeg"]) < 60:
        warnings.append("部分画面观测角偏低，反射风险需在证据复核时单独检查")
    status = "blocked" if blockers else "conditional" if warnings or score < 85 else "pass"
    usable_pair_rate = float(payload["rgbThermalPairRatePct"]) * min(
        components["routeTracking"], components["rtkAvailability"], components["viewGeometry"]
    ) / 100
    return {
        "algorithmVersion": ALGORITHM_VERSION,
        "status": status,
        "score": score,
        "components": components,
        "estimatedReviewablePairRatePct": round(usable_pair_rate, 1),
        "blockers": blockers,
        "warnings": warnings,
        "nextAction": "整批阻断并复飞关键航段" if blockers else "隔离低质量航段后进入分析" if status == "conditional" else "允许进入缺陷候选分析",
        "analysisAllowed": not blockers,
    }
