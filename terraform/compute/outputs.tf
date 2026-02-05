output "instance_group_id" {
  description = "Instance group ID"
  value       = yandex_compute_instance_group.main.id
}

output "instance_group_name" {
  description = "Instance group name"
  value       = yandex_compute_instance_group.main.name
}

output "instance_count" {
  description = "Current number of instances in the group"
  value       = yandex_compute_instance_group.main.scale_policy[0].fixed_scale[0].size
}
