#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:8000}"
EMAIL="${DEMO_EMAIL:-admin@sentinel-rgbt.com}"
PASSWORD="${DEMO_PASSWORD:-Sentinel123!}"

echo "[1/10] health"
curl --fail --silent --show-error "$API_URL/health" >/dev/null

echo "[2/10] login and request tracing"
LOGIN_JSON=$(curl --fail --silent --show-error \
  -X POST "$API_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(printf '%s' "$LOGIN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["accessToken"])')

AUTH_HEADER="Authorization: Bearer $TOKEN"

echo "[3/10] current user and missions"
curl --fail --silent --show-error "$API_URL/api/v1/auth/me" -H "$AUTH_HEADER" >/dev/null
curl --fail --silent --show-error "$API_URL/api/v1/missions?page=1&page_size=2" -H "$AUTH_HEADER" >/dev/null

echo "[4/10] anomaly query"
curl --fail --silent --show-error "$API_URL/api/v1/anomalies?severity=critical" -H "$AUTH_HEADER" >/dev/null

echo "[5/10] drone adapter boundary"
curl --fail --silent --show-error "$API_URL/api/v1/integrations/drone/status" -H "$AUTH_HEADER" >/dev/null

echo "[6/10] system readiness"
curl --fail --silent --show-error "$API_URL/api/v1/system/readiness" -H "$AUTH_HEADER" \
  | python3 -c 'import json,sys; data=json.load(sys.stdin)["data"]; assert data["overall"] in {"healthy","degraded"}; assert len(data["services"]) >= 5'

echo "[7/10] manifest pair validation"
MANIFEST_STATUS=$(curl --fail --silent --show-error \
  -X POST "$API_URL/api/v1/ingestion/manifests/validate" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d '{"schemaVersion":"1.0","missionId":"MSN-SMOKE","site":"演示场站","aircraft":"UAV-07","payload":"RGBT-35T","timezone":"Asia/Shanghai","crs":"EPSG:4326","frames":[{"pairId":"P-1","modality":"RGB","path":"rgb/1.jpg","timestamp":"2026-09-07T10:00:00+08:00","latitude":31.02,"longitude":120.41,"altitudeM":118.7},{"pairId":"P-1","modality":"THERMAL","path":"thermal/1.jpg","timestamp":"2026-09-07T10:00:00.004+08:00","latitude":31.02,"longitude":120.41,"altitudeM":118.7}]}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["status"])')
test "$MANIFEST_STATUS" = "ready"

echo "[8/10] duplicate frame rejection"
DUPLICATE_STATUS=$(curl --fail --silent --show-error \
  -X POST "$API_URL/api/v1/ingestion/manifests/validate" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d '{"schemaVersion":"1.0","missionId":"MSN-SMOKE-DUP","site":"演示场站","aircraft":"UAV-07","payload":"RGBT-35T","timezone":"Asia/Shanghai","crs":"EPSG:4326","frames":[{"pairId":"P-1","modality":"RGB","path":"same.jpg","timestamp":"2026-09-07T10:00:00+08:00","latitude":31.02,"longitude":120.41,"altitudeM":118.7},{"pairId":"P-1","modality":"RGB","path":"same.jpg","timestamp":"2026-09-07T10:00:00.004+08:00","latitude":31.02,"longitude":120.41,"altitudeM":118.7}]}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["status"])')
test "$DUPLICATE_STATUS" = "blocked"

echo "[9/10] invalid status rejection and error envelope"
INVALID_RESPONSE=$(curl --silent --show-error \
  -X PATCH "$API_URL/api/v1/anomalies/EVT-240905-018?status=invalid" \
  -H "$AUTH_HEADER" \
  -w '\n%{http_code}')
INVALID_CODE=$(printf '%s' "$INVALID_RESPONSE" | tail -n 1)
INVALID_BODY=$(printf '%s' "$INVALID_RESPONSE" | sed '$d')
test "$INVALID_CODE" = "422"
printf '%s' "$INVALID_BODY" | python3 -c 'import json,sys; body=json.load(sys.stdin); assert body["error"]["code"] == "VALIDATION_ERROR"; assert body["requestId"]'

echo "[10/10] AI demo"
curl --fail --silent --show-error \
  -X POST "$API_URL/api/v1/ai/chat" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d '{"message":"解释热斑复核重点","context":{"eventId":"EVT-240905-018"}}' >/dev/null

echo "Sentinel RGBT smoke test passed."
