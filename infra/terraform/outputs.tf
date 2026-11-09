output "instance_id" {
  value = aws_instance.box.id
}

output "public_ip" {
  value = aws_eip.box.public_ip
}

output "n8n_host" {
  value = local.n8n_host
}

output "n8n_url" {
  value = "https://${local.n8n_host}"
}

output "ssm_parameters" {
  description = "Parameter names only (values are secret)."
  value = [
    aws_ssm_parameter.n8n_encryption_key.name,
    aws_ssm_parameter.postgres_password.name,
    aws_ssm_parameter.app_env.name,
  ]
}
