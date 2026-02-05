variable "vpc_name" {
  description = "VPC network name"
  type        = string
  default     = "messenger-vpc"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "zone" {
  description = "Yandex Cloud availability zone"
  type        = string
  default     = "ru-central1-a"
}

variable "public_subnet_cidr" {
  description = "Public subnet CIDR for ALB"
  type        = string
  default     = "10.0.1.0/24"
}

variable "app_subnet_cidr" {
  description = "Application subnet CIDR for VMs"
  type        = string
  default     = "10.0.2.0/24"
}

variable "db_subnet_cidr" {
  description = "Database subnet CIDR for Managed PostgreSQL"
  type        = string
  default     = "10.0.3.0/24"
}

variable "public_subnet_name" {
  description = "Public subnet name"
  type        = string
  default     = "messenger-public"
}

variable "app_subnet_name" {
  description = "Application subnet name"
  type        = string
  default     = "messenger-app"
}

variable "db_subnet_name" {
  description = "Database subnet name"
  type        = string
  default     = "messenger-db"
}

variable "alb_sg_name" {
  description = "ALB security group name"
  type        = string
  default     = "messenger-alb-sg"
}

variable "app_sg_name" {
  description = "Application security group name"
  type        = string
  default     = "messenger-app-sg"
}

variable "db_sg_name" {
  description = "Database security group name"
  type        = string
  default     = "messenger-db-sg"
}
