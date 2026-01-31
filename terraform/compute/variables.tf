variable "instance_name" {
  description = "Compute instance name"
  type        = string
  default     = "messenger-backend"
}

variable "zone" {
  description = "Availability zone"
  type        = string
  default     = "ru-central1-a"
}

variable "cores" {
  description = "Number of CPU cores"
  type        = number
  default     = 2
}

variable "memory" {
  description = "Memory in GB"
  type        = number
  default     = 4
}

variable "disk_size" {
  description = "Boot disk size in GB"
  type        = number
  default     = 20
}

variable "subnet_id" {
  description = "Subnet ID for the instance"
  type        = string
}

variable "security_group_ids" {
  description = "List of security group IDs"
  type        = list(string)
  default     = []
}

variable "docker_image" {
  description = "Docker image URL (e.g., cr.yandex/crp9svl97k0d9j7dvi0n/messenger:latest)"
  type        = string
}

variable "container_name" {
  description = "Docker container name"
  type        = string
  default     = "messenger-app"
}

variable "app_env" {
  description = "Environment variables for the application"
  type        = map(string)
  default     = {}
}

variable "app_port" {
  description = "Application port inside container"
  type        = number
  default     = 8080
}
