output "cluster_id" {
  description = "PostgreSQL cluster ID"
  value       = yandex_mdb_postgresql_cluster.main.id
}

output "cluster_host" {
  description = "PostgreSQL cluster host FQDN"
  value       = yandex_mdb_postgresql_cluster.main.host[0].fqdn
}

output "database_name" {
  description = "Database name"
  value       = var.db_name
}

output "database_user" {
  description = "Database user name"
  value       = var.db_user
}

output "connection_string" {
  description = "PostgreSQL connection string"
  value       = "host=${yandex_mdb_postgresql_cluster.main.host[0].fqdn} port=6432 user=${var.db_user} dbname=${var.db_name} sslmode=require"
  sensitive   = true
}
