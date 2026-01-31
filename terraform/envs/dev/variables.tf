variable "yc_token" {
  description = "Yandex Cloud OAuth token or IAM token"
  type        = string
  sensitive   = true
}

variable "yc_cloud_id" {
  description = "Yandex Cloud ID"
  type        = string
}

variable "yc_folder_id" {
  description = "Yandex Cloud Folder ID"
  type        = string
}

variable "zone" {
  description = "Yandex Cloud availability zone"
  type        = string
  default     = "ru-central1-a"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "docker_image" {
  description = "Docker image URL in Yandex Container Registry (e.g., cr.yandex/crpXXXXXX/messenger:latest)"
  type        = string
}

variable "container_name" {
  description = "Docker container name"
  type        = string
  default     = "messenger-app"
}

variable "app_port" {
  description = "Application port inside container"
  type        = number
  default     = 8080
}

variable "app_env" {
  description = "Environment variables for the application"
  type        = map(string)
  default     = {}
}
