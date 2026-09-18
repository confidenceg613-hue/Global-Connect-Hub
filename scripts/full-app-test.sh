#!/usr/bin/env bash
# Full-app endpoint test — hits every API path the pages call.
# Usage:  sh scripts/full-app-test.sh [base-url]
BASE="${1:-http://localhost:8080}"
TOK=$(curl -s -m 8 "$BASE/api/invites?userId=1" | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    print(d[0]['token'] if isinstance(d, list) and d else '')
except Exception:
    print('')" 2>/dev/null)
UID_=1

pass=0; fail=0; failed_list=""

# check NAME METHOD PATH [DATA] [EXPECTED_RE]
check() {
  local name="$1" method="$2" path="$3" data="$4" expect="${5:-^[0-9]+\$}"
  local out code body
  if [ "$method" = "GET" ]; then
    out=$(curl -s -m 15 -w '|%{http_code}' "$BASE$path")
  else
    out=$(curl -s -m 15 -w '|%{http_code}' -X "$method" "$BASE$path" \
      -H 'Content-Type: application/json' -d "${data:-{\}}")
  fi
  code="${out##*|}"
  body="${out%|*}"
  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    pass=$((pass+1)); printf "  ✅ %-46s %s\n" "$name" "$code"
  else
    fail=$((fail+1)); failed_list="$failed_list\n  ❌ $name ($method $path) → HTTP $code: $(echo "$body" | head -c 120)"
    printf "  ❌ %-46s %s  %s\n" "$name" "$code" "$(echo "$body" | head -c 90)"
  fi
}

echo "════════ PAGE: Landing / Auth ════════"
check "POST /api/users (sign in)" POST "/api/users" \
  '{"name":"Full Test","phoneNumber":"08199998888","countryCode":"+234","countryIso":"NG"}'
check "GET /api/users/1" GET "/api/users/1"
check "PATCH /api/users/1 (profile)" PATCH "/api/users/1" '{"name":"Full Test"}'

echo "════════ PAGE: Dashboard ════════"
check "GET /api/consents/summary" GET "/api/consents/summary?userId=$UID_"
check "GET /api/sessions" GET "/api/sessions?userId=$UID_"

echo "════════ PAGE: Invites ════════"
check "GET /api/invites" GET "/api/invites?userId=$UID_"
check "POST /api/invites (create)" POST "/api/invites" \
  "{\"fromUserId\":$UID_,\"toName\":\"PageTest\",\"toPhone\":\"+2348011112222\",\"message\":\"hi\"}"
check "GET /api/invites/by-token/\$TOK" GET "/api/invites/by-token/$TOK"
check "GET /api/invite (flat alias)" GET "/api/invite?token=$TOK"

echo "════════ PAGE: Consent (invitee side) ════════"
check "POST /api/grant (flat)" POST "/api/grant" \
  "{\"token\":\"$TOK\",\"latitude\":9.05,\"longitude\":7.45,\"accuracy\":10}"
check "POST /api/invites/by-token/grant" POST "/api/invites/by-token/$TOK/grant" \
  '{"latitude":9.05,"longitude":7.45,"accuracy":10}'
check "POST /api/location/push" POST "/api/location/push" \
  "{\"token\":\"$TOK\",\"latitude\":9.06,\"longitude\":7.46,\"accuracy\":8,\"status\":\"active\"}"
check "POST /api/location/heartbeat" POST "/api/location/heartbeat" \
  "{\"token\":\"$TOK\",\"batteryLevel\":80,\"batteryCharging\":false}"
check "POST /api/consent-sessions" POST "/api/consent-sessions" \
  "{\"inviteToken\":\"$TOK\",\"timeToGrantMs\":4200,\"events\":[{\"event\":\"opened\",\"ts\":1}]}"

echo "════════ PAGE: Live Map ════════"
check "GET /api/location/latest/\$TOK" GET "/api/location/latest/$TOK"
check "GET /api/location/history/\$TOK" GET "/api/location/history/$TOK"
check "GET /api/geofences/:userId" GET "/api/geofences/$UID_"
check "POST /api/geofences" POST "/api/geofences" \
  "{\"userId\":$UID_,\"name\":\"Test Zone\",\"latitude\":9.05,\"longitude\":7.45,\"radiusMeters\":250}"
check "GET /api/manual-pins/:userId" GET "/api/manual-pins/$UID_"
check "POST /api/manual-pins" POST "/api/manual-pins" \
  "{\"userId\":$UID_,\"name\":\"Test Pin\",\"latitude\":9.06,\"longitude\":7.46}"
check "GET /api/location-overrides/by-token" GET "/api/location-overrides/by-token/$TOK"
check "GET /api/ip-lookup/lan/:userId" GET "/api/ip-lookup/lan/$UID_"

echo "════════ PAGE: Active Sessions ════════"
check "GET /api/sessions (coords+link)" GET "/api/sessions?userId=$UID_"

echo "════════ PAGE: Notifications ════════"
check "GET /api/notifications/:userId" GET "/api/notifications/$UID_"
check "GET /api/notifications/unread-count" GET "/api/notifications/$UID_/unread-count"
check "POST /api/notifications/read-all" POST "/api/notifications/read-all" "{\"userId\":$UID_}"
check "POST /api/push/subscribe" POST "/api/push/subscribe" \
  "{\"userId\":$UID_,\"endpoint\":\"https://example.com/ep\",\"keys\":{\"auth\":\"a\",\"p256dh\":\"b\"}}"

echo "════════ PAGE: Permissions ════════"
check "GET /api/consents" GET "/api/consents?userId=$UID_"

echo "════════ PAGE: Movement Patterns / Behavioral Signatures ════════"
check "GET /api/location/movement-analysis" GET "/api/location/movement-analysis/$TOK"
check "GET /api/movement-patterns" GET "/api/movement-patterns?inviteId=1&userId=$UID_&daysBack=30"

echo "════════ PAGE: Signal Fusion ════════"
check "GET /api/signals/fused/\$TOK" GET "/api/signals/fused/$TOK"
check "POST /api/signals/ingest" POST "/api/signals/ingest" \
  "{\"token\":\"$TOK\",\"sourceType\":\"network\",\"value\":{\"rssi\":-70}}"

echo "════════ PAGE: Location Reports ════════"
check "GET /api/location-reports/by-user" GET "/api/location-reports/by-user/$UID_"

echo "════════ PAGE: Guardian ════════"
check "GET /api/guardian/brief" GET "/api/guardian/brief?userId=$UID_"

echo "════════ PAGE: GeoBoard / Evidence Vault ════════"
check "GET /api/geo-photos/by-user" GET "/api/geo-photos/by-user/$UID_"
check "GET /api/geo-videos/by-user" GET "/api/geo-videos/by-user/$UID_"

echo "════════ PAGE: GMap (group shares) ════════"
check "GET /api/group-shares" GET "/api/group-shares?userId=$UID_"

echo "════════ PAGE: IP Lookup ════════"
check "GET /api/ip-lookup/my-ip" GET "/api/ip-lookup/my-ip"
check "GET /api/ip-lookup?ip=" GET "/api/ip-lookup?ip=8.8.8.8"

echo "════════ PAGE: Settings ════════"
check "GET /api/location-updates/:userId (export)" GET "/api/location-updates/$UID_"
check "GET /api/push/vapid-key" GET "/api/push/vapid-key"

echo "════════ PAGE: Subscription / Access ════════"
check "GET /api/access/:userId/status" GET "/api/access/$UID_/status"
check "GET /api/access/payment-info" GET "/api/access/payment-info"

echo "════════ Supporting services ════════"
check "GET /api/healthz" GET "/api/healthz"
check "POST /api/assistant" POST "/api/assistant" \
  '{"message":"where is my contact?","history":[]}'
check "GET /api/whatsapp/link" GET "/api/whatsapp/link?phone=%2B2348011112222"

echo ""
echo "════════════════════════════════════════"
echo "  PASSED: $pass    FAILED: $fail"
echo "════════════════════════════════════════"
[ "$fail" -gt 0 ] && printf "Failures:%b\n" "$failed_list"
exit 0
