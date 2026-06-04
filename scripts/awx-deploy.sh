#!/usr/bin/env bash
# =============================================================================
# awx-deploy.sh — Build, upgrade, and rollback AWX on k3s
#
# Usage:
#   ./scripts/awx-deploy.sh upgrade <version>    # Merge upstream tag, build, migrate, deploy
#   ./scripts/awx-deploy.sh rollback [version]   # Roll back to previous or specified version
#   ./scripts/awx-deploy.sh status               # Show current deployment state
#   ./scripts/awx-deploy.sh health               # Run post-deploy health checks
#   ./scripts/awx-deploy.sh build <version>      # Build & push image only (no k8s changes)
#
# Examples:
#   ./scripts/awx-deploy.sh upgrade 25.1.2
#   ./scripts/awx-deploy.sh rollback
#   ./scripts/awx-deploy.sh rollback 25.1.0
# =============================================================================
set -euo pipefail
IFS=$'\n\t'

# ─── Configuration ────────────────────────────────────────────────────────────
REGISTRY="docker.io/ziadsaleemi"
AWX_IMAGE="${REGISTRY}/awx"
AWX_SRC="/build/awx-src"
NAMESPACE="awx"
CR_NAME="awx"
STATE_DIR="/var/lib/awx-deploy"
LOG_DIR="/var/log/awx-deploy"

GIT_EMAIL="ziad.saleemii@gmail.com"
GIT_NAME="Ziad Saleemi"

# ─── Colours ──────────────────────────────────────────────────────────────────
C_BLUE='\033[0;34m'; C_GREEN='\033[0;32m'
C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_RESET='\033[0m'

log_info()    { echo -e "${C_BLUE}[INFO]${C_RESET}  $*"; }
log_ok()      { echo -e "${C_GREEN}[ OK ]${C_RESET}  $*"; }
log_warn()    { echo -e "${C_YELLOW}[WARN]${C_RESET}  $*"; }
log_error()   { echo -e "${C_RED}[ERR ]${C_RESET}  $*" >&2; }
log_section() {
  echo -e "\n${C_BLUE}══════════════════════════════════════════════════${C_RESET}"
  echo -e "${C_BLUE}  $*${C_RESET}"
  echo -e "${C_BLUE}══════════════════════════════════════════════════${C_RESET}"
}
die() { log_error "$*"; exit 1; }

# ─── State management ─────────────────────────────────────────────────────────
init_state() { mkdir -p "${STATE_DIR}" "${LOG_DIR}"; }

save_version() {
  local new="$1" prev="$2"
  init_state
  echo "${new}"  > "${STATE_DIR}/current"
  echo "${prev}" > "${STATE_DIR}/previous"
  log_info "Saved state: current=${new}  previous=${prev}"
}

current_deployed_version() {
  kubectl get awx "${CR_NAME}" -n "${NAMESPACE}" \
    -o jsonpath='{.spec.image_version}' 2>/dev/null \
    || cat "${STATE_DIR}/current" 2>/dev/null \
    || echo "unknown"
}

previous_version() {
  cat "${STATE_DIR}/previous" 2>/dev/null || echo ""
}

# ─── Sanity checks ────────────────────────────────────────────────────────────
sanity_check() {
  log_section "Sanity checks"
  cd "${AWX_SRC}"
  local failed=0

  _chk() {
    local label="$1"; shift
    if eval "$*" &>/dev/null; then
      log_ok "${label}"
    else
      log_error "FAIL — ${label}"
      failed=1
    fi
  }

  # Auto-fix the known Dockerfile glob bug before checking
  if grep -qP 'dist/awx\*\.tar\.gz' Dockerfile 2>/dev/null; then
    log_warn "Auto-fixing Dockerfile glob: dist/awx*.tar.gz → dist/awx-*.tar.gz"
    sed -i 's|dist/awx\*\.tar\.gz|dist/awx-*.tar.gz|g' Dockerfile
  fi

  _chk "SRC_ONLY_PKGS contains lxml,xmlsec" \
    "grep 'SRC_ONLY_PKGS' Makefile | grep -q 'lxml,xmlsec'"
  _chk "django-auth-ldap in requirements.txt" \
    "grep -q 'django-auth-ldap' requirements/requirements.txt"
  _chk "libldap2-dev in Dockerfile (Ubuntu) or openldap-devel (RHEL)" \
    "grep -qE 'libldap2-dev|openldap-devel' Dockerfile"
  _chk "ui-builder stage in Dockerfile" \
    "grep -q 'ui-builder' Dockerfile"
  _chk "Reports stub component exists" \
    "test -f awx/ui/src/frontend/awx/analytics/Reports/Reports.tsx"
  _chk "pip install glob uses awx-*.tar.gz (not awx*.tar.gz)" \
    "grep -q 'dist/awx-\*.tar.gz' Dockerfile"

  [[ $failed -eq 0 ]] || die "Sanity checks failed — fix the issues above before building"
  log_ok "All sanity checks passed"
}

