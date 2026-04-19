"""Gerador de Documentos e Declarações Padrão — Fase 5 (Grupo B).

Preenche templates fixos de declarações com dados da Xertica (xertica_profile.yaml)
e dados do edital (EditalEstruturado), sem chamar nenhum LLM.

Grupo B — 4 declarações geradas em todo processo:
  1. Não emprega menor (art. 7º XIV CF + art. 68 V Lei 14.133)
  2. Idoneidade (art. 68 I Lei 14.133)
  3. Cumprimento dos requisitos de habilitação (art. 69 Lei 14.133)
  4. Inexistência de fato superveniente impeditivo (art. 68 II Lei 14.133)

Declarações condicionais (geradas se o edital as exigir):
  5. Pleno conhecimento das condições
  6. Autenticidade dos documentos
  7. Vínculo dos técnicos designados
  8. Carta de credenciamento (sessão presencial)

Ref: architecture2.md §6.7.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from backend.models.schemas import EditalEstruturado

_PROFILE_PATH = Path(__file__).resolve().parent.parent / "xertica_profile.yaml"


@lru_cache(maxsize=1)
def _empresa() -> dict:
    if not _PROFILE_PATH.exists():
        return {}
    full = yaml.safe_load(_PROFILE_PATH.read_text())
    return full.get("empresa", {})


def _e(d: dict, key: str, fallback: str = "[PREENCHER]") -> str:
    return str(d.get(key) or fallback)


def _edital_info(edital: EditalEstruturado) -> dict[str, str]:
    return {
        "orgao": edital.orgao or "[ÓRGÃO]",
        "uasg": edital.uasg or "[UASG]",
        "objeto": edital.objeto or "[OBJETO]",
        "modalidade": edital.modalidade or "pregão eletrônico",
        "uf": edital.uf or "",
        "data_sessao": edital.data_encerramento or "[DATA DA SESSÃO]",
        "portal": edital.portal or "[PORTAL]",
    }


# ── Templates ────────────────────────────────────────────────────────────────

def _decl_nao_emprega_menor(emp: dict, ed: dict[str, str]) -> str:
    razao = _e(emp, "razao_social")
    cnpj = _e(emp, "cnpj")
    rep = _e(emp, "representante_legal")
    cargo = _e(emp, "cargo_representante")
    cpf = _e(emp, "cpf_representante")
    return f"""\
DECLARAÇÃO DE NÃO UTILIZAÇÃO DE MÃO DE OBRA INFANTIL

À Autoridade Competente / Ao Pregoeiro
{ed["orgao"]} — UASG {ed["uasg"]}

{razao}, inscrita no CNPJ sob o nº {cnpj}, por intermédio de seu representante legal,
o(a) Sr(a). {rep}, {cargo}, portador(a) do CPF nº {cpf}, DECLARA, para os fins do
disposto no art. 7º, inciso XXXIII, da Constituição Federal, e conforme exigido no
art. 68, inciso V, da Lei nº 14.133/2021, que:

I — não emprega menor de dezoito anos em trabalho noturno, perigoso ou insalubre;
II — não emprega menor de dezesseis anos em qualquer trabalho, salvo na condição de
     aprendiz, a partir de quatorze anos, nos termos do art. 7º, inciso XXXIII, da
     Constituição Federal.

Objeto da licitação: {ed["objeto"]}
Modalidade: {ed["modalidade"]}

São Paulo, {ed["data_sessao"]}.

_______________________________________
{rep}
{cargo}
CPF: {cpf}
{razao}
CNPJ: {cnpj}

NOTA: Declaração sujeita a revisão pelo jurídico. Imprimir em papel timbrado e assinar.
"""


def _decl_idoneidade(emp: dict, ed: dict[str, str]) -> str:
    razao = _e(emp, "razao_social")
    cnpj = _e(emp, "cnpj")
    rep = _e(emp, "representante_legal")
    cargo = _e(emp, "cargo_representante")
    cpf = _e(emp, "cpf_representante")
    return f"""\
DECLARAÇÃO DE IDONEIDADE

À Autoridade Competente / Ao Pregoeiro
{ed["orgao"]} — UASG {ed["uasg"]}

