"""Cloud Run Job: lê Markdown do GCS, gera DOCX/PDF via pandoc, escreve de volta.

Variáveis de ambiente:
  INPUT_GCS_URI   gs://bucket/path/to/doc.md
  OUTPUT_FORMATS  csv: docx,pdf (default: docx,pdf)
  OUTPUT_PREFIX   gs://bucket/path/to/output/   (default: mesmo dir do input)
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

from google.cloud import storage  # type: ignore


def _parse_gcs(uri: str) -> tuple[str, str]:
    p = urlparse(uri)
    if p.scheme != "gs":
        raise ValueError(f"URI não-GCS: {uri}")
    return p.netloc, p.path.lstrip("/")


def _download(client: storage.Client, uri: str, dest: str) -> None:
    bucket, key = _parse_gcs(uri)
    client.bucket(bucket).blob(key).download_to_filename(dest)


def _upload(client: storage.Client, src: str, uri: str) -> None:
    bucket, key = _parse_gcs(uri)
    client.bucket(bucket).blob(key).upload_from_filename(src)


def main() -> int:
    input_uri = os.environ["INPUT_GCS_URI"]
    formats = [
        f.strip().lower() for f in
        os.environ.get("OUTPUT_FORMATS", "docx,pdf").split(",")
        if f.strip()
    ]
    out_prefix = os.environ.get("OUTPUT_PREFIX") or input_uri.rsplit("/", 1)[0] + "/"

    client = storage.Client()
    with tempfile.TemporaryDirectory() as td:
        md_path = os.path.join(td, "in.md")
        _download(client, input_uri, md_path)
        base = os.path.splitext(os.path.basename(input_uri))[0]
        for fmt in formats:
            out_local = os.path.join(td, f"{base}.{fmt}")
            cmd = ["pandoc", md_path, "-o", out_local]
            if fmt == "pdf":
                cmd += ["--pdf-engine=xelatex"]
            print(f"→ {' '.join(cmd)}", flush=True)
            subprocess.run(cmd, check=True)
            target = out_prefix.rstrip("/") + f"/{base}.{fmt}"
            _upload(client, out_local, target)
            print(f"✓ {target}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
