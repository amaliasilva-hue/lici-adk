variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "operaciones-br"
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "bq_location" {
  description = "BigQuery dataset location"
  type        = string
  default     = "US"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
  validation {
    condition     = contains(["production", "staging", "development"], var.environment)
    error_message = "environment deve ser production, staging ou development"
  }
}

variable "web_domain" {
  description = "Domínio do frontend (ex: proc.xertica.com)"
  type        = string
  default     = "proc.xertica.com"
}

variable "alloydb_cpu_count" {
  description = "CPU count para a instância primária do AlloyDB"
  type        = number
  default     = 4
  validation {
    condition     = contains([2, 4, 8, 16, 32, 64], var.alloydb_cpu_count)
    error_message = "CPU count deve ser: 2, 4, 8, 16, 32 ou 64"
  }
}

variable "required_apis" {
  description = "APIs GCP a habilitar"
  type        = list(string)
  default = [
    "run.googleapis.com",
    "aiplatform.googleapis.com",
    "bigquery.googleapis.com",
    "storage.googleapis.com",
    "cloudtasks.googleapis.com",
    "pubsub.googleapis.com",
    "cloudscheduler.googleapis.com",
    "workflows.googleapis.com",
    "documentai.googleapis.com",
    "alloydb.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudkms.googleapis.com",
    "servicenetworking.googleapis.com",
    "vpcaccess.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "cloudtrace.googleapis.com",
    "iap.googleapis.com",
    "dlp.googleapis.com",
    "iam.googleapis.com",
  ]
}
