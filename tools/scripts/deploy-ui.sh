#!/usr/bin/env bash
# deploy-ui.sh — Build and deploy the AWX UI to the dev container
# Usage: ./tools/scripts/deploy-ui.sh [--no-build]
#
# --no-build  Skip the webpack build (use existing src/build/awx output)
#
# What this does:
#   1. Builds the frontend with webpack (unless --no-build)
#   2. Renames index.html → index_awx.html (Django template name)
#   3. Rsyncs build output to awx/ui/build/awx/ (the STATICFILES_DIRS source)
#   4. Restarts uwsgi in the container (which runs collectstatic, then starts uwsgi)
#   5. Verifies the page loads with the new JS hash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UI_SRC="$REPO_ROOT/awx/ui/src"
BUILD_SRC="$UI_SRC/build/awx"
BUILD_DEST="$REPO_ROOT/awx/ui/build/awx"
CONTAINER="tools_awx_1"
HEALTH_URL="${AWX_UI_DEPLOY_HEALTH_URL:-https://localhost:8043/}"
HEALTH_TIMEOUT="${AWX_UI_DEPLOY_HEALTH_TIMEOUT:-60}"
HEALTH_INTERVAL="${AWX_UI_DEPLOY_HEALTH_INTERVAL:-3}"

NO_BUILD=0
for arg in "$@"; do
  [[ "$arg" == "--no-build" ]] && NO_BUILD=1
done

# ── Timing helpers ─────────────────────────────────────────────────────────────
DEPLOY_START=$SECONDS
STEP_TIME_BUILD=0
STEP_TIME_SYNC=0
STEP_TIME_DEPLOY=0

step_start() { _STEP_T=$SECONDS; }
step_end() {
  local elapsed=$(( SECONDS - _STEP_T ))
  case "$1" in
    build)  STEP_TIME_BUILD=$elapsed  ;;
    sync)   STEP_TIME_SYNC=$elapsed   ;;
    deploy) STEP_TIME_DEPLOY=$elapsed ;;
  esac
}

# ── Retry helper ───────────────────────────────────────────────────────────────
# retry <max_attempts> <delay_sec> <description> <command...>
retry() {
  local max=$1 delay=$2 desc=$3; shift 3
  local attempt=1 ret=0 elapsed
  while (( attempt <= max )); do
    local t_start=$SECONDS
    if "$@"; then
      elapsed=$(( SECONDS - t_start ))
      echo "    [retry] attempt $attempt/$max — OK (${elapsed}s)"
      return 0
    fi
    ret=$?
    elapsed=$(( SECONDS - t_start ))
    echo "    [retry] attempt $attempt/$max — FAILED (exit $ret, ${elapsed}s): $desc" >&2
    (( attempt++ ))
    if (( attempt <= max )); then
      echo "    [retry] waiting ${delay}s before attempt $attempt..." >&2
      sleep "$delay"
    fi
  done
  echo "    [retry] all $max attempts failed for: $desc" >&2
  return $ret
}

wait_for_http_200() {
  local url=$1 timeout=$2 delay=$3
  local elapsed=0 code
  while true; do
    code=$(curl -sk "$url" -o /dev/null -w "%{http_code}" || true)
    if [[ "$code" == "200" ]]; then
      HTTP_CODE="$code"
      echo "    [health] HTTP $code after ${elapsed}s"
      return 0
    fi
    if (( elapsed >= timeout )); then
      HTTP_CODE="$code"
      echo "    [health] HTTP $code after ${elapsed}s; giving up" >&2
      return 1
    fi
    echo "    [health] HTTP $code; waiting ${delay}s..." >&2
    sleep "$delay"
    elapsed=$(( elapsed + delay ))
  done
}

echo "=== AWX UI Deploy  (started $(date '+%H:%M:%S')) ==="

# ── Step 1: Build ──────────────────────────────────────────────────────────────
step_start
if [[ $NO_BUILD -eq 0 ]]; then
  echo "[1/4] Building frontend..."
  cd "$UI_SRC"
  PUBLIC_PATH=/static/awx/ npm run build:awx
  step_end "build"
  echo "  Build complete. (${STEP_TIME_BUILD}s)"
else
  step_end "build"
  echo "[1/4] Skipping build (--no-build)."
fi

# ── Step 2: Rename template ────────────────────────────────────────────────────
echo "[2/4] Preparing index_awx.html..."
if [[ -f "$BUILD_SRC/index.html" && ! -f "$BUILD_SRC/index_awx.html" ]]; then
  mv "$BUILD_SRC/index.html" "$BUILD_SRC/index_awx.html"
elif [[ -f "$BUILD_SRC/index.html" ]]; then
  mv -f "$BUILD_SRC/index.html" "$BUILD_SRC/index_awx.html"
fi

if [[ ! -f "$BUILD_SRC/index_awx.html" ]]; then
  echo "ERROR: $BUILD_SRC/index_awx.html not found after build. Aborting." >&2
  exit 1
fi

