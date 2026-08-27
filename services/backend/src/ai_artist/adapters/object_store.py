from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from ai_artist.config import Settings


@dataclass(frozen=True)
class StoredObject:
    size_bytes: int
    media_type: str


@dataclass(frozen=True)
class PresignedPost:
    url: str
    fields: dict[str, str]
    expires_at: datetime


class ObjectStore(Protocol):
    def ensure_bucket(self) -> None: ...

    def create_upload(
        self,
        key: str,
        media_type: str,
        max_bytes: int,
        ttl_seconds: int,
    ) -> PresignedPost: ...

    def inspect(self, key: str) -> StoredObject | None: ...

    def copy(self, source_key: str, destination_key: str) -> None: ...

    def get(self, key: str) -> bytes: ...

    def put(self, key: str, body: bytes, media_type: str) -> None: ...

    def delete(self, key: str) -> None: ...

    def create_download(self, key: str, ttl_seconds: int) -> tuple[str, datetime]: ...


class S3ObjectStore:
    def __init__(self, settings: Settings) -> None:
        client_config = Config(
            signature_version="s3v4",
            s3={"addressing_style": settings.object_addressing_style},
        )
        credentials: dict[str, Any] = {
            "aws_access_key_id": settings.object_access_key,
            "aws_secret_access_key": settings.object_secret_key,
            "region_name": "us-east-1",
            "config": client_config,
        }
        self._internal = boto3.client("s3", endpoint_url=settings.object_endpoint, **credentials)
        self._presign = boto3.client(
            "s3", endpoint_url=settings.object_presign_endpoint, **credentials
        )
        self._bucket = settings.private_bucket

    def ensure_bucket(self) -> None:
        try:
            self._internal.head_bucket(Bucket=self._bucket)
        except ClientError as error:
            response_code = error.response.get("Error", {}).get("Code")
            if response_code not in {"404", "NoSuchBucket", "NotFound"}:
                raise
            self._internal.create_bucket(Bucket=self._bucket)

    def create_upload(
        self,
        key: str,
        media_type: str,
        max_bytes: int,
        ttl_seconds: int,
    ) -> PresignedPost:
        expires_at = datetime.now(UTC) + timedelta(seconds=ttl_seconds)
        result = self._presign.generate_presigned_post(
            Bucket=self._bucket,
            Key=key,
            Fields={"Content-Type": media_type},
            Conditions=[
                {"Content-Type": media_type},
                ["content-length-range", 1, max_bytes],
            ],
            ExpiresIn=ttl_seconds,
        )
        return PresignedPost(
            url=str(result["url"]),
            fields={str(name): str(value) for name, value in result["fields"].items()},
            expires_at=expires_at,
        )

    def inspect(self, key: str) -> StoredObject | None:
        try:
            response = self._internal.head_object(Bucket=self._bucket, Key=key)
        except ClientError as error:
            response_code = error.response.get("Error", {}).get("Code")
            if response_code in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise
        return StoredObject(
            size_bytes=int(response["ContentLength"]),
            media_type=str(response.get("ContentType", "application/octet-stream")),
        )

    def get(self, key: str) -> bytes:
        response = self._internal.get_object(Bucket=self._bucket, Key=key)
        return bytes(response["Body"].read())

    def copy(self, source_key: str, destination_key: str) -> None:
        self._internal.copy_object(
            Bucket=self._bucket,
            Key=destination_key,
            CopySource={"Bucket": self._bucket, "Key": source_key},
            MetadataDirective="COPY",
        )

    def put(self, key: str, body: bytes, media_type: str) -> None:
        self._internal.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=body,
            ContentType=media_type,
        )

    def delete(self, key: str) -> None:
        self._internal.delete_object(Bucket=self._bucket, Key=key)

    def create_download(self, key: str, ttl_seconds: int) -> tuple[str, datetime]:
        expires_at = datetime.now(UTC) + timedelta(seconds=ttl_seconds)
        url = self._presign.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=ttl_seconds,
        )
        return url, expires_at
