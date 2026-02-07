output "instance_group_id" {
  description = "Instance group ID"
  value       = yandex_compute_instance_group.main.id
}

output "instance_group_name" {
  description = "Instance group name"
  value       = yandex_compute_instance_group.main.name
}

output "instance_count" {
  value = yandex_compute_instance_group.main.scale_policy[0].auto_scale[0].initial_size
}

output "target_group_id" {
  value = yandex_compute_instance_group.main.application_load_balancer[0].target_group_id
  description = "Target Group ID created by Instance Group"
}
