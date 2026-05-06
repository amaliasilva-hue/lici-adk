"""Conector para a API do PNCP (Portal Nacional de Contratações Públicas).

Documentação: https://pncp.gov.br/api/pncp/swagger-ui/index.html

Endpoints usados:
  GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens
  GET /v1/atas                → atas de registro de preço
  GET /v1/contratos           → contratos publicados
  GET /v1/pca/itens           → itens do plano de contratação

O conector é chamado via Cloud Tasks para respeitar rate limiting.
Cada chamada registra resultado em AlloyDB (fontes_mercado + itens_mercado).
"""
from __future__ import annotations

import hashlib
import logging
import time
from datetime import date, datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx
from pydantic import BaseModel

from xerticaproc.backend.models.schemas import (
    ItemPreco,
    TipoFonteMercado,
    UnidadeMedida,
)

log = logging.getLogger("xerticaproc.connectors.pncp")

PNCP_BASE = "https://pncp.gov.br/api/pncp"
# Rate limit oficial: 60 req/min por IP
_REQUEST_DELAY_S = 1.1
_TIMEOUT_S = 30
_MAX_RETRIES = 3


class PNCPClient:
    """Cliente HTTP para o PNCP com retry e rate limiting.

    Uso:
        client = PNCPClient()
        itens = client.buscar_itens_ata(palavras_chave=["software", "licenca"],
                                         data_inicio=date(2024,1,1))
    """

    def __init__(self, base_url: str = PNCP_BASE):
        self._base = base_url
        self._client = httpx.Client(
            base_url=base_url,
            timeout=_TIMEOUT_S,
            headers={
                "Accept": "application/json",
                "User-Agent": "xerticaproc/1.0 (contato@xertica.com)",
            },
        )
        self._last_request_ts: float = 0.0

    def _throttle(self) -> None:
        """Garante intervalo mínimo entre requisições."""
        elapsed = time.monotonic() - self._last_request_ts
        if elapsed < _REQUEST_DELAY_S:
            time.sleep(_REQUEST_DELAY_S - elapsed)
        self._last_request_ts = time.monotonic()

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """GET com retry exponencial."""
        for attempt in range(1, _MAX_RETRIES + 1):
            self._throttle()
            try:
                resp = self._client.get(path, params=params)
                if resp.status_code == 429:
                    wait = 60 * attempt
                    log.warning("pncp.rate_limit", extra={"wait_s": wait, "path": path})
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as exc:
                if attempt == _MAX_RETRIES:
                    log.error("pncp.http_error", extra={"status": exc.response.status_code, "path": path})
                    raise
                time.sleep(2 ** attempt)
            except httpx.RequestError as exc:
                if attempt == _MAX_RETRIES:
                    log.error("pncp.request_error", extra={"error": str(exc), "path": path})
                    raise
                time.sleep(2 ** attempt)
        return {}

    # ── Atas de Registro de Preço ─────────────────────────────────────────────

    def buscar_atas(
        self,
        palavras_chave: list[str],
        data_inicio: date | None = None,
        data_fim: date | None = None,
        pagina: int = 1,
        tamanho_pagina: int = 50,
    ) -> list[dict[str, Any]]:
        """Busca atas de registro de preço no PNCP."""
        if data_inicio is None:
            data_inicio = date.today() - timedelta(days=730)  # 2 anos
        if data_fim is None:
            data_fim = date.today()

        params: dict[str, Any] = {
            "dataInicial": data_inicio.strftime("%Y%m%d"),
            "dataFinal": data_fim.strftime("%Y%m%d"),
            "pagina": pagina,
            "tamanhoPagina": tamanho_pagina,
        }
        if palavras_chave:
            params["q"] = " ".join(palavras_chave[:5])  # limitar a 5 termos

        resultado = self._get("/v1/atas", params=params)
        return resultado.get("data", [])

    def buscar_itens_ata(
        self,
        palavras_chave: list[str],
        data_inicio: date | None = None,
        data_fim: date | None = None,
        catmat: str | None = None,
        catser: str | None = None,
        limite: int = 100,
    ) -> list[dict[str, Any]]:
        """Busca itens de atas com filtros específicos."""
        atas = self.buscar_atas(palavras_chave, data_inicio, data_fim)
        itens: list[dict[str, Any]] = []

        for ata in atas[:20]:  # máximo 20 atas por busca
            orgao_cnpj = ata.get("orgaoEntidade", {}).get("cnpj")
            ano = ata.get("anoCompra")
            seq = ata.get("sequencialCompra")
            if not all([orgao_cnpj, ano, seq]):
                continue
            try:
                resultado = self._get(
                    f"/v1/orgaos/{orgao_cnpj}/compras/{ano}/{seq}/itens",
                    params={"pagina": 1, "tamanhoPagina": 50},
                )
                for item in resultado.get("data", []):
                    item["_ata"] = ata  # injetar contexto da ata
                    itens.append(item)
                    if len(itens) >= limite:
                        return itens
            except Exception as e:
                log.warning("pncp.itens_ata_error", extra={"ata": seq, "error": str(e)})
                continue

        return itens

    # ── Contratos ─────────────────────────────────────────────────────────────

    def buscar_contratos(
        self,
        palavras_chave: list[str],
        data_inicio: date | None = None,
        data_fim: date | None = None,
        pagina: int = 1,
        tamanho_pagina: int = 50,
    ) -> list[dict[str, Any]]:
        """Busca contratos publicados no PNCP."""
        if data_inicio is None:
            data_inicio = date.today() - timedelta(days=730)
        if data_fim is None:
            data_fim = date.today()

        params: dict[str, Any] = {
            "dataInicial": data_inicio.strftime("%Y%m%d"),
            "dataFinal": data_fim.strftime("%Y%m%d"),
            "pagina": pagina,
            "tamanhoPagina": tamanho_pagina,
        }
        if palavras_chave:
            params["q"] = " ".join(palavras_chave[:5])

        resultado = self._get("/v1/contratos", params=params)
        return resultado.get("data", [])

    # ── PCA — Plano de Contratação Anual ─────────────────────────────────────

    def buscar_itens_pca(
        self,
        palavras_chave: list[str],
        ano: int | None = None,
        pagina: int = 1,
        tamanho_pagina: int = 50,
    ) -> list[dict[str, Any]]:
        """Busca itens do Plano de Contratação Anual."""
        if ano is None:
            ano = date.today().year
        params: dict[str, Any] = {
            "ano": ano,
            "pagina": pagina,
            "tamanhoPagina": tamanho_pagina,
        }
        if palavras_chave:
            params["q"] = " ".join(palavras_chave[:5])
        resultado = self._get("/v1/pca/itens", params=params)
        return resultado.get("data", [])

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "PNCPClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


