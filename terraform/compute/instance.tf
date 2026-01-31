data "yandex_compute_image" "ubuntu" {
  family = "ubuntu-2204-lts"
}

locals {
  docker_env = join(" ", [
    for k, v in var.app_env : "-e ${k}=\"${v}\""
  ])

  cloud_init = templatefile("${path.module}/cloud_init.yaml", {
    docker_image   = var.docker_image
    container_name = var.container_name
    docker_env     = local.docker_env != "" ? local.docker_env : ""
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
