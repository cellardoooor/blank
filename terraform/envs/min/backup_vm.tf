# Data source для получения последнего образа Ubuntu
data "yandex_compute_image" "ubuntu_backup" {
  family  = "ubuntu-2204-lts"
  folder_id = var.yc_folder_id
}

# Внешний жесткий диск 20 ГБ
resource "yandex_compute_disk" "backup_disk" {
  name     = "${var.environment}-backup-disk"
  type     = "network-hdd"
  zone     = var.zone
  size     = 20
}

# Виртуальная машина для бэкапа
resource "yandex_compute_instance" "backup_vm" {
  name        = "${var.environment}-backup-vm"
  zone        = var.zone
  platform_id = "standard-v3"

  resources {
    cores  = 2
    memory = 4
  }

  boot_disk {
    initialize_params {
      image_id = data.yandex_compute_image.ubuntu_backup.id
    }
  }

  # Подключение внешнего диска как вторичного
  secondary_disk {
    disk_id     = yandex_compute_disk.backup_disk.id
    auto_delete = false
  }

  network_interface {
    subnet_id = module.network.app_subnet_id
    nat       = true
  }

  # Metadata для cloud-init
  metadata = {
    user-data = templatefile("${path.module}/scripts/backup_init.yaml", {
      db_host     = module.database.cluster_host
      db_user     = var.db_user
      db_password = var.db_password
      db_name     = var.db_name
    })
  }
}
