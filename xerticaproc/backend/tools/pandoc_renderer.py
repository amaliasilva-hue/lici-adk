"""Trigger do Cloud Run Job 'pandoc-renderer'.

Em produção, salva o markdown em GCS, dispara a execution do Job e retorna
URIs assinados (signed URLs) dos arquivos DOCX/PDF resultantes.
Em dev (sem GCP), faz fallback retornando apenas o .md raw.
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Any

log = logging.getLogger(__name__)


def _gcs_available() -> bool:
    try:
        from google.cloud import storage  # noqa: F401
        return bool(os.environ.get("DOCS_BUCKET"))
    except ImportError:
        return False


async def render_to_gcs(
    *, contratacao_id: str, doc_type: str, versao: int,
    content_md: str, formats: list[str] | None = None,
) -> dict[str, Any]:
    """Renderiza Markdown via Cloud Run Job. Retorna dict com URIs.

    Em dev, retorna apenas {'md_url': None, 'fallback': True}.
    """
    if not _gcs_available():
        log.info("Pandoc Job indisponível; retornando markdown raw")
        return {"fallback": True, "formats": ["md"]}

    import asyncio
    from google.cloud import run_v2, storage

    bucket_name = os.environ["DOCS_BUCKET"]
    project = os.environ.get("GCP_PROJECT_ID")
    region = os.environ.get("GCP_LOCATION", "us-central1")
    job_name = os.environ.get("PANDOC_JOB_NAME", "pandoc-renderer")
    fmts = formats or ["docx", "pdf"]

    base = f"contratacoes/{contratacao_id}/{doc_type}-v{versao}-{uuid.uuid4().hex[:6]}"
    md_uri = f"gs://{bucket_name}/{base}.md"

    def _upload_md() -> None:
        client = storage.Client()
        client.bucket(bucket_name).blob(f"{base}.md").upload_from_string(
            content_md, content_type="text/markdown",
        )

    await asyncio.to_thread(_upload_md)

    def _trigger() -> str:
        jobs = run_v2.JobsClient()
        parent = f"projects/{project}/locations/{region}/jobs/{job_name}"
        op = jobs.run_job(
            request=run_v2.RunJobRequest(
                name=parent,
                overrides=run_v2.RunJobRequest.Overrides(
                    container_overrides=[run_v2.RunJobRequest.Overrides.ContainerOverride(
                        env=[
                            run_v2.EnvVar(name="INPUT_GCS_URI", value=md_uri),
                            run_v2.EnvVar(name="OUTPUT_FORMATS", value=",".join(fmts)),
                        ],
                    )],
                ),
            ),
        )
        return op.metadata.name if op.metadata else ""

    execution = await asyncio.to_thread(_trigger)
    log.info("pandoc.job.triggered", extra={
        "event": "pandoc.job.triggered", "contratacao_id": contratacao_id,
        "execution": execution, "md_uri": md_uri,
    })
    return {
        "fallback": False, "execution": execution,
        "md_uri": md_uri,
        "outputs": {f: f"gs://{bucket_name}/{base}.{f}" for f in fmts},
    }
