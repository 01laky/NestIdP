#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "CI-DCK-02: health"
curl -sf "${BASE_URL}/health" >/dev/null

echo "CI-DCK-02: ready"
curl -sf "${BASE_URL}/ready" >/dev/null

echo "CI-DCK-02: metadata"
curl -sf "${BASE_URL}/saml/metadata" | head -c 200 | grep -q EntityDescriptor

ADMIN_USER="${ADMIN_USERNAME:-ciadmin}"
ADMIN_PASS="${ADMIN_PASSWORD:?ADMIN_PASSWORD required}"

echo "CI-DCK-02: admin login"
LOGIN_JSON=$(curl -sf -c "$COOKIE_JAR" -X POST "${BASE_URL}/api/admin/auth/login" \
	-H 'Content-Type: application/json' \
	-d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}")
CSRF=$(echo "$LOGIN_JSON" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')
if [ -z "$CSRF" ]; then
	echo "csrfToken missing from login response" >&2
	exit 1
fi

echo "CI-DCK-02: admin me"
curl -sf -b "$COOKIE_JAR" "${BASE_URL}/api/admin/auth/me" >/dev/null

echo "CI-DCK-02-RM-01: admin login rememberMe sets Max-Age"
REMEMBER_HEADERS=$(curl -s -D - -o /dev/null -X POST "${BASE_URL}/api/admin/auth/login" \
	-H 'Content-Type: application/json' \
	-d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\",\"rememberMe\":true}")
echo "$REMEMBER_HEADERS" | grep -qi 'Max-Age=' || {
	echo "rememberMe login missing Max-Age" >&2
	exit 1
}

echo "CI-DCK-02: audit events"
AUDIT_BODY=$(curl -sf -b "$COOKIE_JAR" "${BASE_URL}/api/admin/audit-events?limit=5")
echo "$AUDIT_BODY" | grep -q admin_login_success

echo "CI-DCK-02: smoke complete"
