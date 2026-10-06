def inference_profile(name: str, native_size: int) -> dict:
    profiles = {
        "baseline": {"imgsz": native_size, "max_det": 300},
        "preview": {"imgsz": 320, "max_det": 100},
        "precision": {"imgsz": native_size, "max_det": 300},
    }
    if name not in profiles:
        raise ValueError("Unknown inference profile")
    return profiles[name]
