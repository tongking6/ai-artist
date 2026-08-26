#!/usr/bin/env bash

set -euo pipefail

namespace="ai-artist"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
ui_image="ai-artist-ui:m1"
backend_image="ai-artist-backend:m1"
image_archive=""

cleanup_image_archive() {
  if [[ -n "$image_archive" && -f "$image_archive" ]]; then
    rm -f -- "$image_archive"
  fi
}

trap cleanup_image_archive EXIT

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 1
  fi
}

kube() {
  sudo k3s kubectl "$@"
}

preflight() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "This workflow must run on the Linux K3s server." >&2
    exit 1
  fi
  require_tool k3s
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
  kube get nodes >/dev/null
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
  cleanup_image_archive
  image_archive=""
}

deploy() {
  preflight
  require_tool curl
  require_tool docker
  require_tool openssl
  docker info >/dev/null
  ensure_secret
  build_and_import_images
  kube apply -k "$repo_root/infra/kubernetes/overlays/home"
  kube rollout restart deployment/backend-api deployment/generation-worker deployment/website -n "$namespace"
  kube rollout status statefulset/postgresql -n "$namespace" --timeout=300s
  kube rollout status statefulset/minio -n "$namespace" --timeout=300s
  kube rollout status deployment/backend-api -n "$namespace" --timeout=300s
  kube rollout status deployment/generation-worker -n "$namespace" --timeout=300s
  kube rollout status deployment/website -n "$namespace" --timeout=300s
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
    kube get pods,services,ingress -n "$namespace"
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
    kubectl kustomize "$repo_root/infra/kubernetes/overlays/home"
    ;;
  *)
    echo "Usage: $0 {deploy|status|logs|smoke|configure-serve|render}" >&2
    exit 1
    ;;
esac