# ── Step 3: Sync to template/static source dir ─────────────────────────────────
# IMPORTANT: Use rsync (not docker cp) to avoid the Docker bind-mount roundtrip
# issue where docker cp writes back stale container state to the macOS host.
# The symlink /var/lib/awx/public/static/awx must NOT exist inside the container
# (collectstatic --clear follows it and deletes build/ contents).
step_start
echo "[3/4] Syncing build files to $BUILD_DEST ..."
mkdir -p "$BUILD_DEST"
rsync -a --delete "$BUILD_SRC/" "$BUILD_DEST/"

# Verify container can see the files via bind mount — up to 5 retries, 3s apart
echo "  Verifying bind-mount visibility in container..."
MOUNT_OK=0
for _attempt in 1 2 3 4 5; do
  t_a=$SECONDS
  if docker exec "$CONTAINER" test -f "/awx_devel/awx/ui/build/awx/index_awx.html" 2>/dev/null; then
    elapsed=$(( SECONDS - t_a ))
    echo "    [bind-mount] attempt $_attempt/5 — visible (${elapsed}s)"
    MOUNT_OK=1
    break
  fi
  elapsed=$(( SECONDS - t_a ))
  echo "    [bind-mount] attempt $_attempt/5 — not yet visible (${elapsed}s), waiting 3s..." >&2
  sleep 3
done

if [[ $MOUNT_OK -eq 0 ]]; then
  echo "  Bind mount still stale after 5 attempts. Falling back to docker cp..." >&2
  # Remove any broken symlink that would cause collectstatic to delete build/ files
  docker exec "$CONTAINER" bash -c \
    "if [ -L /var/lib/awx/public/static/awx ]; then rm /var/lib/awx/public/static/awx; fi" 2>/dev/null || true
  docker exec "$CONTAINER" bash -c "mkdir -p /var/lib/awx/ui_build"
  echo "    [docker cp] copying build artifacts..."
  t_cp=$SECONDS
  docker cp "$BUILD_SRC/." "$CONTAINER:/var/lib/awx/ui_build/"
  docker exec "$CONTAINER" bash -c \
    "cp /var/lib/awx/ui_build/index_awx.html /awx_devel/awx/ui/build/awx/index_awx.html" 2>/dev/null || true
  echo "    [docker cp] done ($(( SECONDS - t_cp ))s)"
fi

# Ensure the symlink that causes the collectstatic circular delete is gone
docker exec "$CONTAINER" bash -c \
  "if [ -L /var/lib/awx/public/static/awx ]; then echo '  Removing stale symlink...'; rm /var/lib/awx/public/static/awx; fi" 2>/dev/null || true

step_end "sync"
echo "  Sync complete. (${STEP_TIME_SYNC}s)"

# ── Step 4: Restart uwsgi ──────────────────────────────────────────────────────
step_start
echo "[4/4] Restarting uwsgi in container..."
docker exec "$CONTAINER" supervisorctl restart tower-processes:awx-uwsgi
echo "  Waiting for uwsgi to come up..."
HTTP_CODE="000"
if ! wait_for_http_200 "$HEALTH_URL" "$HEALTH_TIMEOUT" "$HEALTH_INTERVAL"; then
  true
fi
step_end "deploy"
echo "  uwsgi restarted. (${STEP_TIME_DEPLOY}s)"

# ── Step 5: Verify ─────────────────────────────────────────────────────────────
TOTAL=$(( SECONDS - DEPLOY_START ))
[[ $NO_BUILD -eq 0 ]] && BUILD_DISPLAY="${STEP_TIME_BUILD}s" || BUILD_DISPLAY="skipped"

if [[ "$HTTP_CODE" == "200" ]]; then
  set +o pipefail
  JS_SRC=$(curl -sk "$HEALTH_URL" | grep -o 'src="/static/awx/[^"]*\.js"' | head -1)
  set -o pipefail
  echo ""
  echo "=== Deploy successful  (finished $(date '+%H:%M:%S')) ==="
  echo ""
  echo "  Timings:"
  echo "    build ........... $BUILD_DISPLAY"
  echo "    sync ............ ${STEP_TIME_SYNC}s"
  echo "    deploy (uwsgi) .. ${STEP_TIME_DEPLOY}s"
  echo "    total ........... ${TOTAL}s"
  echo ""
  echo "  HTTP: $HTTP_CODE"
  echo "  JS:   $JS_SRC"
  echo ""
  echo "Open https://localhost:8043 in your browser (hard-refresh: Cmd+Shift+R)"
else
  echo ""
  echo "ERROR: Server returned HTTP $HTTP_CODE after restart." >&2
  echo ""
  echo "  Timings at failure:"
  echo "    build ........... $BUILD_DISPLAY"
  echo "    sync ............ ${STEP_TIME_SYNC}s"
  echo "    deploy (uwsgi) .. ${STEP_TIME_DEPLOY}s"
  echo "    total ........... ${TOTAL}s"
  echo ""
  echo "  Check container logs: docker exec $CONTAINER supervisorctl tail -10000 tower-processes:awx-uwsgi" >&2
  exit 1
fi
