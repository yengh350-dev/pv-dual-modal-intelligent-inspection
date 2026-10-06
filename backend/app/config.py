from functools import lru_cache
from typing import List, Union

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Sentinel RGBT API"
    app_env: str = "development"
    database_url: str = "sqlite:///./sentinel.db"
    jwt_secret: str = "development-only-secret-change-before-production"
    access_token_minutes: int = Field(default=30, ge=5, le=240)
    refresh_token_days: int = Field(default=7, ge=1, le=30)
    allowed_origins: Union[List[str], str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    ai_provider: str = "demo"
    ai_base_url: str = "https://api.openai.com/v1"
    ai_api_key: str = ""
    ai_model: str = "gpt-5-mini"
    ai_default_provider: str = "demo"
    ai_request_timeout_seconds: int = Field(default=30, ge=5, le=120)
    openai_base_url: str = "https://api.openai.com/v1"
    openai_api_key: str = ""
    openai_model: str = "gpt-5.6-terra"
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-v4-flash"
    doubao_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    doubao_api_key: str = ""
    doubao_model: str = "doubao-seed-2-1-pro-260628"
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_api_key: str = ""
    qwen_model: str = "qwen-plus"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def reject_development_secret_in_production(self):
        if self.app_env.lower() in {"production", "prod"} and self.jwt_secret.startswith("development-only"):
            raise ValueError("生产环境必须配置独立 JWT_SECRET")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
