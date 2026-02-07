# Network module - creates VPC, 3 subnets, and 3 security groups
module "network" {
  source = "../../network"

  vpc_name = "${var.environment}-messenger-vpc"
  vpc_cidr = "10.0.0.0/16"
  zone     = var.zone

  # Subnets
  public_subnet_name = "${var.environment}-messenger-public"
  public_subnet_cidr = "10.0.1.0/24"
  app_subnet_name    = "${var.environment}-messenger-app"
  app_subnet_cidr    = "10.0.2.0/24"
  db_subnet_name     = "${var.environment}-messenger-db"
  db_subnet_cidr     = "10.0.3.0/24"

  # Security Groups
  alb_sg_name = "${var.environment}-messenger-alb-sg"
  app_sg_name = "${var.environment}-messenger-app-sg"
  db_sg_name  = "${var.environment}-messenger-db-sg"
}

# Database module - creates Managed PostgreSQL
module "database" {
  source = "../../database"

  cluster_name      = "${var.environment}-messenger-postgres"
  db_name           = var.db_name
  db_user           = var.db_user
  db_password       = var.db_password
  network_id        = module.network.vpc_id
  subnet_id         = module.network.db_subnet_id
  security_group_id = module.network.db_security_group_id
  pg_version        = "15"
  resource_preset   = "s2.micro"
  disk_size         = 20
  zone              = var.zone
}

# ALB module - creates Application Load Balancer and Target Group
module "alb" {
  source = "../../alb"

  alb_name          = "${var.environment}-messenger-alb"
  domain            = var.domain
  network_id        = module.network.vpc_id
  public_subnet_id  = module.network.public_subnet_id
  security_group_id = module.network.alb_security_group_id
  zone              = var.zone
}

# Compute module - creates Instance Group attached to ALB Target Group
module "compute" {
  source = "../../compute"

  instance_group_name = "${var.environment}-messenger-backend"
  folder_id           = var.yc_folder_id
  network_id          = module.network.vpc_id
  zone                = var.zone
  cores               = 2
  memory              = 4
  disk_size           = 20
  subnet_id           = module.network.app_subnet_id
  security_group_ids  = [module.network.app_security_group_id]
  service_account_id  = var.service_account_id

  # Attach to ALB Target Group
  target_group_id = module.alb.target_group_id

  docker_image   = var.docker_image
  container_name = var.container_name
  app_port       = var.app_port

  jwt_secret   = var.jwt_secret
  jwt_duration = var.jwt_duration

  # Connect to Managed PostgreSQL
  db_host     = module.database.cluster_host
  db_port     = "6432"
  db_user     = var.db_user
  db_password = var.db_password
  db_name     = var.db_name
  db_sslmode  = "require"

  default_user     = var.default_user
  default_password = var.default_password

  min_instances = var.min_instances
  max_instances = var.max_instances

  # Wait for database and ALB to be fully created before starting compute instances
  depends_on = [module.database, module.alb]
}
