#!/usr/bin/env bash

set -euo pipefail

namespace="ai-artist"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
storage_class="ai-artist-owned-local-path"
storage_root="/data/ai-artist/k3s-storage"
storage_path_pattern='{{ .PVC.Namespace }}/{{ .PVC.Name }}/{{ .PVName }}/'
storage_provisioner="ai-artist.io/local-path"
storage_provisioner_deployment="ai-artist-local-path-provisioner"
image_tag=""
ui_image=""
backend_image=""
image_archive=""
render_root=""

cleanup() {
  if [[ -n "$image_archive" && -f "$image_archive" ]]; then
    rm -f -- "$image_archive"
  fi
  if [[ "$render_root" == /tmp/ai-artist-render.* && -d "$render_root" ]]; then
    rm -rf -- "$render_root"
  fi
}

trap cleanup EXIT

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 1
  fi
}

kube() {
  sudo k3s kubectl "$@"
}

resolve_image_tag() {
  require_tool git
  image_tag="$(git -C "$repo_root" rev-parse --short=12 HEAD)"
  if [[ ! "$image_tag" =~ ^[0-9a-f]{12}$ ]]; then
    echo "Unable to derive an immutable image tag from Git HEAD." >&2
    exit 1
  fi
  ui_image="ai-artist-ui:${image_tag}"
  backend_image="ai-artist-backend:${image_tag}"
}

require_clean_commit() {
  if [[ -n "$(git -C "$repo_root" status --porcelain)" ]]; then
    echo "Deployment requires a clean Git checkout so the image tag identifies exact source." >&2
    exit 1
  fi
}

prepare_render_tree() {
  require_tool cp
  require_tool sed
  render_root="$(mktemp -d /tmp/ai-artist-render.XXXXXX)"
  cp -R "$repo_root/infra/kubernetes/." "$render_root/"
  local kustomization temporary
  kustomization="$render_root/overlays/home/kustomization.yaml"
  temporary="${kustomization}.tmp"
  sed "s/__AI_ARTIST_IMAGE_TAG__/${image_tag}/g" "$kustomization" >"$temporary"
  mv -- "$temporary" "$kustomization"
  if grep -F "__AI_ARTIST_IMAGE_TAG__" "$kustomization" >/dev/null; then
    echo "Image tag placeholder was not replaced." >&2
    exit 1
  fi
}

preflight() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "This workflow must run on the Linux K3s server." >&2
    exit 1
  fi
  require_tool k3s
  require_tool findmnt
  require_tool install
  require_tool sudo
  if ! sudo test -r /etc/rancher/k3s/config.yaml; then
    echo "Missing readable K3s config: /etc/rancher/k3s/config.yaml" >&2
    exit 1
  fi
  if ! sudo grep -Eq '^[[:space:]]*-[[:space:]]*servicelb[[:space:]]*$' /etc/rancher/k3s/config.yaml; then
    echo "K3s config must disable servicelb before AI Artist is deployed." >&2
    exit 1
  fi
  if ! sudo grep -Eq '^[[:space:]]*-[[:space:]]*nodeport-addresses=127\.0\.0\.0/8[[:space:]]*$' /etc/rancher/k3s/config.yaml; then
    echo "K3s config must restrict NodePort addresses to 127.0.0.0/8." >&2
    exit 1
  fi
  sudo install -d -m 0755 "$storage_root"
  local storage_mount
  storage_mount="$(sudo findmnt -n -o TARGET --target "$storage_root")"
  if [[ -z "$storage_mount" || "$storage_mount" == "/" ]]; then
    echo "$storage_root must resolve to the dedicated /data SSD mount, not the root filesystem." >&2
    exit 1
  fi
  kube get nodes >/dev/null
}

