from __future__ import annotations

from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_home_manifest_uses_commit_tag_placeholder_without_local_profile() -> None:
    applications = (
        REPOSITORY_ROOT / "infra/kubernetes/base/applications.yaml"
    ).read_text()
    home_kustomization = (
        REPOSITORY_ROOT / "infra/kubernetes/overlays/home/kustomization.yaml"
    ).read_text()
    deploy_script = (REPOSITORY_ROOT / "scripts/linux-k3s.sh").read_text()

    assert "image: ai-artist-ui:replace-me" in applications
    assert applications.count("image: ai-artist-backend:replace-me") == 3
    assert home_kustomization.count("newTag: __AI_ARTIST_IMAGE_TAG__") == 2
    assert "rev-parse --short=12 HEAD" in deploy_script
    assert 'ui_image="ai-artist-ui:${image_tag}"' in deploy_script
    assert 'backend_image="ai-artist-backend:${image_tag}"' in deploy_script
    assert ":local" not in applications
    assert not (REPOSITORY_ROOT / "infra/kubernetes/overlays/local").exists()


def test_home_storage_class_is_pinned_to_the_ssd_path() -> None:
    storage_class = (
        REPOSITORY_ROOT / "infra/kubernetes/overlays/home/storage-class.yaml"
    ).read_text()
    storage_patch = (
        REPOSITORY_ROOT / "infra/kubernetes/overlays/home/storage-patch.yaml"
    ).read_text()
    deploy_script = (REPOSITORY_ROOT / "scripts/linux-k3s.sh").read_text()

    assert "name: ai-artist-owned-local-path" in storage_class
    assert "provisioner: ai-artist.io/local-path" in storage_class
    assert "nodePath: /data/ai-artist/k3s-storage" in storage_class
    assert (
        'pathPattern: "{{ .PVC.Namespace }}/{{ .PVC.Name }}/{{ .PVName }}/"'
        in storage_class
    )
    assert (
        'pathPattern: "{{ .PVC.Namespace }}/{{ .PVC.Name }}/"' not in storage_class
    )
    assert storage_patch.count("storageClassName: ai-artist-owned-local-path") == 2
    assert "storage_root=\"/data/ai-artist/k3s-storage\"" in deploy_script
    assert "spec.hostPath.path" in deploy_script


def test_backend_log_level_uses_the_settings_env_prefix() -> None:
    config = (REPOSITORY_ROOT / "infra/kubernetes/base/config.yaml").read_text()

    assert "AI_ARTIST_LOG_LEVEL: INFO" in config
    assert "\n  LOG_LEVEL: INFO" not in config


def test_openai_key_is_referenced_only_by_the_generation_worker() -> None:
    applications = (REPOSITORY_ROOT / "infra/kubernetes/base/applications.yaml").read_text()
    backend_api, generation_worker = applications.split("name: generation-worker", maxsplit=1)

    assert "OPENAI_API_KEY" not in backend_api
    assert "name: OPENAI_API_KEY" in generation_worker
    assert "name: ai-artist-openai" in generation_worker
    assert "optional: true" in generation_worker


def test_openai_deploy_preflight_checks_the_key_without_printing_it() -> None:
    deploy_script = (REPOSITORY_ROOT / "scripts/linux-k3s.sh").read_text()

    assert "-o jsonpath='{.data.OPENAI_API_KEY}'" in deploy_script
    assert '[[ -z "$encoded_key" ]]' in deploy_script
    assert "go-template=" not in deploy_script
