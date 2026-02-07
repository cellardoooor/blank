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

# Golden Image module - creates VM with pre-installed Docker and application
# This is a one-time build step, VM can be deleted after image creation
module "golden_image" {
  source = "../../golden-image"

  image_name   = "${var.environment}-messenger-golden"
  docker_image = var.docker_image
  zone         = var.zone
  subnet_id    = module.network.app_subnet_id
}

# ALB module - creates Application Load Balancer
# Must be created before Instance Group to get target_group_id
module "alb" {
  source = "../../alb"

  alb_name          = "${var.environment}-messenger-alb"
  domain            = var.domain
  network_id        = module.network.vpc_id
  public_subnet_id  = module.network.public_subnet_id
  security_group_id = module.network.alb_security_group_id
  zone              = var.zone

  depends_on = [module.golden_image]
}

# Compute module - creates Instance Group using Golden Image
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

  # Use Golden Image for fast VM boot (~30 seconds)
  golden_image_id = module.golden_image.image_id
  target_group_id = module.alb.target_group_id

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

  # Wait for database, golden image, and ALB
  depends_on = [module.database, module.golden_image, module.alb]
}
