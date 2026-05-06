output "api_url" {
  description = "URL da API xerticaproc"
  value       = google_cloud_run_v2_service.xerticaproc_api.uri
}

output "web_url" {
  description = "URL do frontend xerticaproc"
  value       = google_cloud_run_v2_service.xerticaproc_web.uri
}

output "alloydb_cluster_name" {
  description = "Nome do cluster AlloyDB"
  value       = google_alloydb_cluster.xerticaproc.name
}

output "alloydb_instance_ip" {
  description = "IP privado da instância AlloyDB"
  value       = google_alloydb_instance.primary.ip_address
  sensitive   = true
}

output "storage_bucket" {
  description = "Nome do bucket de documentos"
  value       = google_storage_bucket.xerticaproc_docs.name
}

output "bq_dataset" {
  description = "BigQuery dataset xerticaproc"
  value       = google_bigquery_dataset.xerticaproc.dataset_id
}

output "artifact_registry" {
  description = "Artifact Registry para imagens Docker"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/xerticaproc"
}

output "api_service_account" {
  description = "Service Account da API"
  value       = google_service_account.xerticaproc_api.email
}