# ─────────────────────────────────────────────────────────────────────────────
# Normalização dos dados brutos do PNCP para ItemPreco
# ─────────────────────────────────────────────────────────────────────────────

def _inferir_unidade(descricao: str, unidade_raw: str) -> UnidadeMedida:
    """Infere UnidadeMedida a partir de texto livre."""
    texto = f"{descricao} {unidade_raw}".lower()
    if any(t in texto for t in ["usuário", "usuario", "user", "usr"]):
        return UnidadeMedida.USUARIO
    if any(t in texto for t in ["licença", "licenca", "license"]):
        return UnidadeMedida.LICENCA
    if "ust" in texto:
        return UnidadeMedida.UST
    if any(t in texto for t in ["hora técnica", "hora tecnica", "h.t.", "ht "]):
        return UnidadeMedida.HORA_TECNICA
    if any(t in texto for t in ["ponto de função", "point function", "pfunc"]):
        return UnidadeMedida.PONTO_FUNCAO
    if any(t in texto for t in ["crédito", "credito", "credit"]):
        return UnidadeMedida.CREDITO_NUVEM
    if any(t in texto for t in ["pacote", "package", "bundle"]):
        return UnidadeMedida.PACOTE
    if any(t in texto for t in [" mês", " mes", "mensal", "monthly"]):
        return UnidadeMedida.MES
    if any(t in texto for t in [" ano", "anual", "yearly"]):
        return UnidadeMedida.ANO
    return UnidadeMedida.ITEM


