#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../../.." && pwd)"

galaxy_ng_repo="${GALAXY_NG_REPO:-/Users/ziadsaleemi/Repositories/galaxy_ng}"
compose_dir="${galaxy_ng_repo}/dev/compose"
base_compose="${compose_dir}/standalone.yaml"
origin_override="${GALAXY_AWX_ORIGIN_OVERRIDE:-/tmp/galaxy-awx-origin.override.yaml}"
support_dir="${repo_root}/tools/awx-deploy/support/galaxy-ng-ui"
ui_override="${support_dir}/galaxy-ng-ui.override.yaml"
export AWX_GALAXY_UI_NGINX_CONF="${support_dir}/galaxy-ng-nginx-with-ui.conf"

if [[ ! -f "${base_compose}" ]]; then
  echo "Galaxy NG compose file not found: ${base_compose}" >&2
  exit 1
fi

if [[ ! -f "${origin_override}" ]]; then
  cat >"${origin_override}" <<'YAML'
services:
  api:
    environment:
      PULP_ANSIBLE_API_HOSTNAME: "http://host.docker.internal:5001"
      PULP_ANSIBLE_CONTENT_HOSTNAME: "http://host.docker.internal:5001"
      PULP_CONTENT_ORIGIN: "http://host.docker.internal:5001"
      PULP_TOKEN_SERVER: "http://host.docker.internal:5001/token/"
      HUB_API_ROOT: "http://host.docker.internal:5001/api/galaxy/"
      CONTAINER_REGISTRY: "host.docker.internal:5001"
  content:
    environment:
      PULP_ANSIBLE_API_HOSTNAME: "http://host.docker.internal:5001"
      PULP_ANSIBLE_CONTENT_HOSTNAME: "http://host.docker.internal:5001"
      PULP_CONTENT_ORIGIN: "http://host.docker.internal:5001"
      PULP_TOKEN_SERVER: "http://host.docker.internal:5001/token/"
      HUB_API_ROOT: "http://host.docker.internal:5001/api/galaxy/"
      CONTAINER_REGISTRY: "host.docker.internal:5001"
  worker:
    environment:
      PULP_ANSIBLE_API_HOSTNAME: "http://host.docker.internal:5001"
      PULP_ANSIBLE_CONTENT_HOSTNAME: "http://host.docker.internal:5001"
      PULP_CONTENT_ORIGIN: "http://host.docker.internal:5001"
      PULP_TOKEN_SERVER: "http://host.docker.internal:5001/token/"
      HUB_API_ROOT: "http://host.docker.internal:5001/api/galaxy/"
      CONTAINER_REGISTRY: "host.docker.internal:5001"
  manager:
    environment:
      PULP_ANSIBLE_API_HOSTNAME: "http://host.docker.internal:5001"
      PULP_ANSIBLE_CONTENT_HOSTNAME: "http://host.docker.internal:5001"
      PULP_CONTENT_ORIGIN: "http://host.docker.internal:5001"
      PULP_TOKEN_SERVER: "http://host.docker.internal:5001/token/"
      HUB_API_ROOT: "http://host.docker.internal:5001/api/galaxy/"
      CONTAINER_REGISTRY: "host.docker.internal:5001"
YAML
fi

docker compose \
  -f "${base_compose}" \
  -f "${origin_override}" \
  -f "${ui_override}" \
  up -d galaxy_web_assets nginx

curl -fsSI http://localhost:5001/ui/ >/dev/null
curl -fsSI http://localhost:5001/static/galaxy_ng/index.html >/dev/null
curl -fsSI http://localhost:5001/api/galaxy/pulp/api/v3/status/ >/dev/null

echo "Galaxy NG UI is available at http://localhost:5001/ui/"
