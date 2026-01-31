output "instance_id" {
  description = "Compute instance ID"
  value       = yandex_compute_instance.main.id
}

output "public_ip" {
  description = "Public IP address of the instance"
  value       = yandex_compute_instance.main.network_interface[0].nat_ip_address
}

output "private_ip" {
  description = "Private IP address of the instance"
  value       = yandex_compute_instance.main.network_interface[0].ip_address
}
