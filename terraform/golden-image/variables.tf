variable "image_name" {
  description = "Name for the Golden Image"
  type        = string
  default     = "messenger-golden"
}

variable "docker_image" {
  description = "Docker image URL to pre-install in Golden Image"
  type        = string
}

variable "zone" {
  description = "Availability zone"
  type        = string
  default     = "ru-central1-a"
}

variable "subnet_id" {
  description = "Subnet ID for builder VM (needs internet access)"
  type        = string
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key for builder VM"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}
