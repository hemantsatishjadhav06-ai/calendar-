# Relay production infrastructure (AWS). Apply per environment with -var-file=envs/<env>.tfvars.
terraform {
  required_version = ">= 1.7"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
  backend "s3" {}
}
provider "aws" { region = var.region }

variable "region" { default = "ap-south-1" }
variable "env" {}
variable "domain" {}                               # relay.example
variable "db_instance_class" { default = "db.r6g.large" }
variable "redis_node_type" { default = "cache.r6g.large" }

locals { name = "relay-${var.env}" }

module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"
  name = local.name
  cidr = "10.40.0.0/16"
  azs = ["${var.region}a", "${var.region}b", "${var.region}c"]
  private_subnets = ["10.40.0.0/20", "10.40.16.0/20", "10.40.32.0/20"]
  public_subnets  = ["10.40.100.0/24", "10.40.101.0/24", "10.40.102.0/24"]
  enable_nat_gateway = true
  single_nat_gateway = var.env != "prod"
}

module "eks" {
  source = "terraform-aws-modules/eks/aws"
  version = "~> 20.20"
  cluster_name = local.name
  cluster_version = "1.30"
  vpc_id = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets
  cluster_endpoint_public_access = true
  enable_irsa = true
  eks_managed_node_groups = {
    general = { instance_types = ["m6g.large"], ami_type = "AL2023_ARM_64_STANDARD", min_size = 2, max_size = 6, desired_size = 3 }
    media   = { instance_types = ["c6g.2xlarge"], ami_type = "AL2023_ARM_64_STANDARD", capacity_type = "SPOT", min_size = 0, max_size = 6, desired_size = 1, labels = { workload = "spot" }, taints = [] }
  }
}

resource "aws_db_subnet_group" "db" { name = local.name; subnet_ids = module.vpc.private_subnets }
resource "aws_security_group" "db" { name = "${local.name}-db"; vpc_id = module.vpc.vpc_id
  ingress { from_port = 5432; to_port = 5432; protocol = "tcp"; cidr_blocks = [module.vpc.vpc_cidr_block] } }
resource "aws_db_parameter_group" "pg" {
  name = "${local.name}-pg16"; family = "postgres16"
  parameter { name = "shared_preload_libraries"; value = "timescaledb,pg_stat_statements"; apply_method = "pending-reboot" }
  parameter { name = "max_connections"; value = "400"; apply_method = "pending-reboot" }
}
resource "aws_db_instance" "pg" {
  identifier = local.name
  engine = "postgres"; engine_version = "16"
  instance_class = var.db_instance_class
  allocated_storage = 200; max_allocated_storage = 1000; storage_type = "gp3"; storage_encrypted = true
  db_name = "relay"; username = "relay_admin"; manage_master_user_password = true
  db_subnet_group_name = aws_db_subnet_group.db.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name = aws_db_parameter_group.pg.name
  multi_az = var.env == "prod"
  backup_retention_period = 35; copy_tags_to_snapshot = true; deletion_protection = var.env == "prod"
  performance_insights_enabled = true
  skip_final_snapshot = var.env != "prod"
  # NOTE: TimescaleDB on RDS is available as the Apache-2 edition; continuous aggregates & compression need self-managed Timescale or Timescale Cloud.
}

resource "aws_elasticache_subnet_group" "redis" { name = local.name; subnet_ids = module.vpc.private_subnets }
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = local.name; description = "Relay queues, budgets, pub/sub"
  engine = "redis"; engine_version = "7.1"; node_type = var.redis_node_type
  num_cache_clusters = var.env == "prod" ? 2 : 1; automatic_failover_enabled = var.env == "prod"
  subnet_group_name = aws_elasticache_subnet_group.redis.name
  at_rest_encryption_enabled = true; transit_encryption_enabled = true
  parameter_group_name = "default.redis7"
  # BullMQ requires maxmemory-policy noeviction → custom parameter group in prod
}

resource "aws_s3_bucket" "media" { bucket = "${local.name}-media" }
resource "aws_s3_bucket_versioning" "media" { bucket = aws_s3_bucket.media.id; versioning_configuration { status = "Enabled" } }
resource "aws_s3_bucket_lifecycle_configuration" "media" { bucket = aws_s3_bucket.media.id
  rule { id = "ia"; status = "Enabled"; transition { days = 90; storage_class = "STANDARD_IA" } }
  rule { id = "mpu"; status = "Enabled"; abort_incomplete_multipart_upload { days_after_initiation = 2 } } }
resource "aws_s3_bucket_public_access_block" "media" { bucket = aws_s3_bucket.media.id; block_public_acls = true; block_public_policy = true; ignore_public_acls = true; restrict_public_buckets = true }

resource "aws_cloudfront_origin_access_control" "media" { name = local.name; origin_access_control_origin_type = "s3"; signing_behavior = "always"; signing_protocol = "sigv4" }
resource "aws_cloudfront_distribution" "media" {
  enabled = true; aliases = ["media.${var.domain}"]
  origin { domain_name = aws_s3_bucket.media.bucket_regional_domain_name; origin_id = "s3"; origin_access_control_id = aws_cloudfront_origin_access_control.media.id }
  default_cache_behavior { target_origin_id = "s3"; viewer_protocol_policy = "https-only"; allowed_methods = ["GET", "HEAD"]; cached_methods = ["GET", "HEAD"]; cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"; trusted_key_groups = [aws_cloudfront_key_group.media.id] }
  restrictions { geo_restriction { restriction_type = "none" } }
  viewer_certificate { acm_certificate_arn = var.cf_cert_arn; ssl_support_method = "sni-only" }
}
variable "cf_cert_arn" {}
resource "aws_cloudfront_public_key" "media" { name = "${local.name}-media"; encoded_key = file("${path.module}/keys/cloudfront_public.pem") }
resource "aws_cloudfront_key_group" "media" { name = "${local.name}-media"; items = [aws_cloudfront_public_key.media.id] }

resource "aws_kms_key" "tokens" { description = "Relay token vault DEK wrapping"; enable_key_rotation = true }
resource "aws_kms_alias" "tokens" { name = "alias/${local.name}-tokens"; target_key_id = aws_kms_key.tokens.id }

resource "aws_ses_domain_identity" "mail" { domain = var.domain }

output "eks_cluster_name" { value = module.eks.cluster_name }
output "db_endpoint" { value = aws_db_instance.pg.address }
output "redis_endpoint" { value = aws_elasticache_replication_group.redis.primary_endpoint_address }
output "media_bucket" { value = aws_s3_bucket.media.bucket }
output "kms_token_key_arn" { value = aws_kms_key.tokens.arn }
