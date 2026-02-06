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

output "certificate_id" {
  description = "Certificate ID"
  value       = yandex_cm_certificate.main.id
}

output "certificate_status" {
  description = "Certificate status (PENDING_VALIDATION, VALIDATING, ISSUED, etc.)"
  value       = yandex_cm_certificate.main.status
}

output "dns_challenge_records" {
  description = "DNS records required for Let's Encrypt domain validation"
  value = [
    for challenge in yandex_cm_certificate.main.challenges : {
      domain = challenge.domain
      type   = challenge.dns_challenge[0].type
      name   = challenge.dns_challenge[0].name
      value  = challenge.dns_challenge[0].value
    }
  ]
}
