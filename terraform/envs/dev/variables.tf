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

variable "domain" {
  description = "Domain name for the application (e.g., messenger.example.com)"
  type        = string
}

variable "docker_image" {
  description = "Docker image URL (e.g., cellardooor/blank:latest)"
  type        = string
}

variable "jwt_secret" {
  description = "JWT signing secret"
  type        = string
  sensitive   = true
}

variable "jwt_duration" {
  description = "Token lifetime"
  type        = string
  default     = "24h"
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
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

variable "default_user" {
  description = "Default user for messenger login"
  type        = string
  default     = ""
}

variable "default_password" {
  description = "Default password for messenger login"
  type        = string
  sensitive   = true
  default     = ""
}

variable "min_instances" {
  description = "Minimum number of instances"
  type        = number
  default     = 2
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
  default     = 4
}

variable "service_account_id" {
  description = "Service account ID for instance group"
  type        = string
  default     = null
}

variable "certificate_id" {
  description = "Certificate Manager certificate ID (if not using Let's Encrypt)"
  type        = string
  default     = null
}