verify_storage_class() {
  local provisioner node_path path_pattern
  provisioner="$(kube get storageclass "$storage_class" -o jsonpath='{.provisioner}')"
  node_path="$(kube get storageclass "$storage_class" -o jsonpath='{.parameters.nodePath}')"
  path_pattern="$(kube get storageclass "$storage_class" -o jsonpath='{.parameters.pathPattern}')"
  if [[ "$provisioner" != "$storage_provisioner" || "$node_path" != "$storage_root" || "$path_pattern" != "$storage_path_pattern" ]]; then
    echo "StorageClass $storage_class must be the repo-owned $storage_provisioner class rooted at $storage_root." >&2
    echo "Back up required data and reconcile the StorageClass/PVCs manually; deployment will not migrate or delete existing volumes." >&2
    exit 1
  fi
}

verify_pvc_storage_class() {
  local pvc_name="$1"
  local pvc_storage_class
  pvc_storage_class="$(kube get pvc "$pvc_name" -n "$namespace" -o jsonpath='{.spec.storageClassName}')"
  if [[ "$pvc_storage_class" != "$storage_class" ]]; then
    echo "PVC $pvc_name uses $pvc_storage_class instead of $storage_class." >&2
    echo "Back up any required data, then explicitly remove the legacy StatefulSets/PVCs before redeploying." >&2
    exit 1
  fi
}

verify_pvc_storage() {
  local pvc_name="$1"
  local pv_name pv_path
  verify_pvc_storage_class "$pvc_name"
  pv_name="$(kube get pvc "$pvc_name" -n "$namespace" -o jsonpath='{.spec.volumeName}')"
  if [[ -z "$pv_name" ]]; then
    echo "PVC $pvc_name is not bound to a PersistentVolume." >&2
    exit 1
  fi
  pv_path="$(kube get pv "$pv_name" -o jsonpath='{.spec.hostPath.path}{.spec.local.path}')"
  if [[ "$pv_path" != "$storage_root" && "$pv_path" != "$storage_root/"* ]]; then
    echo "PV $pv_name resolves to $pv_path instead of $storage_root." >&2
    exit 1
  fi
}

check_existing_storage() {
  local pvc_name pvc_phase pv_name
  for pvc_name in data-postgresql-0 data-minio-0; do
    if kube get pvc "$pvc_name" -n "$namespace" >/dev/null 2>&1; then
      verify_pvc_storage_class "$pvc_name"
      pv_name="$(kube get pvc "$pvc_name" -n "$namespace" -o jsonpath='{.spec.volumeName}')"
      if [[ -z "$pv_name" ]]; then
        pvc_phase="$(kube get pvc "$pvc_name" -n "$namespace" -o jsonpath='{.status.phase}')"
        if [[ "$pvc_phase" == "Pending" ]]; then
          continue
        fi
        echo "PVC $pvc_name is unbound with unexpected phase $pvc_phase." >&2
        exit 1
      fi
      verify_pvc_storage "$pvc_name"
    fi
  done
}

check_existing_storage_class() {
  if kube get storageclass "$storage_class" >/dev/null 2>&1; then
    verify_storage_class
  fi
}

verify_storage() {
  verify_pvc_storage data-postgresql-0
  verify_pvc_storage data-minio-0
}

ensure_secret() {
  kube apply -f "$repo_root/infra/kubernetes/base/namespace.yaml"
  if kube get secret ai-artist-secrets -n "$namespace" >/dev/null 2>&1; then
    return
  fi
  local postgres_password minio_password
  postgres_password="$(openssl rand -hex 18)"
  minio_password="$(openssl rand -hex 18)"
  kube create secret generic ai-artist-secrets \
    -n "$namespace" \
    --from-literal=POSTGRES_USER=ai_artist \
    --from-literal=POSTGRES_PASSWORD="$postgres_password" \
    --from-literal=POSTGRES_DB=ai_artist \
    --from-literal=MINIO_ROOT_USER=ai_artist_home \
    --from-literal=MINIO_ROOT_PASSWORD="$minio_password"
}

