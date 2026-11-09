# One small arm64 box. The Elastic IP is created first, so its address is baked into the
# sslip.io host name (n8n + Caddy) before the box ever boots.
#
# Ubuntu 24.04 arm64 rather than Amazon Linux 2023: Docker's own apt repo ships docker-ce and
# the compose plugin for it (AL2023 has no compose plugin package), the SSM agent is
# preinstalled, and it matches the bootstrap already proven on the BookLeaf demo box.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_eip" "box" {
  domain = "vpc"
  tags   = { Name = var.name }
}

locals {
  n8n_host = "n8n.${replace(aws_eip.box.public_ip, ".", "-")}.sslip.io"

  # /etc/n8n/project.env: non-secret identity of the box, read by n8n-load-env.
  project_env = join("\n", [
    "AWS_REGION=${var.region}",
    "SSM_PREFIX=${var.ssm_prefix}",
    "N8N_HOST=${local.n8n_host}",
    "ACME_EMAIL=${var.alert_email}",
    "N8N_IMAGE=${var.n8n_image}",
    "POSTGRES_IMAGE=${var.postgres_image}",
    "CADDY_IMAGE=${var.caddy_image}",
  ])

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    swap_gb      = var.swap_gb
    project_env  = local.project_env
    compose_yml  = file("${path.module}/files/docker-compose.yml")
    caddyfile    = file("${path.module}/files/Caddyfile")
    load_env_sh  = file("${path.module}/files/n8n-load-env")
    stack_unit   = file("${path.module}/files/n8n-stack.service")
    init_sql_b64 = filebase64("${path.module}/../db/init/01-bookleaf.sql")
  })
}

resource "aws_instance" "box" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnet.default.id
  vpc_security_group_ids = [aws_security_group.box.id]
  iam_instance_profile   = aws_iam_instance_profile.box.name

  user_data_base64            = base64gzip(local.user_data)
  user_data_replace_on_change = false

  # Standard credits: a busy minute slows down instead of adding burst charges to the bill.
  credit_specification {
    cpu_credits = "standard"
  }

  # IMDSv2 only, hop limit 1: the host's AWS CLI can reach it, containers cannot.
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    http_endpoint               = "enabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    encrypted             = true
    delete_on_termination = true
    tags                  = { Name = var.name }
  }

  tags = { Name = var.name }

  # The parameters must exist before the first boot reads them.
  depends_on = [
    aws_ssm_parameter.n8n_encryption_key,
    aws_ssm_parameter.postgres_password,
    aws_ssm_parameter.app_env,
    aws_iam_role_policy.box,
  ]

  lifecycle {
    # A newer AMI or an edited bootstrap must never replace the running box (and its database).
    ignore_changes = [ami, user_data_base64]
  }
}

resource "aws_eip_association" "box" {
  instance_id   = aws_instance.box.id
  allocation_id = aws_eip.box.id
}
