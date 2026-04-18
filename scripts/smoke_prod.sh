#!/usr/bin/env bash
# Smoke test do lici-adk-backend em produção.
# Uso: ./scripts/smoke_prod.sh /caminho/para/edital.pdf
set -euo pipefail

PDF="${1:?Uso: $0 <pdf>}"
SERVICE="${LICI_SERVICE:-lici-adk-backend}"
REGION="${LICI_REGION:-us-central1}"
PROJECT="${LICI_PROJECT:-operaciones-br}"

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')
TOKEN=$(gcloud auth print-identity-token)

echo ">>> Service: $URL"
echo ">>> PDF    : $PDF ($(stat -c%s "$PDF") bytes)"
echo

echo "--- POST /analyze ---"
RESP=$(curl -sS -X POST "$URL/analyze" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$PDF")
echo "$RESP"
ID=$(echo "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["analysis_id"])')
echo
echo "--- Polling /analyze/$ID ---"

for i in $(seq 1 60); do
    sleep 5
    STATUS_RESP=$(curl -sS -H "Authorization: Bearer $TOKEN" "$URL/analyze/$ID")
    STATUS=$(echo "$STATUS_RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')
    printf "  [%02ds] status=%s\n" $((i*5)) "$STATUS"
    if [[ "$STATUS" == "done" || "$STATUS" == "failed" ]]; then
        echo
        echo "--- RESULT ---"
        echo "$STATUS_RESP" | python3 -m json.tool
        exit 0
    fi
done

echo "TIMEOUT after 5min"
exit 1
