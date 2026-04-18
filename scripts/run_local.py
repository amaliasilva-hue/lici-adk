"""Roda o pipeline completo contra um PDF local, imprime o parecer em JSON."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from backend.agents.orchestrator import analisar_edital
from backend.logging_config import configure_logging


def main() -> None:
    if len(sys.argv) < 2:
        print("uso: run_local.py <pdf>", file=sys.stderr)
        sys.exit(2)
    pdf_path = Path(sys.argv[1])
    pdf_bytes = pdf_path.read_bytes()
    configure_logging()
    t0 = time.time()
    parecer = analisar_edital(pdf_bytes, edital_filename=pdf_path.name)
    total = time.time() - t0
    print(f"\n====== PARECER ({pdf_path.name} — {total:.1f}s) ======")
    print(json.dumps(parecer.model_dump(), ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
