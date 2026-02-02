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

variable "jwt_secret" {
  description = "JWT signing secret"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "http_addr" {
  description = "Server bind address"
  type        = string
  default     = ":8080"
}

variable "jwt_duration" {
  description = "Token lifetime"
  type        = string
  default     = "24h"
}

variable "db_host" {
  description = "Database host"
  type        = string
  default     = "localhost"
}

variable "db_port" {
  description = "Database port"
  type        = string
  default     = "5432"
}

variable "db_user" {
  description = "Database user"
  type        = string
  default     = "messenger"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "messenger"
}

variable "db_sslmode" {
  description = "SSL mode"
  type        = string
  default     = "disable"
}
