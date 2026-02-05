# Public subnet for ALB
resource "yandex_vpc_subnet" "public" {
  name           = var.public_subnet_name
  zone           = var.zone
  network_id     = yandex_vpc_network.main.id
  v4_cidr_blocks = [var.public_subnet_cidr]
}

# Application subnet for Instance Group
resource "yandex_vpc_subnet" "app" {
  name           = var.app_subnet_name
  zone           = var.zone
  network_id     = yandex_vpc_network.main.id
  v4_cidr_blocks = [var.app_subnet_cidr]
}

# Database subnet for Managed PostgreSQL
resource "yandex_vpc_subnet" "db" {
  name           = var.db_subnet_name
  zone           = var.zone
  network_id     = yandex_vpc_network.main.id
  v4_cidr_blocks = [var.db_subnet_cidr]
}
