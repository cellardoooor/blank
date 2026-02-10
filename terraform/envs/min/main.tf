# Network module - creates VPC, 3 subnets, and 3 security groups
module "network" {
  source = "../../network"

  vpc_name = "${var.environment}-messenger-vpc"
  vpc_cidr = "10.0.0.0/16"
  zone     = var.zone

  public_subnet_name = "${var.environment}-messenger-public"
  public_subnet_cidr = "10.0.1.0/24"
  app_subnet_name    = "${var.environment}-messenger-app"
  app_subnet_cidr    = "10.0.2.0/24"
  db_subnet_name     = "${var.environment}-messenger-db"
  db_subnet_cidr    = "10.0.3.0/24"

  alb_sg_name = "${var.environment}-messenger-alb-sg"
  app_sg_name = "${var.environment}-messenger-app-sg"
  db_sg_name  = "${var.environment}-messenger-db-sg"
}

# Database module - creates Managed PostgreSQL
module "database" {
  source = "../../database"

  cluster_name      = "${var.environment}-messenger-postgres"
  db_name           = var.db_name
  db_user           = var.db_user
  db_password       = var.db_password
  network_id        = module.network.vpc_id
  subnet_id         = module.network.db_subnet_id
  security_group_id = module.network.db_security_group_id
  pg_version        = "15"
  resource_preset   = "s2.micro"
  disk_size         = 20
  zone              = var.zone
}

data "yandex_compute_image" "ubuntu" {
  family = "ubuntu-2204-lts"
}

resource "yandex_vpc_security_group" "min_vm" {
  name        = "${var.environment}-min-vm-sg"
  network_id  = module.network.vpc_id
  description = "Security group for min migration VM"

  ingress {
    protocol       = "TCP"
    description    = "HTTPS"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 443
  }

  ingress {
    protocol       = "TCP"
    description    = "HTTP (for Caddy ACME)"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 80
  }

  ingress {
    protocol       = "TCP"
    description    = "SSH"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 22
  }

  egress {
    protocol       = "ANY"
    description    = "Allow all outbound"
    v4_cidr_blocks = ["0.0.0.0/0"]
    from_port      = 0
    to_port        = 65535
  }
}

resource "yandex_vpc_address" "static_ip" {
  name = "${var.environment}-min-static-ip"

  external_ipv4_address {
    zone_id = var.zone
  }
}

resource "yandex_compute_disk" "data_disk" {
  name     = "${var.environment}-min-data-disk"
  type     = "network-hdd"
  zone     = var.zone
  size     = 20
}

locals {
  cloud_init = templatefile("${path.module}/cloud_init_min.yaml", {
    docker_image         = var.docker_image
    container_name       = var.container_name
    app_port             = var.app_port
    http_addr            = var.http_addr
    jwt_secret_b64       = base64encode(var.jwt_secret)
    jwt_duration         = var.jwt_duration
    db_user              = var.db_user
    db_password          = var.db_password
    db_password_b64      = base64encode(var.db_password)
    db_name              = var.db_name
    default_user_b64     = base64encode(var.default_user)
    default_password_b64 = base64encode(var.default_password)
    encryption_key_b64   = base64encode(var.encryption_key)
    source_db_host       = module.database.cluster_host
    source_db_port       = "6432"
    domain               = var.domain
  })
}

resource "yandex_compute_instance" "min_vm" {
  name        = "${var.environment}-min-vm"
  folder_id   = var.yc_folder_id
  zone        = var.zone
  platform_id = "standard-v3"

  resources {
    cores  = 2
    memory = 2
  }

  boot_disk {
    initialize_params {
      image_id = data.yandex_compute_image.ubuntu.id
      type     = "network-hdd"
      size     = 10
    }
  }

  secondary_disk {
    disk_id     = yandex_compute_disk.data_disk.id
    auto_delete = false
  }

  network_interface {
    subnet_id          = module.network.app_subnet_id
    security_group_ids = [yandex_vpc_security_group.min_vm.id]
    nat                = true
    nat_ip_address     = yandex_vpc_address.static_ip.external_ipv4_address[0].address
  }

  metadata = {
    user-data = local.cloud_init
    version   = md5(local.cloud_init)
  }
}
