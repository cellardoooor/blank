resource "yandex_vpc_network" "main" {
  name = var.vpc_name
}

# NAT Gateway for app subnet internet access
resource "yandex_vpc_gateway" "nat" {
  name = "${var.vpc_name}-nat-gateway"
  shared_egress_gateway {}
}
