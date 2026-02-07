# Golden Image Builder Module
# Creates a VM with Docker and application pre-installed
# This VM is then used to create a compute image for Instance Group

data "yandex_compute_image" "ubuntu" {
  family = "ubuntu-2204-lts"
}

locals {
  startup_script = templatefile("${path.module}/startup.sh", {
    docker_image = var.docker_image
  })
}

# VM for building Golden Image
resource "yandex_compute_instance" "builder" {
  name        = "${var.image_name}-builder--${var.image_version}"
  platform_id = "standard-v3"
  zone        = var.zone

  resources {
    cores  = 2
    memory = 4
  }

  boot_disk {
    initialize_params {
      image_id = data.yandex_compute_image.ubuntu.id
      type     = "network-ssd"
      size     = 20
    }
  }

  network_interface {
    subnet_id = var.subnet_id
    nat       = true  # Need internet to pull Docker image
  }

  metadata = {
    user-data = templatefile("${path.module}/cloud-init.yaml", {
      docker_image   = var.docker_image
      startup_script = local.startup_script
    })
  }

  # Wait for cloud-init to complete
  provisioner "local-exec" {
    command = <<-EOT
      echo "Waiting for cloud-init to complete on builder VM..."
      sleep 120  # Wait for Docker installation and image pull
    EOT
  }

  lifecycle {
    create_before_destroy = false
  }
}

# Create Golden Image from the builder VM
resource "yandex_compute_image" "golden" {
  name = "${var.image_name}"
  source_disk = yandex_compute_instance.builder.boot_disk[0].disk_id
  min_disk_size = 20

  depends_on = [yandex_compute_instance.builder]

  lifecycle {
    create_before_destroy = false
  }
}

# Cleanup builder VM after image creation
resource "null_resource" "cleanup" {
  triggers = {
    image_id = yandex_compute_image.golden.id
  }

  provisioner "local-exec" {
    command = <<-EOT
      echo "Golden Image created: ${yandex_compute_image.golden.id}"
      echo "You can manually delete the builder VM: ${yandex_compute_instance.builder.name}"
      echo "Or keep it for debugging purposes"
    EOT
  }

  depends_on = [yandex_compute_image.golden]
}
