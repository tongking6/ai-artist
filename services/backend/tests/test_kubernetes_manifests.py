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

    assert "name: ai-artist-local-path" in storage_class
    assert "provisioner: rancher.io/local-path" in storage_class
    assert "nodePath: /data/ai-artist/k3s-storage" in storage_class
    assert (
        'pathPattern: "{{ .PVC.Namespace }}/{{ .PVC.Name }}/{{ .PVName }}/"'
        in storage_class
    )
    assert (
        'pathPattern: "{{ .PVC.Namespace }}/{{ .PVC.Name }}/"' not in storage_class
    )
    assert storage_patch.count("storageClassName: ai-artist-local-path") == 2
    assert "default-local-storage-path" in deploy_script
    assert "spec.hostPath.path" in deploy_script