{razao}, inscrita no CNPJ sob o nº {cnpj}, por intermédio de seu representante legal,
o(a) Sr(a). {rep}, {cargo}, portador(a) do CPF nº {cpf}, DECLARA, nos termos do art. 68,
inciso I, da Lei nº 14.133/2021, que:

I — não foi declarada inidônea por nenhum órgão ou entidade da Administração Pública
    Federal, Estadual ou Municipal;
II — não está suspensa de participar de licitações e impedida de contratar com órgão
    ou entidade da Administração Pública;
III — não incorre em nenhuma das hipóteses de impedimento previstas no art. 14 da
    Lei nº 14.133/2021;
IV — comunicará imediatamente qualquer fato superveniente que implique irregularidade
    na situação ora declarada.

Objeto da licitação: {ed["objeto"]}
Modalidade: {ed["modalidade"]}

São Paulo, {ed["data_sessao"]}.

_______________________________________
{rep}
{cargo}
CPF: {cpf}
{razao}
CNPJ: {cnpj}

NOTA: Declaração sujeita a revisão pelo jurídico. Imprimir em papel timbrado e assinar.
"""


def _decl_habilitacao(emp: dict, ed: dict[str, str]) -> str:
    razao = _e(emp, "razao_social")
    cnpj = _e(emp, "cnpj")
    rep = _e(emp, "representante_legal")
    cargo = _e(emp, "cargo_representante")
    cpf = _e(emp, "cpf_representante")
    return f"""\
DECLARAÇÃO DE CUMPRIMENTO DOS REQUISITOS DE HABILITAÇÃO

À Autoridade Competente / Ao Pregoeiro
{ed["orgao"]} — UASG {ed["uasg"]}

{razao}, inscrita no CNPJ sob o nº {cnpj}, por intermédio de seu representante legal,
o(a) Sr(a). {rep}, {cargo}, portador(a) do CPF nº {cpf}, DECLARA, nos termos do art. 69
da Lei nº 14.133/2021, que cumpre plenamente os requisitos de habilitação exigidos
no instrumento convocatório do processo licitatório em referência ({ed["modalidade"]} —
{ed["orgao"]} / UASG {ed["uasg"]}), cujo objeto é: {ed["objeto"]}.

A empresa declara ainda que possui regularidade fiscal, trabalhista e previdenciária,
qualificação técnica e econômico-financeira para o cumprimento do objeto licitado,
e que não se encontra em nenhuma das situações impeditivas previstas na legislação.

São Paulo, {ed["data_sessao"]}.

_______________________________________
{rep}
{cargo}
CPF: {cpf}
{razao}
CNPJ: {cnpj}

NOTA: Declaração sujeita a revisão pelo jurídico. Imprimir em papel timbrado e assinar.
"""


def _decl_fato_superveniente(emp: dict, ed: dict[str, str]) -> str:
    razao = _e(emp, "razao_social")
    cnpj = _e(emp, "cnpj")
    rep = _e(emp, "representante_legal")
    cargo = _e(emp, "cargo_representante")
    cpf = _e(emp, "cpf_representante")
    return f"""\
DECLARAÇÃO DE INEXISTÊNCIA DE FATO SUPERVENIENTE IMPEDITIVO

À Autoridade Competente / Ao Pregoeiro
{ed["orgao"]} — UASG {ed["uasg"]}

{razao}, inscrita no CNPJ sob o nº {cnpj}, por intermédio de seu representante legal,
o(a) Sr(a). {rep}, {cargo}, portador(a) do CPF nº {cpf}, DECLARA, nos termos do art. 68,
inciso II, da Lei nº 14.133/2021, que até a presente data inexistem fatos supervenientes
impeditivos para a sua habilitação no presente processo licitatório ({ed["modalidade"]} —
{ed["orgao"]} / UASG {ed["uasg"]}), cujo objeto é: {ed["objeto"]}.

A empresa assume o compromisso de comunicar imediatamente à Administração qualquer
alteração na situação que implique restrição à sua capacidade de contratar com o
Poder Público.

