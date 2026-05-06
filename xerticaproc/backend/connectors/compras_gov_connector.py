"""Conector para Compras.gov / Dados Abertos do Governo Federal.

Fontes:
  1. API Compras.gov.br  — itens homologados em pregões e dispensas
     Base: https://compras.dados.gov.br/v1/
  2. Painel de Preços    — compras homologadas com referência de mercado
     Base: https://paineldeprecos.planejamento.gov.br/api/v1/

Ambas as APIs são públicas (sem autenticação).
Chamadas via Cloud Tasks para respeitar rate limiting.
"""
from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta
from typing import Any

import httpx

from xerticaproc.backend.connectors.pncp_connector import _inferir_unidade
from xerticaproc.backend.models.schemas import (
    ItemPreco,
    TipoFonteMercado,
    UnidadeMedida,
)

log = logging.getLogger("xerticaproc.connectors.compras_gov")

COMPRAS_GOV_BASE = "https://compras.dados.gov.br/v1"
PAINEL_PRECOS_BASE = "https://paineldeprecos.planejamento.gov.br/api/v1"

_REQUEST_DELAY_S = 1.0
_TIMEOUT_S = 30
_MAX_RETRIES = 3


class ComprasGovClient:
    """Cliente para a API de Dados Abertos do Compras.gov.br."""

    def __init__(self, base_url: str = COMPRAS_GOV_BASE):
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
        elapsed = time.monotonic() - self._last_request_ts
        if elapsed < _REQUEST_DELAY_S:
            time.sleep(_REQUEST_DELAY_S - elapsed)
        self._last_request_ts = time.monotonic()

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        for attempt in range(1, _MAX_RETRIES + 1):
            self._throttle()
            try:
                resp = self._client.get(path, params=params)
                if resp.status_code == 429:
                    wait = 60 * attempt
                    log.warning("compras_gov.rate_limit", extra={"wait_s": wait})
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as exc:
                if attempt == _MAX_RETRIES:
                    raise
                time.sleep(2 ** attempt)
            except httpx.RequestError as exc:
                if attempt == _MAX_RETRIES:
                    raise
                time.sleep(2 ** attempt)
        return {}

    def buscar_itens(
        self,
        descricao: str,
        codigo_catmat: str | None = None,
        codigo_catser: str | None = None,
        data_inicio: date | None = None,
        data_fim: date | None = None,
        pagina: int = 1,
        tamanho_pagina: int = 50,
    ) -> list[dict[str, Any]]:
        """Busca itens de compras homologadas."""
        if data_inicio is None:
            data_inicio = date.today() - timedelta(days=730)
        if data_fim is None:
            data_fim = date.today()

        params: dict[str, Any] = {
            "descricao": descricao[:100],
            "dataInicio": data_inicio.isoformat(),
            "dataFim": data_fim.isoformat(),
            "pagina": pagina,
            "tamanhoPagina": tamanho_pagina,
        }
        if codigo_catmat:
            params["codigoItemCatalogo"] = codigo_catmat
        if codigo_catser:
            params["codigoItemCatalogo"] = codigo_catser

        resultado = self._get("/itens-homologados", params=params)
        return resultado.get("_embedded", {}).get("itens", resultado.get("data", []))

    def buscar_contratos(
        self,
        descricao: str,
        data_inicio: date | None = None,
        data_fim: date | None = None,
        pagina: int = 1,
        tamanho_pagina: int = 50,
    ) -> list[dict[str, Any]]:
        """Busca contratos publicados."""
        if data_inicio is None:
            data_inicio = date.today() - timedelta(days=730)
        if data_fim is None:
            data_fim = date.today()

        params: dict[str, Any] = {
            "objeto": descricao[:100],
            "dataInicio": data_inicio.isoformat(),
            "dataFim": data_fim.isoformat(),
            "pagina": pagina,
            "tamanhoPagina": tamanho_pagina,
        }
        resultado = self._get("/contratos", params=params)
        return resultado.get("data", [])

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "ComprasGovClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


class PainelPrecosClient:
    """Cliente para o Painel de Preços (paineldeprecos.planejamento.gov.br).

    O Painel de Preços é a referência mais confiável para compras homologadas
    no Compras.gov.br — inclui preço médio, mediana e menor preço já calculados.
    """

    def __init__(self, base_url: str = PAINEL_PRECOS_BASE):
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
        elapsed = time.monotonic() - self._last_request_ts
        if elapsed < _REQUEST_DELAY_S:
            time.sleep(_REQUEST_DELAY_S - elapsed)
        self._last_request_ts = time.monotonic()

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        for attempt in range(1, _MAX_RETRIES + 1):
            self._throttle()
            try:
                resp = self._client.get(path, params=params)
                if resp.status_code == 429:
                    time.sleep(60 * attempt)
                    continue
                resp.raise_for_status()
                return resp.json()
            except (httpx.HTTPStatusError, httpx.RequestError):
                if attempt == _MAX_RETRIES:
                    raise
                time.sleep(2 ** attempt)
        return {}

    def pesquisar_preco(
        self,
        descricao: str,
        codigo_catmat: str | None = None,
        pagina: int = 1,
        tamanho_pagina: int = 50,
    ) -> list[dict[str, Any]]:
        """Pesquisa preços no painel."""
        params: dict[str, Any] = {
            "descricao": descricao[:100],
            "pagina": pagina,
            "tamanhoPagina": tamanho_pagina,
        }
        if codigo_catmat:
            params["codigoItemCatalogo"] = codigo_catmat

        resultado = self._get("/precos", params=params)
        return resultado.get("data", resultado.get("items", []))

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "PainelPrecosClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


