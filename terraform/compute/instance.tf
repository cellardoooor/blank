data "yandex_compute_image" "ubuntu" {
  family = "ubuntu-2204-lts"
}

locals {
  # Base64 encode sensitive variables to avoid YAML parsing issues
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

resource "yandex_compute_instance" "main" {
  name        = "${var.instance_name}-${formatdate("YYYYMMDD-hhmm", timestamp())}"
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

  lifecycle {
    create_before_destroy = true
  }
}