São Paulo, {ed["data_sessao"]}.

_______________________________________
{rep}
{cargo}
CPF: {cpf}
{razao}
CNPJ: {cnpj}

NOTA: Declaração sujeita a revisão pelo jurídico. Imprimir em papel timbrado e assinar.
"""


def _decl_pleno_conhecimento(emp: dict, ed: dict[str, str]) -> str:
    razao = _e(emp, "razao_social")
    cnpj = _e(emp, "cnpj")
    rep = _e(emp, "representante_legal")
    cargo = _e(emp, "cargo_representante")
    cpf = _e(emp, "cpf_representante")
    return f"""\
DECLARAÇÃO DE PLENO CONHECIMENTO DAS CONDIÇÕES DO EDITAL

À Autoridade Competente / Ao Pregoeiro
{ed["orgao"]} — UASG {ed["uasg"]}

{razao}, inscrita no CNPJ sob o nº {cnpj}, por intermédio de seu representante legal,
o(a) Sr(a). {rep}, {cargo}, portador(a) do CPF nº {cpf}, DECLARA que:

I — tomou conhecimento de todas as informações e condições para o cumprimento das
    obrigações objeto da licitação ({ed["modalidade"]} — {ed["orgao"]} / UASG {ed["uasg"]});
II — conhece e aceita todos os termos e condições estabelecidos no Edital e seus
    anexos, inclusive especificações técnicas, prazos e critérios de julgamento;
III — não alega desconhecimento de qualquer cláusula do instrumento convocatório como
    justificativa para inadimplemento de obrigações eventualmente assumidas.

Objeto da licitação: {ed["objeto"]}

São Paulo, {ed["data_sessao"]}.

_______________________________________
{rep}
{cargo}
CPF: {cpf}
{razao}
CNPJ: {cnpj}

NOTA: Declaração sujeita a revisão pelo jurídico. Imprimir em papel timbrado e assinar.
"""


def _decl_autenticidade(emp: dict, ed: dict[str, str]) -> str:
    razao = _e(emp, "razao_social")
    cnpj = _e(emp, "cnpj")
    rep = _e(emp, "representante_legal")
    cargo = _e(emp, "cargo_representante")
    cpf = _e(emp, "cpf_representante")
    return f"""\
DECLARAÇÃO DE AUTENTICIDADE DOS DOCUMENTOS

À Autoridade Competente / Ao Pregoeiro
{ed["orgao"]} — UASG {ed["uasg"]}

{razao}, inscrita no CNPJ sob o nº {cnpj}, por intermédio de seu representante legal,
o(a) Sr(a). {rep}, {cargo}, portador(a) do CPF nº {cpf}, DECLARA que todos os
documentos apresentados para a habilitação no presente certame ({ed["modalidade"]} —
{ed["orgao"]} / UASG {ed["uasg"]}, objeto: {ed["objeto"]}) são autênticos e fidedignos,
estando ciente de que a falsidade ou adulteração de qualquer documento acarreta as
sanções previstas no art. 155 e seguintes da Lei nº 14.133/2021, além das penalidades
na esfera civil e criminal.

São Paulo, {ed["data_sessao"]}.

_______________________________________
{rep}
{cargo}
CPF: {cpf}
{razao}
CNPJ: {cnpj}

NOTA: Declaração sujeita a revisão pelo jurídico. Imprimir em papel timbrado e assinar.
"""


def _decl_vinculo_tecnicos(emp: dict, ed: dict[str, str]) -> str:
    razao = _e(emp, "razao_social")
    cnpj = _e(emp, "cnpj")
    rep = _e(emp, "representante_legal")
    cargo = _e(emp, "cargo_representante")
    cpf = _e(emp, "cpf_representante")
    return f"""\
DECLARAÇÃO DE VÍNCULO DOS PROFISSIONAIS TÉCNICOS

À Autoridade Competente / Ao Pregoeiro
{ed["orgao"]} — UASG {ed["uasg"]}

