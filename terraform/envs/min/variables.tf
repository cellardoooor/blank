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
  description = "Environment name (must match existing resources)"
  type        = string
  default     = "dev"
}

variable "docker_image" {
  description = "Docker image URL for application"
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

variable "http_addr" {
  description = "HTTP address for the server"
  type        = string
  default     = ":8080"
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

variable "db_user" {
  description = "Database user"
  type        = string
  default     = "messenger"
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
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

variable "encryption_key" {
  description = "Encryption key for message encryption"
  type        = string
  sensitive   = true
  default     = ""
}

variable "domain" {
  description = "Domain name"
  type        = string
}

variable "ice_servers" {
  description = "ICE servers for WebRTC (JSON array)"
  type        = string
  default     = "[{\"urls\":\"stun:stun.l.google.com:19302\"},{\"urls\":\"turn:openrelay.metered.ca:80\",\"username\":\"openrelayproject\",\"credential\":\"openrelayproject\"},{\"urls\":\"turn:openrelay.metered.ca:443\",\"username\":\"openrelayproject\",\"credential\":\"openrelayproject\"},{\"urls\":\"turn:openrelay.metered.ca:443?transport=tcp\",\"username\":\"openrelayproject\",\"credential\":\"openrelayproject\"}]"
}
