#!/usr/bin/env bash
# dev-ui.sh — Start the AWX UI webpack dev server with HMR
#
# Changes to .tsx/.ts/.css files are picked up instantly in the browser —
# no rebuild or deploy-ui.sh needed.
#
# The dev server runs on https://localhost:4101 and proxies all API/WebSocket
# traffic to the AWX container at https://localhost:8043.
#
# Usage:
#   bash tools/scripts/dev-ui.sh
#
# Optional env overrides:
#   AWX_SERVER=https://localhost:8043  (default)
#   DEV_PORT=4101                      (default)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UI_SRC="$REPO_ROOT/awx/ui/src"

AWX_SERVER="${AWX_SERVER:-https://localhost:8043}"
DEV_PORT="${DEV_PORT:-4101}"

echo "======================================================"
echo " AWX UI Dev Server"
echo " UI:      https://localhost:${DEV_PORT}"
echo " Backend: ${AWX_SERVER}"
echo " HMR:     enabled — file saves hot-reload in browser"
echo "======================================================"
echo ""
echo "  1. Open https://localhost:${DEV_PORT} in your browser"
echo "  2. Accept the self-signed cert if prompted"
echo "  3. Log in with your AWX credentials"
echo "  4. Edit files under awx/ui/src/frontend/ — changes reload instantly"
echo ""

cd "$UI_SRC"
export AWX_SERVER
export PUBLIC_PATH="/"
export UI_MODE=AWX
exec ./node_modules/.bin/webpack serve \
  --mode development \
  --config ./webpack/webpack.awx.cjs \
  --port "$DEV_PORT" \
  --server-type https \
  --no-open
