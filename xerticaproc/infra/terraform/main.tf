terraform {
  required_version = ">= 1.8"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.30"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.30"
    }
  }
  backend "gcs" {
    bucket = "xerticaproc-tf-state"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# ── APIs ──────────────────────────────────────────────────────────────────────
resource "google_project_service" "apis" {
  for_each                   = toset(var.required_apis)
  service                    = each.value
  disable_dependent_services = false
  disable_on_destroy         = false
}

# ── Service Accounts ────────────────────────────────────────────────────────
resource "google_service_account" "xerticaproc_api" {
  account_id   = "xerticaproc-api"
  display_name = "xerticaproc API Service Account"
  description  = "Usado pelo Cloud Run da API xerticaproc"
}

resource "google_service_account" "xerticaproc_web" {
  account_id   = "xerticaproc-web"
  display_name = "xerticaproc Web Service Account"
}

resource "google_service_account" "xerticaproc_worker" {
  account_id   = "xerticaproc-worker"
  display_name = "xerticaproc Background Worker (Workflows, Jobs)"
}

# ── IAM Bindings ─────────────────────────────────────────────────────────────
locals {
  api_sa_roles = [
    "roles/aiplatform.user",
    "roles/bigquery.dataEditor",
    "roles/bigquery.jobUser",
    "roles/storage.objectViewer",
    "roles/cloudtasks.enqueuer",
    "roles/pubsub.publisher",
    "roles/secretmanager.secretAccessor",
    "roles/logging.logWriter",
    "roles/cloudtrace.agent",
    "roles/alloydb.client",
  ]
}

resource "google_project_iam_member" "api_sa_roles" {
  for_each = toset(local.api_sa_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.xerticaproc_api.email}"
}

# ── Cloud Run — API ─────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "xerticaproc_api" {
  name     = "xerticaproc-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.xerticaproc_api.email

    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/xerticaproc/api:latest"

      resources {
        limits = {
          cpu    = "4"
          memory = "8Gi"
        }
        cpu_idle = false
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.region
      }
      env {
        name  = "ALLOYDB_URI"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.alloydb_uri.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "LOG_LEVEL"
        value = "INFO"
      }

      startup_probe {
        http_get {
          path = "/proc/healthz"
          port = 8080
        }
        initial_delay_seconds = 10
        period_seconds        = 5
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/proc/healthz"
          port = 8080
        }
        period_seconds    = 30
        failure_threshold = 3
      }
    }

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
  }

  depends_on = [google_project_service.apis]
}

# ── Cloud Run — Web ──────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "xerticaproc_web" {
  name     = "xerticaproc-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.xerticaproc_web.email

    scaling {
      min_instance_count = 1
      max_instance_count = 5
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/xerticaproc/web:latest"

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }

      env {
        name  = "NEXTAUTH_URL"
        value = "https://${var.web_domain}"
      }
      env {
        name  = "BACKEND_URL"
        value = google_cloud_run_v2_service.xerticaproc_api.uri
      }
      env {
        name = "NEXTAUTH_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.nextauth_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "GOOGLE_CLIENT_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_client_id.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "GOOGLE_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_client_secret.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [google_project_service.apis]
}

# ── AlloyDB ──────────────────────────────────────────────────────────────────
resource "google_alloydb_cluster" "xerticaproc" {
  provider   = google-beta
  cluster_id = "xerticaproc-cluster"
  location   = var.region

  network_config {
    network = google_compute_network.xerticaproc_vpc.id
  }

  initial_user {
    password = random_password.alloydb_root.result
  }

  automated_backup_policy {
    enabled = true
    weekly_schedule {
      days_of_week = ["SUNDAY"]
      start_times {
        hours   = 2
        minutes = 0
      }
    }
    quantity_based_retention {
      count = 7
    }
  }

  continuous_backup_config {
    enabled              = true
    recovery_window_days = 14
  }

  depends_on = [google_project_service.apis, google_service_networking_connection.private_vpc_connection]
}