# ─── Git operations ───────────────────────────────────────────────────────────
merge_upstream_tag() {
  local version="$1"
  log_section "Merging upstream tag ${version} into devel"
  cd "${AWX_SRC}"

  git config user.email "${GIT_EMAIL}" 2>/dev/null || true
  git config user.name  "${GIT_NAME}"  2>/dev/null || true

  # Ensure upstream remote exists
  git remote add upstream https://github.com/ansible/awx.git 2>/dev/null || true

  log_info "Fetching upstream tags..."
  git fetch upstream --tags

  git tag | grep -qx "${version}" || die "Tag '${version}' not found after fetch"

  git checkout devel

  # Skip if already merged
  if git merge-base --is-ancestor "${version}" HEAD 2>/dev/null; then
    log_warn "Tag ${version} is already merged into devel — skipping merge"
    return 0
  fi

  git merge "${version}" --no-edit || {
    log_error "Merge conflict detected. Resolve manually then re-run."
    git merge --abort 2>/dev/null || true
    die "Merge aborted"
  }

  log_ok "Merged upstream ${version} into devel"
}

push_devel() {
  log_section "Pushing devel branch to origin"
  cd "${AWX_SRC}"
  git push origin devel && log_ok "Pushed devel to origin" \
    || log_warn "git push failed — deploy succeeded but origin is not updated"
}

# ─── Image build & distribution ───────────────────────────────────────────────
build_image() {
  local version="$1"
  local log_file="${LOG_DIR}/build-${version}.log"
  log_section "Building ${AWX_IMAGE}:${version}"
  log_info "Build log: ${log_file}"
  cd "${AWX_SRC}"

  sudo docker buildx use localbuilder 2>/dev/null \
    || sudo docker buildx create --name localbuilder --use

  sudo docker buildx build \
    --load \
    --build-arg SETUPTOOLS_SCM_PRETEND_VERSION="${version}" \
    -t "${AWX_IMAGE}:${version}" \
    -t "${AWX_IMAGE}:latest" \
    . > "${log_file}" 2>&1 || {
      log_error "Build failed. Last 30 lines of ${log_file}:"
      tail -30 "${log_file}" >&2
      die "Build failed for ${version}"
    }

  log_ok "Built ${AWX_IMAGE}:${version}"
}

push_image() {
  local version="$1"
  log_section "Pushing image to Docker Hub"
  sudo docker push "${AWX_IMAGE}:${version}"
  sudo docker push "${AWX_IMAGE}:latest"
  log_ok "Pushed ${AWX_IMAGE}:${version}"
}

import_image() {
  local version="$1"
  log_section "Importing ${AWX_IMAGE}:${version} into k3s containerd"
  log_info "Streaming image (~1.3 GB) — takes ~2 min..."
  sudo docker save "${AWX_IMAGE}:${version}" | sudo k3s ctr images import -
  log_ok "Imported into k3s"
}

ensure_image_in_k3s() {
  local version="$1"
  if sudo k3s ctr images ls 2>/dev/null | grep -q "${AWX_IMAGE}:${version}"; then
    log_ok "Image ${AWX_IMAGE}:${version} already in k3s"
    return 0
  fi

  log_info "Image not found in k3s — attempting to source it..."
  if sudo docker image inspect "${AWX_IMAGE}:${version}" &>/dev/null; then
    import_image "${version}"
  else
    log_info "Not in Docker daemon either — pulling from Docker Hub..."
    sudo docker pull "${AWX_IMAGE}:${version}"
    import_image "${version}"
  fi
}

# ─── Database migrations ──────────────────────────────────────────────────────
run_migrations() {
  local version="$1"
  # k8s names must be DNS-label safe — replace dots with dashes
  local job_name="awx-migrate-v$(echo "${version}" | tr '.' '-')"

  log_section "Running database migrations for ${version}"

  # Clean up any previous run of this job
  kubectl delete job "${job_name}" -n "${NAMESPACE}" 2>/dev/null \
    && log_warn "Deleted existing migration job ${job_name}" || true

  kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job_name}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/managed-by: awx-deploy-script
