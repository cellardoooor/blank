output "vpc_id" {
  description = "VPC ID"
  value       = module.network.vpc_id
}

output "public_subnet_id" {
  description = "Public subnet ID for ALB"
  value       = module.network.public_subnet_id
}

output "app_subnet_id" {
  description = "Application subnet ID for VMs"
  value       = module.network.app_subnet_id
}

output "db_subnet_id" {
  description = "Database subnet ID"
  value       = module.network.db_subnet_id
}

output "alb_security_group_id" {
  description = "ALB Security Group ID"
  value       = module.network.alb_security_group_id
}

output "app_security_group_id" {
  description = "App Security Group ID"
  value       = module.network.app_security_group_id
}

output "db_security_group_id" {
  description = "DB Security Group ID"
  value       = module.network.db_security_group_id
}

output "alb_id" {
  description = "Application Load Balancer ID"
  value       = module.alb.alb_id
}

output "alb_ip_address" {
  description = "ALB external IP address"
  value       = module.alb.alb_ip_address
}

output "domain" {
  description = "Configured domain name"
  value       = var.domain
}

output "certificate_id" {
  description = "Certificate ID"
  value       = module.alb.certificate_id
}

output "certificate_status" {
  description = "Certificate status"
  value       = module.alb.certificate_status
}

output "dns_challenge_records" {
  description = "DNS records required for Let's Encrypt domain validation"
  value       = module.alb.dns_challenge_records
}

output "instance_group_id" {
  description = "Instance Group ID"
  value       = module.compute.instance_group_id
}

output "instance_count" {
  description = "Current number of instances"
  value       = module.compute.instance_count
}

output "database_cluster_id" {
  description = "Managed PostgreSQL cluster ID"
  value       = module.database.cluster_id
}

output "database_host" {
  description = "Managed PostgreSQL host"
  value       = module.database.cluster_host
}

output "database_connection_string" {
  description = "PostgreSQL connection string (sensitive)"
  value       = module.database.connection_string
  sensitive   = true
}