resource "google_alloydb_instance" "primary" {
  provider      = google-beta
  cluster       = google_alloydb_cluster.xerticaproc.name
  instance_id   = "primary"
  instance_type = "PRIMARY"

  machine_config {
    cpu_count = var.alloydb_cpu_count
  }

  database_flags = {
    "alloydb.enable_pgvector" = "on"
    "max_connections"         = "500"
  }

  depends_on = [google_alloydb_cluster.xerticaproc]
}

resource "random_password" "alloydb_root" {
  length  = 32
  special = true
}

resource "google_secret_manager_secret" "alloydb_uri" {
  secret_id = "xerticaproc-alloydb-uri"
  replication {
    auto {}
  }
}

# ── BigQuery ──────────────────────────────────────────────────────────────────
resource "google_bigquery_dataset" "xerticaproc" {
  dataset_id                  = "xerticaproc"
  friendly_name               = "xerticaproc — Dados Analytics"
  description                 = "Histórico de preços, auditoria e BI da plataforma xerticaproc"
  location                    = var.bq_location
  delete_contents_on_destroy  = false

  labels = {
    env     = var.environment
    product = "xerticaproc"
  }
}

resource "google_bigquery_table" "mapa_precos_historico" {
  dataset_id          = google_bigquery_dataset.xerticaproc.dataset_id
  table_id            = "mapa_precos_historico"
  deletion_protection = true

  time_partitioning {
    type  = "MONTH"
    field = "data_pesquisa"
  }

  clustering = ["fonte_tipo", "orgao", "unidade_normalizada"]

  schema = jsonencode([
    { name = "contratacao_id", type = "STRING", mode = "REQUIRED" },
    { name = "objeto", type = "STRING", mode = "REQUIRED" },
    { name = "orgao", type = "STRING", mode = "NULLABLE" },
    { name = "numero_documento", type = "STRING", mode = "NULLABLE" },
    { name = "fonte_tipo", type = "STRING", mode = "REQUIRED" },
    { name = "descricao_original", type = "STRING", mode = "REQUIRED" },
    { name = "descricao_normalizada", type = "STRING", mode = "NULLABLE" },
    { name = "fabricante", type = "STRING", mode = "NULLABLE" },
    { name = "catmat", type = "STRING", mode = "NULLABLE" },
    { name = "catser", type = "STRING", mode = "NULLABLE" },
    { name = "unidade_original", type = "STRING", mode = "REQUIRED" },
    { name = "unidade_normalizada", type = "STRING", mode = "REQUIRED" },
    { name = "quantidade", type = "FLOAT64", mode = "NULLABLE" },
    { name = "valor_unitario", type = "FLOAT64", mode = "REQUIRED" },
    { name = "valor_total", type = "FLOAT64", mode = "NULLABLE" },
    { name = "vigencia_meses", type = "INT64", mode = "NULLABLE" },
    { name = "valor_mensal_por_unidade", type = "FLOAT64", mode = "NULLABLE" },
    { name = "score_comparabilidade", type = "FLOAT64", mode = "REQUIRED" },
    { name = "nivel_comparabilidade", type = "STRING", mode = "REQUIRED" },
    { name = "data_publicacao", type = "DATE", mode = "NULLABLE" },
    { name = "data_pesquisa", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "url", type = "STRING", mode = "NULLABLE" },
  ])
}

resource "google_bigquery_table" "prompt_execucoes" {
  dataset_id          = google_bigquery_dataset.xerticaproc.dataset_id
  table_id            = "prompt_execucoes"
  deletion_protection = true

  time_partitioning {
    type  = "DAY"
    field = "data"
  }

  schema = jsonencode([
    { name = "id", type = "STRING", mode = "REQUIRED" },
    { name = "contratacao_id", type = "STRING", mode = "NULLABLE" },
    { name = "agente", type = "STRING", mode = "REQUIRED" },
    { name = "versao_prompt", type = "STRING", mode = "REQUIRED" },
    { name = "modelo", type = "STRING", mode = "REQUIRED" },
    { name = "entrada_hash", type = "STRING", mode = "NULLABLE" },
    { name = "saida_hash", type = "STRING", mode = "NULLABLE" },
    { name = "tokens_entrada", type = "INT64", mode = "NULLABLE" },
    { name = "tokens_saida", type = "INT64", mode = "NULLABLE" },
    { name = "latencia_ms", type = "INT64", mode = "NULLABLE" },
    { name = "data", type = "TIMESTAMP", mode = "REQUIRED" },
  ])
}

