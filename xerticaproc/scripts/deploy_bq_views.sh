#!/usr/bin/env bash
# Deploy das views BigQuery do xerticaproc.
# Uso: PROJECT=meu-proj DATASET=xerticaproc_analytics ./deploy_bq_views.sh
set -euo pipefail

PROJECT="${PROJECT:-${GCP_PROJECT_ID:?defina PROJECT ou GCP_PROJECT_ID}}"
DATASET="${DATASET:-xerticaproc_analytics}"
LOCATION="${LOCATION:-US}"
SQL_FILE="$(dirname "$0")/../infra/bigquery/views_copilot.sql"

echo "→ Projeto: $PROJECT"
echo "→ Dataset: $DATASET ($LOCATION)"
echo "→ SQL:     $SQL_FILE"

# Cria dataset se não existir
if ! bq --project_id="$PROJECT" show --format=prettyjson "$DATASET" >/dev/null 2>&1; then
    echo "→ Criando dataset $DATASET..."
    bq --location="$LOCATION" --project_id="$PROJECT" mk -d "$DATASET"
fi

# Substitui ${PROJECT} no SQL e aplica
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
sed "s|\${PROJECT}|${PROJECT}|g" "$SQL_FILE" > "$TMP"

echo "→ Aplicando views..."
bq --project_id="$PROJECT" query --use_legacy_sql=false --quiet < "$TMP"
echo "✓ Views deployadas em $PROJECT.$DATASET"