spec:
  backoffLimit: 2
  template:
    spec:
      serviceAccountName: awx
      restartPolicy: OnFailure
      containers:
      - name: migration
        image: ${AWX_IMAGE}:${version}
        command: ["awx-manage", "migrate", "--noinput"]
        volumeMounts:
        - mountPath: /etc/tower/conf.d/credentials.py
          name: awx-application-credentials
          subPath: credentials.py
          readOnly: true
        - mountPath: /etc/tower/conf.d/ldap.py
          name: awx-application-credentials
          subPath: ldap.py
          readOnly: true
        - mountPath: /etc/tower/conf.d/execution_environments.py
          name: awx-application-credentials
          subPath: execution_environments.py
          readOnly: true
        - mountPath: /etc/tower/SECRET_KEY
          name: awx-secret-key
          subPath: SECRET_KEY
          readOnly: true
        - mountPath: /etc/tower/settings.py
          name: awx-settings
          subPath: settings.py
          readOnly: true
      volumes:
      - name: awx-application-credentials
        secret:
          secretName: awx-app-credentials
          items:
          - key: credentials.py
            path: credentials.py
          - key: ldap.py
            path: ldap.py
          - key: execution_environments.py
            path: execution_environments.py
      - name: awx-secret-key
        secret:
          secretName: awx-secret-key
          items:
          - key: secret_key
            path: SECRET_KEY
      - name: awx-settings
        configMap:
          name: awx-awx-configmap
          items:
          - key: settings
            path: settings.py
EOF

  log_info "Waiting for migrations to complete (timeout: 10 min)..."
  kubectl wait --for=condition=complete "job/${job_name}" \
    -n "${NAMESPACE}" --timeout=600s || {
      log_error "Migration job failed or timed out. Logs:"
      kubectl logs -n "${NAMESPACE}" -l "job-name=${job_name}" --tail=60 >&2
      die "Migrations failed — aborting deploy to protect the database"
    }

  log_info "Migration output:"
  kubectl logs -n "${NAMESPACE}" -l "job-name=${job_name}" 2>/dev/null \
    | grep -E "Applying|OK|No migrations|ERROR|WARNING" || true

  log_ok "Migrations complete"
}

# ─── Kubernetes rollout ───────────────────────────────────────────────────────
patch_cr_version() {
  local version="$1"
  log_info "Patching AWX CR image_version → ${version}"
  kubectl patch awx "${CR_NAME}" -n "${NAMESPACE}" \
    --type=merge -p "{\"spec\":{\"image_version\":\"${version}\"}}"
}

rollout_and_wait() {
  log_section "Rolling out new pods"
  kubectl rollout restart deployment/awx-web deployment/awx-task -n "${NAMESPACE}"

  log_info "Waiting for awx-web (timeout: 5 min)..."
  kubectl rollout status deployment/awx-web -n "${NAMESPACE}" --timeout=300s

  log_info "Waiting for awx-task (timeout: 5 min)..."
  kubectl rollout status deployment/awx-task -n "${NAMESPACE}" --timeout=300s

  log_ok "Rollout complete"
}

# ─── Health checks ────────────────────────────────────────────────────────────
health_check() {
  log_section "Post-deploy health checks"
  local failed=0

  _exec() {
    kubectl exec -n "${NAMESPACE}" deployment/awx-web -c awx-web -- \
      /var/lib/awx/venv/awx/bin/python -c "$1" 2>/dev/null
  }

  if _exec "import xmlsec; print('xmlsec OK')"; then
    log_ok "xmlsec loaded (no libxml2 version mismatch)"
  else
    log_error "xmlsec failed — login will return HTTP 500"
    failed=1
  fi

  if _exec "import django_auth_ldap; print('LDAP OK')"; then
    log_ok "LDAP module loaded"
  else
    log_warn "LDAP module unavailable (non-fatal if LDAP not configured)"
  fi

  local running_ver
  running_ver=$(kubectl exec -n "${NAMESPACE}" deployment/awx-web -c awx-web -- \
    /var/lib/awx/venv/awx/bin/awx-manage version 2>/dev/null || echo "unavailable")
  log_info "Running AWX version: ${running_ver}"

  echo ""
  kubectl get pods -n "${NAMESPACE}" \
    | grep -E "NAME|awx-web|awx-task|awx-postgres"

  [[ $failed -eq 0 ]] || die "Health checks failed — consider rolling back"
  log_ok "All health checks passed"
}

