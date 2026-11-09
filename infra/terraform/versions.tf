# The self-hosted n8n box for BookLeaf Assignment 2. `terraform destroy` removes all of it.
# Run with AWS_PROFILE=loopmethods. State is LOCAL on purpose (one person, one short-lived box);
# terraform.tfstate holds generated secrets, so it is git-ignored and must never be committed.
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}
