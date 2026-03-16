#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/fuwari-blog}"
MAIN_SERVICE="${MAIN_SERVICE:-fuwari-blog.service}"
PUBLISH_SERVICE="${PUBLISH_SERVICE:-fuwari-blog-publish.service}"

cd "${APP_DIR}"

if [[ ! -f ".env.production" ]]; then
  echo ".env.production 不存在，先补环境变量"
  exit 1
fi

corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@9.14.4 --activate >/dev/null 2>&1 || true

install -D -m 0644 ops/systemd/fuwari-blog.service "/etc/systemd/system/${MAIN_SERVICE}"
install -D -m 0644 ops/systemd/fuwari-blog-publish.service "/etc/systemd/system/${PUBLISH_SERVICE}"

systemctl daemon-reload
systemctl enable "${MAIN_SERVICE}"

corepack pnpm install --frozen-lockfile
corepack pnpm build

systemctl restart "${MAIN_SERVICE}"
systemctl status "${MAIN_SERVICE}" --no-pager
