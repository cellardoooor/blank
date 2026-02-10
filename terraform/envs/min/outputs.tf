output "vm_id" {
  description = "VM ID"
  value       = yandex_compute_instance.min_vm.id
}

output "vm_ip" {
  description = "VM external IP (static)"
  value       = yandex_vpc_address.static_ip.external_ipv4_address[0].address
}

output "vm_name" {
  description = "VM name"
  value       = yandex_compute_instance.min_vm.name
}

output "domain" {
  description = "Domain"
  value       = var.domain
}

output "docker_image" {
  description = "Docker image used"
  value       = var.docker_image
}

output "data_disk_id" {
  description = "Data disk ID"
  value       = yandex_compute_disk.data_disk.id
}

output "source_db_host" {
  description = "Source database host (Managed PostgreSQL)"
  value       = module.database.cluster_host
}
