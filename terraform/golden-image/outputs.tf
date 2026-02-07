output "image_id" {
  description = "ID of the created Golden Image"
  value       = yandex_compute_image.golden.id
}

output "image_name" {
  description = "Name of the Golden Image"
  value       = yandex_compute_image.golden.name
}

output "builder_vm_id" {
  description = "ID of the builder VM (can be deleted after image creation)"
  value       = yandex_compute_instance.builder.id
}

output "builder_vm_name" {
  description = "Name of the builder VM"
  value       = yandex_compute_instance.builder.name
}
