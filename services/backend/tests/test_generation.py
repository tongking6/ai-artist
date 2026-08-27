from __future__ import annotations

import io
from base64 import b64encode
from threading import Event
from types import SimpleNamespace
from typing import Any, cast

import pytest
from PIL import Image

from ai_artist import worker
from ai_artist.adapters import generation
from ai_artist.adapters.generation import (
    FakeGenerationProvider,
    GeneratePostcardInput,
    OpenAIGenerationProvider,
)
from ai_artist.config import Settings
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


def test_openai_provider_builds_the_fixed_edit_request_for_all_source_photos(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class Client:
        def __init__(self, **kwargs: object) -> None:
            assert kwargs == {"max_retries": 0, "timeout": 480}
            self.images = SimpleNamespace(edit=self.edit)

        def edit(self, **kwargs: object) -> object:
            calls.append(kwargs)
            return SimpleNamespace(
                data=[SimpleNamespace(b64_json=b64encode(_png((1808, 1200), (1, 2, 3))).decode())],
                _request_id="req_postcard",
            )

    monkeypatch.setattr(generation, "OpenAI", Client)
    provider = OpenAIGenerationProvider()
    generated = provider.generate_postcard(
        GeneratePostcardInput(
            snapshot={
                "title": "A <different> title",
                "note": "Keep the lake",
                "refinement_note": "Use softer colors",
            },
            source_photos=tuple(_png((12, 12), (index, 2, 3)) for index in range(1, 6)),
        )
    )

    assert generated.provider_request_id == "req_postcard"
    assert len(calls) == 1
    request = cast(dict[str, Any], calls[0])
    assert request["model"] == "gpt-image-2-2026-04-21"
    assert request["n"] == 1
    assert request["quality"] == "medium"
    assert request["size"] == "1808x1200"
    assert request["output_format"] == "png"
    images = cast(list[tuple[str, bytes, str]], request["image"])
    assert [image[0] for image in images] == [
        "reference-1.png",
        "reference-2.png",
        "reference-3.png",
        "reference-4.png",
        "reference-5.png",
    ]
    prompt = cast(str, request["prompt"])
    assert "NON-NEGOTIABLE PRESERVATION" in prompt
    assert "<customer_title>A <different> title</customer_title>" in prompt
    assert "Do not render the title" in prompt


def test_openai_provider_rejects_invalid_input_or_response(monkeypatch: pytest.MonkeyPatch) -> None:
    class Client:
        def __init__(self, **kwargs: object) -> None:
            self.images = SimpleNamespace(edit=lambda **_: SimpleNamespace(data=[]))

    monkeypatch.setattr(generation, "OpenAI", Client)
    provider = OpenAIGenerationProvider()
    with pytest.raises(RuntimeError, match="one to five"):
        provider.generate_postcard(GeneratePostcardInput(snapshot={}, source_photos=()))
    with pytest.raises(RuntimeError, match="no postcard image"):
        provider.generate_postcard(
            GeneratePostcardInput(snapshot={}, source_photos=(_png((12, 12), (1, 2, 3)),))
        )


def test_worker_selects_openai_provider_only_when_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = object()

    monkeypatch.setattr(worker, "OpenAIGenerationProvider", lambda **_: expected)
    assert worker._provider_for(Settings(generation_provider="openai")) is expected
    assert isinstance(worker._provider_for(Settings()), FakeGenerationProvider)


def test_reconcile_loop_uses_the_configured_interval(
    monkeypatch,
) -> None:
    stop_event = Event()
    waits: list[float] = []
    calls = 0

    def reconcile_once() -> None:
        nonlocal calls
        calls += 1

    def wait(timeout: float | None = None) -> bool:
        assert timeout is not None
        waits.append(timeout)
        return True

    monkeypatch.setattr(worker, "_reconcile_once", reconcile_once)
    monkeypatch.setattr(stop_event, "wait", wait)

    worker._reconcile_loop(
        Settings(attempt_reconcile_interval_seconds=17),
        stop_event,
    )

    assert calls == 1
    assert waits == [17]


def _png(size: tuple[int, int], color: tuple[int, int, int]) -> bytes:
    image = Image.new("RGB", size, color)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()