build_and_import_images() {
  image_archive="$(mktemp --suffix=.tar /tmp/ai-artist-images.XXXXXX)"

  docker build -t "$ui_image" "$repo_root/ui"
  docker build -t "$backend_image" "$repo_root/services/backend"
  docker save --output "$image_archive" "$ui_image" "$backend_image"
  sudo k3s ctr -n k8s.io images import "$image_archive"
  sudo k3s ctr -n k8s.io images list | grep -F "docker.io/library/$ui_image" >/dev/null
  sudo k3s ctr -n k8s.io images list | grep -F "docker.io/library/$backend_image" >/dev/null
  rm -f -- "$image_archive"
  image_archive=""
}

verify_running_images() {
  local actual
  actual="$(kube get deployment website -n "$namespace" -o jsonpath='{.spec.template.spec.containers[0].image}')"
  [[ "$actual" == "$ui_image" ]] || { echo "Website image mismatch: $actual" >&2; exit 1; }
  actual="$(kube get deployment backend-api -n "$namespace" -o jsonpath='{.spec.template.spec.containers[0].image}')"
  [[ "$actual" == "$backend_image" ]] || { echo "Backend image mismatch: $actual" >&2; exit 1; }
  actual="$(kube get deployment backend-api -n "$namespace" -o jsonpath='{.spec.template.spec.initContainers[0].image}')"
  [[ "$actual" == "$backend_image" ]] || { echo "Migration image mismatch: $actual" >&2; exit 1; }
  actual="$(kube get deployment generation-worker -n "$namespace" -o jsonpath='{.spec.template.spec.containers[0].image}')"
  [[ "$actual" == "$backend_image" ]] || { echo "Worker image mismatch: $actual" >&2; exit 1; }
}

deploy() {
  preflight
  require_tool curl
  require_tool docker
  require_tool openssl
  docker info >/dev/null
  resolve_image_tag
  require_clean_commit
  prepare_render_tree
  check_existing_storage
  check_existing_storage_class
  ensure_secret
  build_and_import_images
  kube apply -k "$render_root/overlays/home"
  verify_storage_class
  kube rollout status "deployment/$storage_provisioner_deployment" -n "$namespace" --timeout=300s
  kube rollout restart deployment/backend-api deployment/generation-worker deployment/website -n "$namespace"
  kube rollout status statefulset/postgresql -n "$namespace" --timeout=300s
  kube rollout status statefulset/minio -n "$namespace" --timeout=300s
  kube rollout status deployment/backend-api -n "$namespace" --timeout=300s
  kube rollout status deployment/generation-worker -n "$namespace" --timeout=300s
  kube rollout status deployment/website -n "$namespace" --timeout=300s
  verify_storage
  verify_running_images
  smoke
}

smoke() {
  require_tool curl
  curl --fail --silent --show-error http://127.0.0.1:30080/ >/dev/null
  curl --fail --silent --show-error http://127.0.0.1:30080/app-config.js | grep -F "demoMode: false" >/dev/null
  curl --fail --silent --show-error "http://127.0.0.1:30080/v1/tasks?limit=1" >/dev/null
  echo "AI Artist K3s smoke check passed on http://127.0.0.1:30080"
}

case "${1:-deploy}" in
  deploy)
    deploy
    ;;
  status)
    preflight
    kube get pods,services,ingress,pvc -n "$namespace"
    verify_storage_class
    check_existing_storage
    ;;
  logs)
    preflight
    kube logs -n "$namespace" deployment/backend-api --tail=100
    kube logs -n "$namespace" deployment/generation-worker --tail=100
    ;;
  smoke)
    preflight
    smoke
    ;;
  configure-serve)
    preflight
    require_tool tailscale
    sudo tailscale serve --bg --https=443 http://127.0.0.1:30080
    sudo tailscale serve status
    ;;
  render)
    require_tool kubectl
    resolve_image_tag
    prepare_render_tree
    kubectl kustomize "$render_root/overlays/home"
    ;;
  *)
    echo "Usage: $0 {deploy|status|logs|smoke|configure-serve|render}" >&2
    exit 1
    ;;
esac
