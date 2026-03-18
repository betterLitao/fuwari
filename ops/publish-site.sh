#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/fuwari-blog}"
ENV_FILE="${APP_DIR}/shared/.env.production"
CURRENT_LINK="${APP_DIR}/current"

if [[ ! -f "${ENV_FILE}" ]]; then
	echo "缺少生产环境文件: ${ENV_FILE}"
	exit 1
fi

set -a
source "${ENV_FILE}"
set +a

PUBLISH_GITHUB_REPOSITORY="${PUBLISH_GITHUB_REPOSITORY:-}"
PUBLISH_GITHUB_WORKFLOW="${PUBLISH_GITHUB_WORKFLOW:-publish-imported-content.yml}"
PUBLISH_GITHUB_REF="${PUBLISH_GITHUB_REF:-main}"
PUBLISH_GITHUB_TOKEN="${PUBLISH_GITHUB_TOKEN:-}"
PUBLISH_GITHUB_API_URL="${PUBLISH_GITHUB_API_URL:-https://api.github.com}"

if [[ -z "${PUBLISH_GITHUB_TOKEN}" ]]; then
	echo "缺少 PUBLISH_GITHUB_TOKEN，无法触发 CI 发布。"
	exit 1
fi

if [[ -z "${PUBLISH_GITHUB_REPOSITORY}" ]]; then
	echo "缺少 PUBLISH_GITHUB_REPOSITORY，无法触发 CI 发布。"
	exit 1
fi

if [[ -z "${PUBLISH_GITHUB_WORKFLOW}" ]]; then
	echo "缺少 PUBLISH_GITHUB_WORKFLOW，无法触发 CI 发布。"
	exit 1
fi

CURRENT_RELEASE="$(basename "$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)")"
if [[ -z "${CURRENT_RELEASE}" ]]; then
	CURRENT_RELEASE="unknown"
fi

dispatch_url="${PUBLISH_GITHUB_API_URL}/repos/${PUBLISH_GITHUB_REPOSITORY}/actions/workflows/${PUBLISH_GITHUB_WORKFLOW}/dispatches"
payload="$(cat <<EOF
{"ref":"${PUBLISH_GITHUB_REF}","inputs":{"trigger_reason":"server-import","source_release":"${CURRENT_RELEASE}"}}
EOF
)"

http_code="$(
	curl -sS -o /tmp/fuwari-publish-dispatch-response.json \
		-w "%{http_code}" \
		-X POST "${dispatch_url}" \
		-H "Accept: application/vnd.github+json" \
		-H "Authorization: Bearer ${PUBLISH_GITHUB_TOKEN}" \
		-H "X-GitHub-Api-Version: 2022-11-28" \
		-H "Content-Type: application/json" \
		-d "${payload}"
)"

if [[ "${http_code}" != "204" ]]; then
	echo "触发 CI 发布失败，HTTP ${http_code}"
	if [[ -f /tmp/fuwari-publish-dispatch-response.json ]]; then
		cat /tmp/fuwari-publish-dispatch-response.json
	fi
	exit 1
fi

echo "已触发 CI 发布 workflow=${PUBLISH_GITHUB_WORKFLOW} ref=${PUBLISH_GITHUB_REF}"
