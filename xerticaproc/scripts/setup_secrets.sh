#!/usr/bin/env bash
# setup_secrets.sh — cria/atualiza as secrets do xerticaproc no Secret Manager
# Uso: bash setup_secrets.sh
# Requer: gcloud autenticado com permissão secretmanager.admin

set -euo pipefail

PROJECT="operaciones-br"
REGION="us-central1"

gcloud config set project "${PROJECT}" --quiet

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  xerticaproc — Secret Manager setup"
echo "  Projeto: ${PROJECT}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── helper ────────────────────────────────────────────────────────────────────
upsert_secret() {
  local SECRET_ID="$1"
  local VALUE="$2"

  # cria a secret se não existir
  if ! gcloud secrets describe "${SECRET_ID}" --project="${PROJECT}" &>/dev/null; then
    echo "  [+] Criando secret: ${SECRET_ID}"
    gcloud secrets create "${SECRET_ID}" \
      --project="${PROJECT}" \
      --replication-policy="automatic" \
      --quiet
  else
    echo "  [~] Secret já existe, adicionando nova versão: ${SECRET_ID}"
  fi

  # adiciona versão com o valor
  echo -n "${VALUE}" | gcloud secrets versions add "${SECRET_ID}" \
    --project="${PROJECT}" \
    --data-file=- \
    --quiet

  echo "  ✓ ${SECRET_ID}"
}

# ── 1. AlloyDB URI ────────────────────────────────────────────────────────────
echo "1/4  ALLOYDB_URL"
echo "     Formato: postgresql+asyncpg://USER:PASSWORD@HOST/DBNAME"
echo "     (obtenha o IP do AlloyDB após o terraform apply)"
read -r -p "     Valor: " ALLOYDB_URL
upsert_secret "xerticaproc-alloydb-uri" "${ALLOYDB_URL}"
echo ""

# ── 2. NextAuth Secret (gerado se deixar em branco) ───────────────────────────
echo "2/4  NEXTAUTH_SECRET"
echo "     String aleatória de 32+ chars. Pressione ENTER para gerar automaticamente."
read -r -p "     Valor (ou ENTER para gerar): " NEXTAUTH_SECRET
if [[ -z "${NEXTAUTH_SECRET}" ]]; then
  NEXTAUTH_SECRET=$(openssl rand -base64 32)
  echo "     Gerado: ${NEXTAUTH_SECRET}"
fi
upsert_secret "xerticaproc-nextauth-secret" "${NEXTAUTH_SECRET}"
echo ""

# ── 3. Google OAuth Client ID ─────────────────────────────────────────────────
echo "3/4  GOOGLE_CLIENT_ID"
echo "     Obtenha em: console.cloud.google.com → APIs → Credenciais → OAuth 2.0"
read -r -p "     Valor: " GOOGLE_CLIENT_ID
upsert_secret "xerticaproc-google-client-id" "${GOOGLE_CLIENT_ID}"
echo ""

# ── 4. Google OAuth Client Secret ────────────────────────────────────────────
echo "4/4  GOOGLE_CLIENT_SECRET"
read -r -s -p "     Valor (oculto): " GOOGLE_CLIENT_SECRET
echo ""
upsert_secret "xerticaproc-google-client-secret" "${GOOGLE_CLIENT_SECRET}"
echo ""

# ── resumo ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Secrets configuradas com sucesso:"
gcloud secrets list --project="${PROJECT}" --filter="name:xerticaproc-" \
  --format="table(name.basename(), createTime.date())"
echo ""
echo "  Próximo passo:"
echo "    cd xerticaproc/infra/terraform"
echo "    terraform init"
echo "    terraform plan -var=\"project_id=${PROJECT}\""
echo "    terraform apply -var=\"project_id=${PROJECT}\""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
