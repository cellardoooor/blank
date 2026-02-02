data "yandex_compute_image" "ubuntu" {
  family = "ubuntu-2204-lts"
}

locals {
  docker_env = join(" ", [
    "-e HTTP_ADDR=\"${var.http_addr}\"",
    "-e JWT_SECRET=\"${var.jwt_secret}\"",
    "-e JWT_DURATION=\"${var.jwt_duration}\"",
    "-e DB_HOST=\"${var.db_host}\"",
    "-e DB_PORT=\"${var.db_port}\"",
    "-e DB_USER=\"${var.db_user}\"",
    "-e DB_PASSWORD=\"${var.db_password}\"",
    "-e DB_NAME=\"${var.db_name}\"",
    "-e DB_SSLMODE=\"${var.db_sslmode}\""
  ])

  cloud_init = templatefile("${path.module}/cloud_init.yaml", {
    docker_image   = var.docker_image
    container_name = var.container_name
    docker_env     = local.docker_env
    app_port       = var.app_port
  })
}

resource "yandex_compute_instance" "main" {
  name        = var.instance_name
  zone        = var.zone
  platform_id = "standard-v3"

  resources {
    cores  = var.cores
    memory = var.memory
  }

  boot_disk {
    initialize_params {
      image_id = data.yandex_compute_image.ubuntu.id
      type     = "network-ssd"
      size     = var.disk_size
    }
  }

  network_interface {
    subnet_id          = var.subnet_id
    nat                = true
    security_group_ids = var.security_group_ids
  }

  metadata = {
    user-data = local.cloud_init
  }
}
