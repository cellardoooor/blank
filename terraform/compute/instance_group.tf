data "yandex_compute_image" "container_optimized" {
  family = "container-optimized-image"
}

locals {
  cloud_init = templatefile("${path.module}/cloud_init.yaml", {
    docker_image         = var.docker_image
    container_name       = var.container_name
    app_port             = var.app_port
    http_addr            = var.http_addr
    jwt_secret_b64       = base64encode(var.jwt_secret)
    jwt_duration         = var.jwt_duration
    db_host              = var.db_host
    db_port              = var.db_port
    db_user              = var.db_user
    db_password_b64      = base64encode(var.db_password)
    db_name              = var.db_name
    db_sslmode           = var.db_sslmode
    default_user_b64     = base64encode(var.default_user)
    default_password_b64 = base64encode(var.default_password)
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
        image_id = data.yandex_compute_image.container_optimized.id
        type     = "network-ssd"
        size     = var.disk_size
      }
    }

    network_interface {
      network_id         = var.network_id
      subnet_ids         = [var.subnet_id]
      security_group_ids = var.security_group_ids
      nat                = false # No NAT, use ALB for external access
    }

    metadata = {
      user-data = local.cloud_init
      # Version triggers rolling update when docker_image changes
      version = md5(var.docker_image)
    }
  }

  scale_policy {
  auto_scale {
    initial_size           = 2
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
    startup_duration = 180
  }

  health_check {
    interval            = 15
    timeout             = 10
    unhealthy_threshold = 2
    healthy_threshold   = 2

    http_options {
      port = 8080
      path = "/api/health"
    }
  }

  # Attach to ALB target group
  application_load_balancer {
    target_group_id = var.target_group_id
  }

  lifecycle {
    create_before_destroy = true
  }
}
