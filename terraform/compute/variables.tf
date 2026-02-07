variable "instance_group_name" {
  description = "Instance group name"
  type        = string
  default     = "messenger-backend"
}

variable "zone" {
  description = "Availability zone"
  type        = string
  default     = "ru-central1-a"
}

variable "cores" {
  description = "Number of CPU cores per instance"
  type        = number
  default     = 2
}

variable "memory" {
  description = "Memory in GB per instance"
  type        = number
  default     = 4
}

variable "disk_size" {
  description = "Boot disk size in GB"
  type        = number
  default     = 20
}

variable "subnet_id" {
  description = "Subnet ID for instances (app subnet)"
  type        = string
}

variable "security_group_ids" {
  description = "List of security group IDs"
  type        = list(string)
  default     = []
}

variable "docker_image" {
  description = "Docker image URL"
  type        = string
}

variable "container_name" {
  description = "Docker container name"
  type        = string
  default     = "messenger-app"
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
  description = "Managed PostgreSQL host"
  type        = string
}

variable "db_port" {
  description = "Database port"
  type        = string
  default     = "6432"
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
  default     = "require"
}

variable "app_port" {
  description = "Application port inside container"
  type        = number
  default     = 8080
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

variable "folder_id" {
  description = "Yandex Cloud folder ID"
  type        = string
}

variable "network_id" {
  description = "VPC network ID"
  type        = string
}

variable "service_account_id" {
  description = "Service account ID for instance group"
  type        = string
}

variable "target_group_id" {
  description = "ALB target group ID to attach instances"
  type        = string
}
