from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass
from typing import Any, Protocol

from PIL import Image, ImageDraw


@dataclass(frozen=True)
class GeneratePostcardInput:
    snapshot: dict[str, Any]
    source_photos: tuple[bytes, ...]


@dataclass(frozen=True)
class GeneratedImage:
    png_bytes: bytes
    provider_request_id: str | None = None


class GenerationProvider(Protocol):
    provider_id: str
    provider_model: str

    def generate_postcard(self, input_data: GeneratePostcardInput) -> GeneratedImage: ...


class FakeGenerationProvider:
    provider_id = "fake"
    provider_model = "fake-v1"

    def generate_postcard(self, input_data: GeneratePostcardInput) -> GeneratedImage:
        digest = hashlib.sha256(
            json.dumps(input_data.snapshot, sort_keys=True, separators=(",", ":")).encode()
            + b"".join(hashlib.sha256(photo).digest() for photo in input_data.source_photos)
        ).digest()
        background = (190 + digest[0] % 40, 175 + digest[1] % 50, 145 + digest[2] % 55)
        accent = (80 + digest[3] % 90, 75 + digest[4] % 80, 55 + digest[5] % 70)
        image = Image.new("RGB", (1808, 1200), background)
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((110, 110, 1698, 1090), radius=70, outline=accent, width=24)
        for index in range(7):
            offset = digest[6 + index] * 4
            x = 180 + (index * 211 + offset) % 1400
            y = 170 + (index * 137 + offset // 2) % 760
            radius = 45 + digest[16 + index] % 95
            fill = (
                min(255, background[0] + digest[23 + index] % 35),
                min(255, background[1] + digest[7 + index] % 30),
                min(255, background[2] + digest[14 + index] % 30),
            )
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=False)
        return GeneratedImage(png_bytes=output.getvalue())