# ─────────────────────────────────────────────────────────────────────────────
# Normalização dos dados brutos → ItemPreco
# ─────────────────────────────────────────────────────────────────────────────

def normalizar_item_compras_gov(item_raw: dict[str, Any]) -> ItemPreco | None:
    """Converte item bruto do Compras.gov para ItemPreco."""
    try:
        descricao = item_raw.get("descricaoItem", item_raw.get("descricao", ""))
        unidade_raw = item_raw.get("unidadeFornecimento", item_raw.get("unidade", ""))
        valor_unitario = float(
            item_raw.get("valorUnitario", item_raw.get("precoUnitario", 0)) or 0
        )
        if valor_unitario <= 0:
            return None

        quantidade = float(item_raw.get("quantidade", 1) or 1)
        unidade_norm = _inferir_unidade(descricao, unidade_raw)

        data_pub = None
        dp_str = item_raw.get("dataResultado", item_raw.get("dataHomologacao"))
        if dp_str:
            try:
                data_pub = datetime.strptime(dp_str[:10], "%Y-%m-%d").date()
            except Exception:
                pass

        numero_documento = (
            item_raw.get("numeroProcesso")
            or item_raw.get("numeroPregao")
            or str(item_raw.get("id", ""))
        )

        uasg = item_raw.get("codigoUASG", item_raw.get("uasg", ""))
        orgao = item_raw.get("nomeOrgao", item_raw.get("orgao", ""))
        catmat = (
            item_raw.get("codigoItemCatalogo")
            if item_raw.get("tipoCatalogo") == "CATMAT"
            else None
        )

        return ItemPreco(
            fonte_tipo=TipoFonteMercado.COMPRAS_GOV,
            orgao=orgao,
            numero_documento=numero_documento,
            url=f"https://compras.dados.gov.br/v1/itens-homologados/{item_raw.get('id', '')}",
            data_publicacao=data_pub,
            descricao_original=descricao,
            descricao_normalizada=descricao.strip().lower(),
            catmat=catmat,
            unidade_original=unidade_raw,
            unidade_normalizada=unidade_norm,
            quantidade=quantidade,
            valor_unitario=valor_unitario,
            valor_total=valor_unitario * quantidade,
        )
    except Exception as e:
        log.warning("compras_gov.normalize_error", extra={"error": str(e)})
        return None


def normalizar_item_painel_precos(item_raw: dict[str, Any]) -> ItemPreco | None:
    """Converte item bruto do Painel de Preços para ItemPreco."""
    try:
        descricao = item_raw.get("descricao", "")
        unidade_raw = item_raw.get("unidade", "")
        # Painel já entrega preço médio, mediana e menor preço
        # Usamos o preço médio como valor de referência
        valor_unitario = float(
            item_raw.get("precoMedio", item_raw.get("media", 0)) or 0
        )
        if valor_unitario <= 0:
            return None

        quantidade = float(item_raw.get("quantidade", 1) or 1)
        unidade_norm = _inferir_unidade(descricao, unidade_raw)

        return ItemPreco(
            fonte_tipo=TipoFonteMercado.PAINEL_PRECOS,
            orgao=item_raw.get("ufOrgao", ""),
            numero_documento=str(item_raw.get("id", "")),
            url="https://paineldeprecos.planejamento.gov.br",
            descricao_original=descricao,
            descricao_normalizada=descricao.strip().lower(),
            catmat=item_raw.get("codigoItemCatalogo"),
            unidade_original=unidade_raw,
            unidade_normalizada=unidade_norm,
            quantidade=quantidade,
            valor_unitario=valor_unitario,
            valor_total=valor_unitario * quantidade,
        )
    except Exception as e:
        log.warning("painel_precos.normalize_error", extra={"error": str(e)})
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Função pública: coletar de todas as fontes gov
# ─────────────────────────────────────────────────────────────────────────────

def coletar_itens_compras_gov(
    descricao: str,
    palavras_chave: list[str] | None = None,
    catmat: str | None = None,
    data_inicio: date | None = None,
    data_fim: date | None = None,
    limite: int = 100,
) -> list[ItemPreco]:
    """Coleta itens do Compras.gov.br e Painel de Preços, normaliza e retorna."""
    query = descricao
    if palavras_chave:
        query = f"{descricao} {' '.join(palavras_chave[:3])}"

    itens: list[ItemPreco] = []

    # Compras.gov
    try:
        with ComprasGovClient() as client:
            raw_compras = client.buscar_itens(
                descricao=query,
                codigo_catmat=catmat,
                data_inicio=data_inicio,
                data_fim=data_fim,
                tamanho_pagina=min(limite, 50),
            )
        for raw in raw_compras:
            item = normalizar_item_compras_gov(raw)
            if item:
                itens.append(item)
    except Exception as e:
        log.error("compras_gov.coleta_error", extra={"error": str(e)})

    # Painel de Preços
    try:
        with PainelPrecosClient() as client:
            raw_painel = client.pesquisar_preco(
                descricao=descricao,
                codigo_catmat=catmat,
                tamanho_pagina=min(limite, 50),
            )
        for raw in raw_painel:
            item = normalizar_item_painel_precos(raw)
            if item:
                itens.append(item)
    except Exception as e:
        log.error("painel_precos.coleta_error", extra={"error": str(e)})

    log.info(
        "compras_gov.coleta_concluida",
        extra={"total_itens": len(itens)},
    )
    return itens[:limite]
