# Secrets are generated here and kept in Parameter Store; the box reads them at every boot
# (n8n-load-env). Nothing secret travels in user_data. Values also sit in the local tfstate,
# which is git-ignored.
resource "random_password" "n8n_encryption_key" {
  length  = 48
  special = false
}

resource "random_password" "postgres" {
  length  = 40
  special = false
}

resource "aws_ssm_parameter" "n8n_encryption_key" {
  name        = "${var.ssm_prefix}/n8n/encryption_key"
  description = "N8N_ENCRYPTION_KEY (encrypts stored credentials; losing it loses them)"
  type        = "SecureString"
  value       = random_password.n8n_encryption_key.result
}

resource "aws_ssm_parameter" "postgres_password" {
  name        = "${var.ssm_prefix}/postgres/password"
  description = "Password of the n8n Postgres superuser"
  type        = "SecureString"
  value       = random_password.postgres.result
}

# App config of the older workflows that read $env, as dotenv lines (one parameter because SSM
# cannot store an empty value, and several keys start empty). The current workflows read the
# bookleaf_settings table instead; this stays only for a rollback. Terraform writes it once.
resource "aws_ssm_parameter" "app_env" {
  name        = "${var.ssm_prefix}/n8n/app_env"
  description = "Workflow config for n8n (dotenv lines), rendered to /opt/n8n/app.env"
  type        = "SecureString"
  value       = join("\n", [for k in sort(keys(var.app_env)) : "${k}=${var.app_env[k]}"])

  lifecycle {
    ignore_changes = [value]
  }
}
