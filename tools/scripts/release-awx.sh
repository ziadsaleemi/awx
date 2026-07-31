#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/scripts/release-awx.sh VERSION [options]

Options:
  --image IMAGE          Container image repository. Default: docker.io/ziadsaleemi/awx
  --platforms LIST      Buildx platforms. Default: linux/amd64
  --builder NAME        Buildx builder name. Default: awx-release-builder
  --skip-build          Do not build or push the image.
  --skip-tag            Do not create or push the git tag.
  --skip-checks         Do not run release validation checks.
  --latest              Also push IMAGE:latest.
  -h, --help            Show help.

Required before running:
  - Current branch pushed and clean.
  - Version files already bumped to VERSION.
  - Docker logged in to the target registry.
EOF
}

version="${1:-}"
if [[ -z "$version" || "$version" == "-h" || "$version" == "--help" ]]; then
  usage
  exit 0
fi
shift || true

image="docker.io/ziadsaleemi/awx"
platforms="linux/amd64"
builder="awx-release-builder"
skip_build=0
skip_tag=0
skip_checks=0
tag_latest=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      image="${2:?Missing value for --image}"
      shift 2
      ;;
    --platforms)
      platforms="${2:?Missing value for --platforms}"
      shift 2
      ;;
    --builder)
      builder="${2:?Missing value for --builder}"
      shift 2
      ;;
    --skip-build)
      skip_build=1
      shift
      ;;
    --skip-tag)
      skip_tag=1
      shift
      ;;
    --skip-checks)
      skip_checks=1
      shift
      ;;
    --latest)
      tag_latest=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

fail() {
  echo "release-capstan: $*" >&2
  exit 1
}

require_clean_git() {
  [[ -z "$(git status --short)" ]] || fail "worktree is dirty"
  git fetch origin --tags
  branch="$(git branch --show-current)"
  [[ -n "$branch" ]] || fail "detached HEAD is not supported"
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  [[ -n "$upstream" ]] || fail "branch has no upstream"
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse "$upstream")" ]] || fail "HEAD does not match $upstream"
  if git rev-parse "$version" >/dev/null 2>&1; then
    fail "local tag $version already exists"
  fi
  if git ls-remote --exit-code --tags origin "refs/tags/$version" >/dev/null 2>&1; then
    fail "remote tag $version already exists"
  fi
}

require_release_files() {
  [[ "$(tr -d '[:space:]' < VERSION)" == "$version" ]] || fail "top-level VERSION is not $version"
  grep -q "ABOUT_MODAL_VERSION = '$version'" awx/ui/src/frontend/common/AboutModal.tsx || fail "About modal version is not $version"
  grep -q "\"version\": \"$version\"" awx/ui/src/package.json || fail "UI package version is not $version"
  grep -q "awx_image_tag: \"$version\"" tools/awx-deploy/ansible/roles/awx_deploy_common/defaults/main.yml || fail "deploy default image tag is not $version"
  grep -q "awx_image_tag: \"$version\"" tools/awx-deploy/ansible/group_vars/all.yml.example || fail "deploy example image tag is not $version"
}

run_checks() {
  export ANSIBLE_FORCE_COLOR=0
  export ANSIBLE_HOST_KEY_CHECKING=False
  export ANSIBLE_ROLES_PATH=tools/awx-deploy/ansible/roles
  export AWX_ADMIN_PASSWORD="${AWX_ADMIN_PASSWORD:-password}"
  export AWX_POSTGRES_PASSWORD="${AWX_POSTGRES_PASSWORD:-password}"

  git diff --check
  ansible-playbook -i tools/awx-deploy/ansible/inventories/example.ini tools/awx-deploy/ansible/playbooks/deploy-server.yml --syntax-check
  ansible-playbook -i tools/awx-deploy/ansible/inventories/example.ini tools/awx-deploy/ansible/playbooks/deploy-k3s.yml --syntax-check
  ansible-playbook -i localhost, tools/awx-deploy/ansible/playbooks/deploy-k8s.yml --syntax-check
  ansible-playbook -i localhost, tools/awx-deploy/ansible/playbooks/vcenter-lab.yml --syntax-check
}

build_image() {
  command -v docker >/dev/null || fail "docker is not installed"
  docker buildx version >/dev/null || fail "docker buildx is not available"

  make Dockerfile VERSION="$version" COMPOSE_TAG="$version"
  docker buildx create --name "$builder" --use >/dev/null 2>&1 || docker buildx use "$builder"

  tags=(--tag "$image:$version")
  if [[ "$tag_latest" -eq 1 ]]; then
    tags+=(--tag "$image:latest")
  fi
  ssh_args=()
  if [[ -n "${SSH_AUTH_SOCK:-}" ]]; then
    ssh_args=(--ssh "default=$SSH_AUTH_SOCK")
  fi

  docker buildx build \
    "${ssh_args[@]}" \
    --push \
    --platform="$platforms" \
    --build-arg "VERSION=$version" \
    --build-arg "SETUPTOOLS_SCM_PRETEND_VERSION=$version" \
    --build-arg "HEADLESS=${HEADLESS:-false}" \
    "${tags[@]}" \
    -f Dockerfile .
}

push_tag() {
  git tag -a "$version" -m "Capstan $version"
  git push origin "$version"
}

require_clean_git
require_release_files
if [[ "$skip_checks" -eq 0 ]]; then
  run_checks
fi
if [[ "$skip_build" -eq 0 ]]; then
  build_image
fi
if [[ "$skip_tag" -eq 0 ]]; then
  push_tag
fi

echo "Capstan release complete: $version"
echo "Image: $image:$version"
