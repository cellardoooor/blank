locals {
  # Minimal cloud-init - only sets environment variables
  # Golden Image already has Docker and start.sh installed
  cloud_init = templatefile("${path.module}/cloud-init-minimal.yaml", {
    http_addr            = var.http_addr
    jwt_secret           = var.jwt_secret
    jwt_duration         = var.jwt_duration
    db_host              = var.db_host
    db_port              = var.db_port
    db_user              = var.db_user
    db_password          = var.db_password
    db_name              = var.db_name
    db_sslmode           = var.db_sslmode
    default_user         = var.default_user
    default_password     = var.default_password
  })
}

# Instance Group for high availability and auto-scaling
resource "yandex_compute_instance_group" "main" {
  name               = var.instance_group_name
  folder_id          = var.folder_id
  service_account_id = var.service_account_id

  instance_template {
    platform_id = "standard-v3"

    resources {
      cores  = var.cores
      memory = var.memory
    }

    boot_disk {
      initialize_params {
        image_id = var.golden_image_id  # Use Golden Image instead of Ubuntu
        type     = "network-ssd"
        size     = var.disk_size
      }
    }

    network_interface {
      network_id         = var.network_id
      subnet_ids         = [var.subnet_id]
      security_group_ids = var.security_group_ids
      nat                = false  # No NAT needed, use ALB
    }

    metadata = {
      user-data = local.cloud_init
    }
  }

  scale_policy {
    auto_scale {
      initial_size           = var.min_instances
      measurement_duration   = 60
      cpu_utilization_target = 75
      warmup_duration        = 120
      min_zone_size          = var.min_instances
      max_size               = var.max_instances
    }
  }

  allocation_policy {
    zones = [var.zone]
  }

  deploy_policy {
    max_unavailable  = 1
    max_expansion    = 1
    max_creating     = 1
    startup_duration = 60  # Reduced from 180 - Golden Image boots faster
  }

  # Note: Health check managed by ALB only

  # Create ALB target group automatically
  application_load_balancer {
    target_group_id = var.target_group_id
  }

  lifecycle {
    create_before_destroy = true
  }
}
