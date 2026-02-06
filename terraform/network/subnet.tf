# Public subnet for ALB
resource "yandex_vpc_subnet" "public" {
  name           = var.public_subnet_name
  zone           = var.zone
  network_id     = yandex_vpc_network.main.id
  v4_cidr_blocks = [var.public_subnet_cidr]
}

# Route table for NAT Gateway (used by app subnet)
resource "yandex_vpc_route_table" "nat" {
  name       = "${var.vpc_name}-nat-route"
  network_id = yandex_vpc_network.main.id

  static_route {
    destination_prefix = "0.0.0.0/0"
    gateway_id         = yandex_vpc_gateway.nat.id
  }
}

# Application subnet for Instance Group (with NAT for internet access)
resource "yandex_vpc_subnet" "app" {
  name           = var.app_subnet_name
  zone           = var.zone
  network_id     = yandex_vpc_network.main.id
  v4_cidr_blocks = [var.app_subnet_cidr]
  route_table_id = yandex_vpc_route_table.nat.id
}

# Database subnet for Managed PostgreSQL
resource "yandex_vpc_subnet" "db" {
  name           = var.db_subnet_name
  zone           = var.zone
  network_id     = yandex_vpc_network.main.id
  v4_cidr_blocks = [var.db_subnet_cidr]
}
