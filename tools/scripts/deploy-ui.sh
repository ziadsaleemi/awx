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

NO_BUILD=0
for arg in "$@"; do
  [[ "$arg" == "--no-build" ]] && NO_BUILD=1
done

echo "=== AWX UI Deploy ==="

# ── Step 1: Build ──────────────────────────────────────────────────────────────
if [[ $NO_BUILD -eq 0 ]]; then
  echo "[1/4] Building frontend..."
  cd "$UI_SRC"
  PUBLIC_PATH=/static/awx/ npm run build:awx
  echo "  Build complete."
else
  echo "[1/4] Skipping build (--no-build)."
fi

# ── Step 2: Rename template ────────────────────────────────────────────────────
echo "[2/4] Preparing index_awx.html..."
if [[ -f "$BUILD_SRC/index.html" && ! -f "$BUILD_SRC/index_awx.html" ]]; then
  mv "$BUILD_SRC/index.html" "$BUILD_SRC/index_awx.html"
elif [[ -f "$BUILD_SRC/index.html" ]]; then
  # Both exist — overwrite
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
echo "[3/4] Syncing build files to $BUILD_DEST ..."
mkdir -p "$BUILD_DEST"
rsync -a --delete "$BUILD_SRC/" "$BUILD_DEST/"

# Verify container can see the files via bind mount
if ! docker exec "$CONTAINER" test -f "/awx_devel/awx/ui/build/awx/index_awx.html" 2>/dev/null; then
  echo "  Bind mount not reflecting files yet — waiting 3s..."
  sleep 3
  if ! docker exec "$CONTAINER" test -f "/awx_devel/awx/ui/build/awx/index_awx.html" 2>/dev/null; then
    echo "  Bind mount still stale. Falling back to docker cp..."
    # Remove any broken symlink that would cause collectstatic to delete build/ files
    docker exec "$CONTAINER" bash -c \
      "if [ -L /var/lib/awx/public/static/awx ]; then rm /var/lib/awx/public/static/awx; fi" 2>/dev/null || true
    # Copy files directly — skip the bind-mounted path to avoid feedback loops
    docker exec "$CONTAINER" bash -c "mkdir -p /var/lib/awx/ui_build"
    docker cp "$BUILD_SRC/." "$CONTAINER:/var/lib/awx/ui_build/"
    docker exec "$CONTAINER" bash -c "cp /var/lib/awx/ui_build/index_awx.html /awx_devel/awx/ui/build/awx/index_awx.html" 2>/dev/null || true
    echo "  Files copied via docker cp fallback."
  fi
fi

# Ensure the symlink that causes the collectstatic circular delete is gone
docker exec "$CONTAINER" bash -c \
  "if [ -L /var/lib/awx/public/static/awx ]; then echo '  Removing stale symlink...'; rm /var/lib/awx/public/static/awx; fi" 2>/dev/null || true

echo "  Sync complete."

# ── Step 4: Restart uwsgi ──────────────────────────────────────────────────────
# make uwsgi → collectstatic --clear → copies build/ → STATIC_ROOT, then starts uwsgi
echo "[4/4] Restarting uwsgi in container..."
docker exec "$CONTAINER" supervisorctl restart tower-processes:awx-uwsgi
echo "  Waiting for uwsgi to come up..."
sleep 8

# ── Step 5: Verify ─────────────────────────────────────────────────────────────
HTTP_CODE=$(curl -sk https://localhost:8043/ -o /dev/null -w "%{http_code}")
JS_SRC=$(curl -sk https://localhost:8043/ | grep -o 'src="/static/awx/[^"]*\.js"' | head -1)

if [[ "$HTTP_CODE" == "200" ]]; then
  echo ""
  echo "=== Deploy successful ==="
  echo "  HTTP: $HTTP_CODE"
  echo "  JS:   $JS_SRC"
  echo ""
  echo "Open https://localhost:8043 in your browser (hard-refresh: Cmd+Shift+R)"
else
  echo ""
  echo "ERROR: Server returned HTTP $HTTP_CODE after restart." >&2
  echo "  Check container logs: docker exec $CONTAINER supervisorctl tail -10000 tower-processes:awx-uwsgi" >&2
  exit 1
fi
