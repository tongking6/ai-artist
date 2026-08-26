from __future__ import annotations

import io

from PIL import Image

from ai_artist.adapters.generation import FakeGenerationProvider, GeneratePostcardInput
from ai_artist.worker import normalize_postcard


def test_fake_provider_is_deterministic_and_exercises_normalization() -> None:
    source = _png((32, 24), (120, 80, 40))
    input_data = GeneratePostcardInput(
        snapshot={
            "task_id": "task_1",
            "title": "Kyoto",
            "prompt_recipe_version": "m1.postcard_prompt.v1",
        },
        source_photos=(source,),
    )
    provider = FakeGenerationProvider()

    first = provider.generate_postcard(input_data).png_bytes
    second = provider.generate_postcard(input_data).png_bytes

    assert first == second
    with Image.open(io.BytesIO(first)) as generated:
        assert generated.format == "PNG"
        assert generated.size == (1808, 1200)

    normalized = normalize_postcard(first)
    with Image.open(io.BytesIO(normalized)) as postcard:
        assert postcard.format == "PNG"
        assert postcard.size == (1800, 1200)


def test_fake_provider_changes_when_the_snapshot_changes() -> None:
    provider = FakeGenerationProvider()
    source = _png((12, 12), (1, 2, 3))
    first = provider.generate_postcard(
        GeneratePostcardInput(snapshot={"title": "Kyoto"}, source_photos=(source,))
    )
    second = provider.generate_postcard(
        GeneratePostcardInput(snapshot={"title": "Osaka"}, source_photos=(source,))
    )
    assert first.png_bytes != second.png_bytes


def _png(size: tuple[int, int], color: tuple[int, int, int]) -> bytes:
    image = Image.new("RGB", size, color)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()
