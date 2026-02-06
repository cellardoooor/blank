output "alb_id" {
  description = "Application Load Balancer ID"
  value       = yandex_alb_load_balancer.main.id
}

output "alb_ip_address" {
  description = "ALB external IP address"
  value       = yandex_alb_load_balancer.main.listener[0].endpoint[0].address[0].external_ipv4_address[0].address
}

output "http_router_id" {
  description = "HTTP Router ID"
  value       = yandex_alb_http_router.main.id
}

output "backend_group_id" {
  description = "Backend Group ID"
  value       = yandex_alb_backend_group.main.id
}
