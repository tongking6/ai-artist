from __future__ import annotations

from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_home_manifest_uses_linux_server_images_without_local_profile() -> None:
    applications = (
        REPOSITORY_ROOT / "infra/kubernetes/base/applications.yaml"
    ).read_text()

    assert "image: ai-artist-ui:m1" in applications
    assert applications.count("image: ai-artist-backend:m1") == 3
    assert ":local" not in applications
    assert not (REPOSITORY_ROOT / "infra/kubernetes/overlays/local").exists()
