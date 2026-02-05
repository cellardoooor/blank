# ALB Security Group - accepts HTTPS from internet
resource "yandex_vpc_security_group" "alb" {
  name        = var.alb_sg_name
  network_id  = yandex_vpc_network.main.id
  description = "Security group for ALB - accepts HTTPS from internet"

  ingress {
    protocol       = "TCP"
    description    = "Allow HTTPS traffic from anywhere"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 443
  }

  ingress {
    protocol       = "TCP"
    description    = "Allow HTTP traffic for redirect"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 80
  }

  egress {
    protocol       = "ANY"
    description    = "Allow all outbound traffic to app subnet"
    v4_cidr_blocks = [var.app_subnet_cidr]
    from_port      = 0
    to_port        = 65535
  }
}

# Application Security Group - accepts only from ALB, egress to DB
resource "yandex_vpc_security_group" "app" {
  name        = var.app_sg_name
  network_id  = yandex_vpc_network.main.id
  description = "Security group for application VMs - accepts from ALB only"

  ingress {
    protocol          = "TCP"
    description       = "Allow HTTP traffic from ALB only"
    predefined_target = "loadbalancer_healthchecks"
    port              = 8080
  }

  ingress {
    protocol       = "TCP"
    description    = "Allow traffic from ALB subnet"
    v4_cidr_blocks = [var.public_subnet_cidr]
    port           = 8080
  }

  egress {
    protocol       = "TCP"
    description    = "Allow PostgreSQL traffic to DB subnet"
    v4_cidr_blocks = [var.db_subnet_cidr]
    port           = 6432
  }

  egress {
    protocol       = "TCP"
    description    = "Allow HTTPS for Docker pulls"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 443
  }

  egress {
    protocol       = "TCP"
    description    = "Allow HTTP for package updates"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 80
  }
}

# Database Security Group - accepts only from app subnet
resource "yandex_vpc_security_group" "db" {
  name        = var.db_sg_name
  network_id  = yandex_vpc_network.main.id
  description = "Security group for Managed PostgreSQL - accepts from app only"

  ingress {
    protocol       = "TCP"
    description    = "Allow PostgreSQL traffic from app subnet only"
    v4_cidr_blocks = [var.app_subnet_cidr]
    port           = 6432
  }

  # Managed PostgreSQL handles its own egress rules
}