{razao}, inscrita no CNPJ sob o nº {cnpj}, por intermédio de seu representante legal,
o(a) Sr(a). {rep}, {cargo}, portador(a) do CPF nº {cpf}, DECLARA que os profissionais
técnicos designados para a execução do objeto desta licitação ({ed["objeto"]}) possuem
vínculo empregatício ou contratual com a empresa, seja mediante contrato de trabalho
(CLT), contrato de prestação de serviços ou outro vínculo legítimo, e que estarão
disponíveis para a prestação dos serviços pelo prazo contratual.

[PREENCHER: listar profissionais, cargos e CPFs conforme exigido pelo edital]

São Paulo, {ed["data_sessao"]}.

_______________________________________
{rep}
{cargo}
CPF: {cpf}
{razao}
CNPJ: {cnpj}

NOTA: Preencher nomes/CPFs dos técnicos antes de assinar. Revisão obrigatória pelo jurídico.
"""


def _carta_credenciamento(emp: dict, ed: dict[str, str]) -> str:
    razao = _e(emp, "razao_social")
    cnpj = _e(emp, "cnpj")
    rep = _e(emp, "representante_legal")
    cargo = _e(emp, "cargo_representante")
    cpf = _e(emp, "cpf_representante")
    return f"""\
CARTA DE CREDENCIAMENTO

À Autoridade Competente / Ao Pregoeiro
{ed["orgao"]} — UASG {ed["uasg"]}

{razao}, inscrita no CNPJ sob o nº {cnpj}, CREDENCIA o(a) Sr(a).
[NOME DO CREDENCIADO], portador(a) do CPF nº [CPF DO CREDENCIADO] e do RG nº
[RG DO CREDENCIADO], para representá-la na sessão pública do {ed["modalidade"]}
promovido por esta entidade, cujo objeto é: {ed["objeto"]}.

O credenciado fica autorizado a praticar todos os atos inerentes ao certame, inclusive
formular lances verbais, firmar declarações, interpor recursos e renunciar ao direito
de recorrer, em nome de {razao}.

São Paulo, {ed["data_sessao"]}.

_______________________________________
{rep}
{cargo} — outorgante
CPF: {cpf}
{razao}
CNPJ: {cnpj}

NOTA: Preencher nome/CPF/RG do credenciado antes de assinar. Revisão obrigatória pelo jurídico.
"""


# ── Ponto de entrada público ─────────────────────────────────────────────────

# Mapa tipo → função geradora
_GERADORES: dict[str, object] = {
    "nao_emprega_menor": _decl_nao_emprega_menor,
    "idoneidade": _decl_idoneidade,
    "habilitacao": _decl_habilitacao,
    "fato_superveniente": _decl_fato_superveniente,
    "pleno_conhecimento": _decl_pleno_conhecimento,
    "autenticidade": _decl_autenticidade,
    "vinculo_tecnicos": _decl_vinculo_tecnicos,
    "credenciamento": _carta_credenciamento,
}

# Declarações sempre geradas (Grupo B obrigatório)
_OBRIGATORIAS = ["nao_emprega_menor", "idoneidade", "habilitacao", "fato_superveniente"]


def gerar_declaracoes(
    edital: EditalEstruturado,
    *,
    incluir_condicionais: list[str] | None = None,
) -> dict[str, str]:
    """Gera declarações padrão preenchidas com dados da Xertica + edital.

    Args:
        edital: EditalEstruturado (saída do Extrator).
        incluir_condicionais: lista de chaves condicionais a incluir além das obrigatórias.
            Possíveis: "pleno_conhecimento", "autenticidade", "vinculo_tecnicos", "credenciamento"

    Returns:
        dict tipo → texto da declaração (markdown/text). Chaves = _OBRIGATORIAS + condicionais.
    """
    emp = _empresa()
    ed = _edital_info(edital)

    tipos = list(_OBRIGATORIAS) + list(incluir_condicionais or [])

    resultado: dict[str, str] = {}
    for tipo in tipos:
        fn = _GERADORES.get(tipo)
        if fn:
            resultado[tipo] = fn(emp, ed)  # type: ignore[call-arg]

    return resultado


def listar_tipos_disponiveis() -> list[str]:
    """Retorna todos os tipos de declaração disponíveis."""
    return list(_GERADORES.keys())
