#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/fuwari-blog}"
MAIN_SERVICE="${MAIN_SERVICE:-fuwari-blog.service}"

cd "${APP_DIR}"

export HOME="${HOME:-/root}"
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"

/usr/local/bin/corepack pnpm build
systemctl restart "${MAIN_SERVICE}"
