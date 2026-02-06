# HTTP Router
resource "yandex_alb_http_router" "main" {
  name = "${var.alb_name}-router"
}

# Virtual Host
resource "yandex_alb_virtual_host" "main" {
  name           = "${var.alb_name}-host"
  http_router_id = yandex_alb_http_router.main.id
  authority      = [var.domain, "www.${var.domain}"]

  route {
    name = "api-route"
    http_route {
      http_match {
        path {
          prefix = "/"
        }
      }
      http_route_action {
        backend_group_id = yandex_alb_backend_group.main.id
        timeout          = "60s"
      }
    }
  }
}

# Backend Group
resource "yandex_alb_backend_group" "main" {
  name = "${var.alb_name}-backend"

  http_backend {
    name             = "messenger-backend"
    weight           = 100
    port             = 8080
    target_group_ids = [var.target_group_id]
    healthcheck {
      timeout             = "10s"
      interval            = "5s"
      healthy_threshold   = 2
      unhealthy_threshold = 3
      http_healthcheck {
        path = "/api/health"
      }
    }
  }
}

# Load Balancer
resource "yandex_alb_load_balancer" "main" {
  name       = var.alb_name
  network_id = var.network_id

  allocation_policy {
    location {
      zone_id   = var.zone
      subnet_id = var.public_subnet_id
    }
  }

  listener {
    name = "https-listener"
    endpoint {
      address {
        external_ipv4_address {}
      }
      ports = [443]
    }
    tls {
      default_handler {
        certificate_ids = var.certificate_id != null ? [var.certificate_id] : []
      }
    }
    http {
      handler {
        http_router_id = yandex_alb_http_router.main.id
      }
    }
  }

  listener {
    name = "http-redirect"
    endpoint {
      address {
        external_ipv4_address {}
      }
      ports = [80]
    }
    http {
      redirects {
        http_to_https = true
      }
    }
  }
}