# ── Cloud Storage ─────────────────────────────────────────────────────────────
resource "google_storage_bucket" "xerticaproc_docs" {
  name                        = "${var.project_id}-xerticaproc-docs"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
    condition {
      age = 90
    }
  }

  cors {
    origin          = ["https://${var.web_domain}"]
    method          = ["GET", "POST"]
    response_header = ["Content-Type", "Authorization"]
    max_age_seconds = 3600
  }

  labels = {
    product = "xerticaproc"
    env     = var.environment
  }
}

# ── Cloud Tasks — Queue de coleta de preços ───────────────────────────────────
resource "google_cloud_tasks_queue" "coleta_precos" {
  name     = "xerticaproc-coleta-precos"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 1  # Rate limit conservador para APIs externas
    max_concurrent_dispatches = 5
  }

  retry_config {
    max_attempts  = 5
    max_backoff   = "600s"
    min_backoff   = "10s"
    max_doublings = 5
  }
}

# ── Pub/Sub — Tópicos ─────────────────────────────────────────────────────────
resource "google_pubsub_topic" "contratacao_eventos" {
  name = "xerticaproc-contratacao-eventos"

  message_retention_duration = "86600s"  # 1 dia

  labels = {
    product = "xerticaproc"
  }
}

resource "google_pubsub_topic" "preco_coletado" {
  name = "xerticaproc-preco-coletado"
  message_retention_duration = "86600s"
}

resource "google_pubsub_subscription" "preco_coletado_api" {
  name  = "xerticaproc-preco-coletado-api"
  topic = google_pubsub_topic.preco_coletado.name

  ack_deadline_seconds = 60

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.xerticaproc_api.uri}/proc/internal/preco-coletado"
    oidc_token {
      service_account_email = google_service_account.xerticaproc_worker.email
    }
  }
}

# ── Cloud Scheduler ───────────────────────────────────────────────────────────
resource "google_cloud_scheduler_job" "atualizar_base_precos" {
  name      = "xerticaproc-atualizar-precos"
  schedule  = "0 2 * * 1"  # toda segunda-feira às 2h
  time_zone = "America/Sao_Paulo"

  http_target {
    uri         = "${google_cloud_run_v2_service.xerticaproc_api.uri}/proc/internal/atualizar-base-precos"
    http_method = "POST"
    oidc_token {
      service_account_email = google_service_account.xerticaproc_worker.email
    }
  }
}

# ── Secret Manager ────────────────────────────────────────────────────────────
resource "google_secret_manager_secret" "nextauth_secret" {
  secret_id = "xerticaproc-nextauth-secret"
  replication { auto {} }
}

resource "google_secret_manager_secret" "google_client_id" {
  secret_id = "xerticaproc-google-client-id"
  replication { auto {} }
}

resource "google_secret_manager_secret" "google_client_secret" {
  secret_id = "xerticaproc-google-client-secret"
  replication { auto {} }
}

# ── VPC e Networking ─────────────────────────────────────────────────────────
resource "google_compute_network" "xerticaproc_vpc" {
  name                    = "xerticaproc-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "xerticaproc_subnet" {
  name          = "xerticaproc-subnet"
  ip_cidr_range = "10.10.0.0/24"
  region        = var.region
  network       = google_compute_network.xerticaproc_vpc.id
}

resource "google_vpc_access_connector" "connector" {
  name          = "xerticaproc-connector"
  region        = var.region
  ip_cidr_range = "10.10.1.0/28"
  network       = google_compute_network.xerticaproc_vpc.name
}

resource "google_compute_global_address" "private_ip_range" {
  name          = "xerticaproc-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.xerticaproc_vpc.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.xerticaproc_vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]
}

# ── Artifact Registry ────────────────────────────────────────────────────────
resource "google_artifact_registry_repository" "xerticaproc" {
  location      = var.region
  repository_id = "xerticaproc"
  format        = "DOCKER"
  description   = "Imagens Docker da plataforma xerticaproc"
}
