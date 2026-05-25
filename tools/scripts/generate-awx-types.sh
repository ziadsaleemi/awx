#!/usr/bin/env bash
# generate-awx-types.sh
#
# Regenerates awx/ui/src/frontend/awx/interfaces/generated-from-swagger/api.ts
# from the live AWX OpenAPI schema.
#
# Usage:
#   bash tools/scripts/generate-awx-types.sh
#   bash tools/scripts/generate-awx-types.sh --skip-schema
#
# Options:
#   --skip-schema   Skip 'make genschema' and reuse an existing schema.json.
#                   Useful when the schema was recently generated and you only
#                   need to re-run the TypeScript conversion step.
#
# Requirements:
#   - awx-manage must be on PATH (run inside the dev container, or activate the
#     AWX virtualenv) unless --skip-schema is passed.
#   - npm dependencies must be installed in awx/ui/src (npm install).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SKIP_SCHEMA=false
for arg in "$@"; do
  [[ "$arg" == "--skip-schema" ]] && SKIP_SCHEMA=true
done

if [[ "$SKIP_SCHEMA" == "false" ]]; then
  echo "[1/2] Generating OpenAPI schema (make genschema)..."
  make -C "$REPO_ROOT" genschema
else
  echo "[1/2] Skipping schema generation (--skip-schema passed)."
  if [[ ! -f "$REPO_ROOT/schema.json" ]]; then
    echo "ERROR: schema.json not found at $REPO_ROOT/schema.json" >&2
    echo "       Run without --skip-schema, or run 'make genschema' first." >&2
    exit 1
  fi
fi

echo "[2/2] Converting OpenAPI schema to TypeScript interfaces..."
cd "$REPO_ROOT/awx/ui/src"
npm run generate:types

echo ""
echo "Done — frontend/awx/interfaces/generated-from-swagger/api.ts updated."
echo "Review the diff and commit the changes."
