variable "cluster_name" {
  description = "PostgreSQL cluster name"
  type        = string
  default     = "messenger-postgres"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "messenger"
}

variable "db_user" {
  description = "Database user name"
  type        = string
  default     = "messenger"
}

variable "db_password" {
  description = "Database user password"
  type        = string
  sensitive   = true
}

variable "network_id" {
  description = "VPC network ID"
  type        = string
}

variable "subnet_id" {
  description = "Database subnet ID"
  type        = string
}

variable "security_group_id" {
  description = "Security group ID for database"
  type        = string
}

variable "pg_version" {
  description = "PostgreSQL version"
  type        = string
  default     = "15"
}

variable "resource_preset" {
  description = "Resource preset (s2.micro, s2.small, etc.)"
  type        = string
  default     = "s2.micro"
}

variable "disk_size" {
  description = "Disk size in GB"
  type        = number
  default     = 20
}

variable "zone" {
  description = "Availability zone"
  type        = string
  default     = "ru-central1-a"
}
