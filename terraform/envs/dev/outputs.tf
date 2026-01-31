output "vpc_id" {
  description = "VPC ID"
  value       = module.network.vpc_id
}

output "subnet_id" {
  description = "Subnet ID"
  value       = module.network.subnet_id
}

output "security_group_id" {
  description = "Security Group ID"
  value       = module.network.security_group_id
}

output "instance_id" {
  description = "Compute Instance ID"
  value       = module.compute.instance_id
}

output "public_ip" {
  description = "Public IP address of the instance"
  value       = module.compute.public_ip
}

output "private_ip" {
  description = "Private IP address of the instance"
  value       = module.compute.private_ip
}
