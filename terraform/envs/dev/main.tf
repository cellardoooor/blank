module "network" {
  source = "../../network"

  vpc_name            = "${var.environment}-messenger-vpc"
  vpc_cidr            = "10.0.0.0/16"
  subnet_name         = "${var.environment}-messenger-subnet"
  subnet_cidr         = "10.0.1.0/24"
  zone                = var.zone
  security_group_name = "${var.environment}-messenger-sg"
}

module "compute" {
  source = "../../compute"

  instance_name      = "${var.environment}-messenger-backend"
  zone               = var.zone
  cores              = 2
  memory             = 4
  disk_size          = 20
  subnet_id          = module.network.subnet_id
  security_group_ids = [module.network.security_group_id]

  docker_image   = var.docker_image
  container_name = var.container_name
  app_env        = var.app_env
  app_port       = var.app_port
}