# ─── Top-level commands ───────────────────────────────────────────────────────
cmd_upgrade() {
  local version="${1:-}"
  [[ -n "$version" ]] || die "Usage: $0 upgrade <version>   e.g. $0 upgrade 25.1.2"

  local prev_version
  prev_version=$(current_deployed_version)

  log_section "AWX Upgrade: ${prev_version} → ${version}"
  log_info "Started at $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

  merge_upstream_tag "${version}"
  sanity_check
  build_image         "${version}"
  push_image          "${version}"
  import_image        "${version}"
  run_migrations      "${version}"
  patch_cr_version    "${version}"
  rollout_and_wait
  health_check

  save_version "${version}" "${prev_version}"
  push_devel

  log_section "Upgrade complete: ${prev_version} → ${version}"
  log_info "Finished at $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  log_info "Access AWX at http://$(hostname -I | awk '{print $1}'):30080"
}

cmd_rollback() {
  local target="${1:-}"

  if [[ -z "$target" ]]; then
    target=$(previous_version)
    [[ -n "$target" ]] \
      || die "No previous version recorded. Specify one: $0 rollback <version>"
  fi

  local current
  current=$(current_deployed_version)

  log_section "AWX Rollback: ${current} → ${target}"
  log_warn "Database migrations are NOT reversed. If schema changed, some features"
  log_warn "may behave unexpectedly until you re-upgrade."
  log_info "Started at $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

  ensure_image_in_k3s  "${target}"
  patch_cr_version     "${target}"
  rollout_and_wait
  health_check

  save_version "${target}" "${current}"

  log_section "Rollback complete: ${current} → ${target}"
  log_info "Finished at $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
}

cmd_status() {
  log_section "AWX Deployment Status"

  local current prev running
  current=$(current_deployed_version)
  prev=$(previous_version)
  running=$(kubectl exec -n "${NAMESPACE}" deployment/awx-web -c awx-web -- \
    /var/lib/awx/venv/awx/bin/awx-manage version 2>/dev/null || echo "unavailable")

  printf "\n  %-22s %s\n" "Deployed (CR spec):"  "${current}"
  printf   "  %-22s %s\n" "Running (in-pod):"    "${running}"
  printf   "  %-22s %s\n" "Previous version:"    "${prev:-none}"
  echo ""

  log_info "Pods:"
  kubectl get pods -n "${NAMESPACE}" \
    | grep -E "NAME|awx-web|awx-task|awx-postgres|awx-operator"
  echo ""

  log_info "Images in use by awx pods:"
  kubectl get pods -n "${NAMESPACE}" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' \
    | grep -v "^$" \
    | grep -v "kube-rbac\|redis\|receptor" \
    | sort -u
}

cmd_build() {
  local version="${1:-}"
  [[ -n "$version" ]] || die "Usage: $0 build <version>"
  cd "${AWX_SRC}"
  sanity_check
  build_image  "${version}"
  push_image   "${version}"
  log_ok "Build complete — image not deployed. Run '$0 upgrade ${version}' to deploy."
}

cmd_health() { health_check; }

# ─── Entry point ──────────────────────────────────────────────────────────────
main() {
  for cmd in kubectl docker git; do
    command -v "$cmd" &>/dev/null || die "Required command not found: ${cmd}"
  done

  local command="${1:-help}"
  shift || true

  case "${command}" in
    upgrade)  cmd_upgrade  "$@" ;;
    rollback) cmd_rollback "$@" ;;
    status)   cmd_status       ;;
    health)   cmd_health       ;;
    build)    cmd_build    "$@" ;;
    help|--help|-h)
      cat <<EOF

AWX Deploy Script

Usage: $(basename "$0") <command> [args]

  upgrade <version>    Merge upstream tag, build image, run migrations, deploy
                       Example: $(basename "$0") upgrade 25.1.2

  rollback [version]   Roll back to previous version (or specify one)
                       Example: $(basename "$0") rollback
                       Example: $(basename "$0") rollback 25.1.0

  status               Show current deployment state and pod status

  health               Run post-deploy health checks (xmlsec, LDAP, version)

  build <version>      Build and push image only — no Kubernetes changes
                       Example: $(basename "$0") build 25.1.2

Configuration (edit top of script):
  Registry:    ${REGISTRY}
  AWX source:  ${AWX_SRC}
  Namespace:   ${NAMESPACE}
  State dir:   ${STATE_DIR}
  Build logs:  ${LOG_DIR}

EOF
      ;;
    *) die "Unknown command: '${command}'. Run '$0 help' for usage." ;;
  esac
}

main "$@"