def normalizar_item_pncp(item_raw: dict[str, Any]) -> ItemPreco | None:
    """Converte um item bruto do PNCP para ItemPreco normalizado."""
    try:
        ata = item_raw.get("_ata", {})
        descricao = item_raw.get("descricao", "")
        unidade_raw = item_raw.get("unidadeMedida", item_raw.get("unidade", ""))
        valor_unitario = float(item_raw.get("valorUnitarioEstimado", 0) or 0)

        if valor_unitario <= 0:
            return None  # item sem valor não é útil

        quantidade = float(item_raw.get("quantidade", 1) or 1)
        unidade_normalizada = _inferir_unidade(descricao, unidade_raw)
        vigencia_meses: int | None = None

        # Tentar extrair vigência da ata
        vigencia_str = ata.get("vigenciaFim") or ata.get("dataVigenciaFim")
        vigencia_inicio_str = ata.get("vigenciaInicio") or ata.get("dataVigenciaInicio")
        if vigencia_str and vigencia_inicio_str:
            try:
                fmt = "%Y-%m-%dT%H:%M:%S" if "T" in vigencia_str else "%Y-%m-%d"
                fim = datetime.strptime(vigencia_str[:10], "%Y-%m-%d").date()
                inicio = datetime.strptime(vigencia_inicio_str[:10], "%Y-%m-%d").date()
                delta = (fim - inicio).days
                vigencia_meses = max(1, round(delta / 30))
            except Exception:
                pass

        valor_mensal = None
        if vigencia_meses and unidade_normalizada in (UnidadeMedida.USUARIO, UnidadeMedida.LICENCA):
            valor_mensal = valor_unitario / vigencia_meses if vigencia_meses > 0 else None

        # Data de publicação
        data_pub = None
        dp_str = ata.get("dataPublicacaoPncp") or ata.get("dataInclusao")
        if dp_str:
            try:
                data_pub = datetime.strptime(dp_str[:10], "%Y-%m-%d").date()
            except Exception:
                pass

        orgao_info = ata.get("orgaoEntidade", {})
        numero_documento = (
            f"ATA-{ata.get('anoCompra', '')}-{ata.get('sequencialCompra', '')}"
        )

        return ItemPreco(
            fonte_tipo=TipoFonteMercado.PNCP,
            orgao=orgao_info.get("razaoSocial") or orgao_info.get("nome"),
            numero_documento=numero_documento,
            url=f"https://pncp.gov.br/app/editais/{orgao_info.get('cnpj')}/{ata.get('anoCompra')}/{ata.get('sequencialCompra')}",
            data_publicacao=data_pub,
            descricao_original=descricao,
            descricao_normalizada=descricao.strip().lower(),
            fabricante=item_raw.get("fabricante"),
            catmat=item_raw.get("codigoCatalogo") if item_raw.get("tipoCatalogo") == "CATMAT" else None,
            catser=item_raw.get("codigoCatalogo") if item_raw.get("tipoCatalogo") == "CATSER" else None,
            unidade_original=unidade_raw,
            unidade_normalizada=unidade_normalizada,
            quantidade=quantidade,
            valor_unitario=valor_unitario,
            valor_total=valor_unitario * quantidade,
            vigencia_meses=vigencia_meses,
            valor_mensal_por_unidade=valor_mensal,
        )
    except Exception as e:
        log.warning("pncp.normalize_error", extra={"error": str(e), "item": str(item_raw)[:200]})
        return None


def coletar_itens_pncp(
    palavras_chave: list[str],
    data_inicio: date | None = None,
    data_fim: date | None = None,
    catmat: str | None = None,
    catser: str | None = None,
    limite: int = 100,
) -> list[ItemPreco]:
    """Coleta, normaliza e retorna itens do PNCP prontos para o pipeline de comparabilidade."""
    with PNCPClient() as client:
        itens_raw = client.buscar_itens_ata(
            palavras_chave=palavras_chave,
            data_inicio=data_inicio,
            data_fim=data_fim,
            catmat=catmat,
            catser=catser,
            limite=limite,
        )

    itens: list[ItemPreco] = []
    for raw in itens_raw:
        item = normalizar_item_pncp(raw)
        if item:
            itens.append(item)

    log.info(
        "pncp.coleta_concluida",
        extra={"total_raw": len(itens_raw), "normalizados": len(itens)},
    )
    return itens
