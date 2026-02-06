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

output "target_group_id" {
  description = "ALB target group ID created by instance group"
  value       = yandex_compute_instance_group.main.application_load_balancer[0].target_group_id
}
