# Cloud Run Job para converter Markdown → DOCX/PDF via Pandoc.
# Job único, invocado on-demand pelo backend principal.
FROM pandoc/latex:3.1

# Adiciona Python para ler/escrever GCS
RUN apk add --no-cache python3 py3-pip
RUN pip3 install --break-system-packages google-cloud-storage==2.18.0

WORKDIR /app
COPY render_job.py /app/render_job.py

ENTRYPOINT ["python3", "/app/render_job.py"]
