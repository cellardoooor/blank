# Managed PostgreSQL Cluster
resource "yandex_mdb_postgresql_cluster" "main" {
  name        = var.cluster_name
  environment = "PRODUCTION"
  network_id  = var.network_id

  config {
    version = var.pg_version
    resources {
      resource_preset_id = var.resource_preset
      disk_type_id       = "network-ssd"
      disk_size          = var.disk_size
    }

    postgresql_config = {
      max_connections                   = "100"
      enable_parallel_hash              = true
      vacuum_cleanup_index_scale_factor = "0.1"
    }
  }

  host {
    zone             = var.zone
    subnet_id        = var.subnet_id
    assign_public_ip = false
  }

  security_group_ids = [var.security_group_id]
}

# User must be created before database
resource "yandex_mdb_postgresql_user" "main" {
  cluster_id = yandex_mdb_postgresql_cluster.main.id
  name       = var.db_user
  password   = var.db_password
}

# Database depends on user (owner must exist first)
resource "yandex_mdb_postgresql_database" "main" {
  cluster_id = yandex_mdb_postgresql_cluster.main.id
  name       = var.db_name
  owner      = var.db_user

  depends_on = [yandex_mdb_postgresql_user.main]
}
