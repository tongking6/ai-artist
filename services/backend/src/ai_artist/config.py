from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AI_ARTIST_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    stage: str = "local"
    database_url: str = "postgresql+psycopg://ai_artist:ai_artist@postgresql:5432/ai_artist"
    object_endpoint: str = "http://minio:9000"
    object_presign_endpoint: str = "http://localhost:8080"
    object_addressing_style: str = "path"
    private_bucket: str = "ai-artist-private"
    object_access_key: str = "ai-artist-local"
    object_secret_key: str = "ai-artist-local-secret"
    upload_url_ttl_seconds: int = Field(default=900, ge=60, le=3600)
    download_url_ttl_seconds: int = Field(default=900, ge=60, le=3600)
    attempt_lease_seconds: int = Field(default=600, ge=60, le=3600)
    attempt_reconcile_interval_seconds: int = Field(default=60, ge=5, le=600)
    generation_provider: str = "fake"
    openai_image_model: str = "gpt-image-2-2026-04-21"
    provider_timeout_seconds: int = Field(default=480, ge=30, le=540)
    log_level: str = "INFO"
    worker_poll_seconds: float = Field(default=1.0, ge=0.1, le=60)

    @property
    def provider_model(self) -> str:
        if self.generation_provider == "fake":
            return "fake-v1"
        if self.generation_provider == "openai":
            return self.openai_image_model
        raise ValueError("AI_ARTIST_GENERATION_PROVIDER must be 'fake' or 'openai'")


@lru_cache
def get_settings() -> Settings:
    return Settings()
