variable "alb_name" {
  description = "Application Load Balancer name"
  type        = string
  default     = "messenger-alb"
}

variable "domain" {
  description = "Domain name for the application"
  type        = string
}

variable "public_subnet_id" {
  description = "Public subnet ID for ALB"
  type        = string
}

variable "security_group_id" {
  description = "Security group ID for ALB"
  type        = string
}

variable "enable_https" {
  description = "Enable HTTPS with Let's Encrypt"
  type        = bool
  default     = true
}

variable "certificate_id" {
  description = "Certificate Manager certificate ID (if not using Let's Encrypt)"
  type        = string
  default     = null
}

variable "network_id" {
  description = "VPC network ID"
  type        = string
}

variable "zone" {
  description = "Availability zone"
  type        = string
  default     = "ru-central1-a"
}
