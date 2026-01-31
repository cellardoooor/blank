resource "yandex_vpc_security_group" "main" {
  name        = var.security_group_name
  network_id  = yandex_vpc_network.main.id
  description = "Security group for messenger backend"

  ingress {
    protocol       = "TCP"
    description    = "Allow HTTP traffic on 8080"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 8080
  }

  egress {
    protocol       = "ANY"
    description    = "Allow all outbound traffic"
    v4_cidr_blocks = ["0.0.0.0/0"]
    from_port      = 0
    to_port        = 65535
  }
}
