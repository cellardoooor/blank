output "vpc_id" {
  description = "VPC network ID"
  value       = yandex_vpc_network.main.id
}

output "public_subnet_id" {
  description = "Public subnet ID for ALB"
  value       = yandex_vpc_subnet.public.id
}

output "app_subnet_id" {
  description = "Application subnet ID for VMs"
  value       = yandex_vpc_subnet.app.id
}

output "db_subnet_id" {
  description = "Database subnet ID for Managed PostgreSQL"
  value       = yandex_vpc_subnet.db.id
}

output "alb_security_group_id" {
  description = "Security group ID for ALB"
  value       = yandex_vpc_security_group.alb.id
}

output "app_security_group_id" {
  description = "Security group ID for application VMs"
  value       = yandex_vpc_security_group.app.id
}

output "db_security_group_id" {
  description = "Security group ID for Managed PostgreSQL"
  value       = yandex_vpc_security_group.db.id
}
