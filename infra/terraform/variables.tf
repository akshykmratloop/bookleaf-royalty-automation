variable "aws_account_id" {
  description = "The only account this may be applied to (guards against the wrong profile)."
  type        = string
  default     = "533063875346"
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "project" {
  description = "Value of the Project tag on every resource; also the budget's cost filter."
  type        = string
  default     = "bookleaf-assignment2"
}

variable "name" {
  description = "Short prefix for resource names."
  type        = string
  default     = "bookleaf-a2-n8n"
}

variable "ssm_prefix" {
  description = "Parameter Store path that holds this box's secrets and app config."
  type        = string
  default     = "/bookleaf-a2"

  validation {
    condition     = can(regex("^/[a-z0-9-]+$", var.ssm_prefix))
    error_message = "ssm_prefix must look like /some-name (no trailing slash)."
  }
}

variable "instance_type" {
  description = "t4g.small (2 vCPU burst, 2 GB, arm64) runs n8n + Postgres + Caddy comfortably."
  type        = string
  default     = "t4g.small"
}

variable "root_volume_gb" {
  type    = number
  default = 20

  validation {
    condition     = var.root_volume_gb >= 10 && var.root_volume_gb <= 100
    error_message = "root_volume_gb must be between 10 and 100."
  }
}

variable "swap_gb" {
  type    = number
  default = 2

  validation {
    condition     = var.swap_gb >= 1 && var.swap_gb <= 4
    error_message = "swap_gb must be between 1 and 4."
  }
}

variable "n8n_image" {
  description = "Exact n8n image tag (newest 2.x stable that was at least ~2 weeks old when pinned)."
  type        = string
  default     = "n8nio/n8n:2.45.4"
}

variable "postgres_image" {
  type    = string
  default = "postgres:16-alpine"
}

variable "caddy_image" {
  type    = string
  default = "caddy:2.11"
}

variable "alert_email" {
  description = "Gets the Let's Encrypt account mail and the budget alerts."
  type        = string
  default     = "akshykmr@loopmethods.com"
}

variable "monthly_budget_usd" {
  type    = number
  default = 20
}

variable "app_env" {
  description = "App config for the older $env-reading workflows, kept for a rollback; the current workflows read the bookleaf_settings table."
  type        = map(string)
  default = {
    ALLOW_DRILLS       = "true"
    EMAIL_PROVIDER     = "smtp"
    DEFAULT_DEMO_INBOX = ""
    BOOKLEAF_DB        = "bookleaf"
    CALLBACK_MODE      = "pull"
    BUBBLE_APP_BASE    = ""
    MAX_SENDS_PER_HOUR = "60"
  }
}
