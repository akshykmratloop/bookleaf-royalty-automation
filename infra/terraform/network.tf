# Default VPC, public subnet, no NAT. Inbound is 80 (ACME + redirect) and 443 only. No SSH: use SSM.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnet" "default" {
  vpc_id            = data.aws_vpc.default.id
  availability_zone = "${var.region}a"
  default_for_az    = true
}

resource "aws_security_group" "box" {
  name        = var.name
  description = "n8n box: HTTPS (and HTTP for certificates) only. No SSH: use SSM."
  vpc_id      = data.aws_vpc.default.id
  tags        = { Name = var.name }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each          = toset(["80", "443"])
  security_group_id = aws_security_group.box.id
  description       = "public ${each.value}"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.box.id
  description       = "all outbound (packages, images, Lets Encrypt, AI and mail APIs)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
