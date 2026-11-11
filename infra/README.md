# infra — the self-hosted n8n box

Terraform in `terraform/` builds one small AWS host for the n8n workflows
(account `533063875346`, region `ap-south-1`, every resource tagged `Project=bookleaf-assignment2`).

## What it creates

| Resource | Detail |
| --- | --- |
| EC2 `t4g.small` | Ubuntu 24.04 arm64, 20 GB gp3 encrypted root, IMDSv2 only, 2 GB swap |
| Elastic IP | gives the stable host name `n8n.<ip-with-dashes>.sslip.io` |
| Security group | inbound **80 and 443 only**. No SSH: use SSM Session Manager |
| IAM role | `AmazonSSMManagedInstanceCore` + read access to `/bookleaf-a2/*` parameters |
| SSM parameters | `/bookleaf-a2/n8n/encryption_key`, `/bookleaf-a2/postgres/password`, `/bookleaf-a2/n8n/app_env` (all SecureString) |
| AWS Budget | $20/month, emails at 80% and 100% |

On the box (`/opt/n8n`, started by `n8n-stack.service` at every boot):

- **Caddy** — the only container with published ports; gets the Let's Encrypt certificate itself.
- **n8n** — pinned image (`var.n8n_image`), Postgres-backed. The workflows read their settings from the
  `bookleaf_settings` table (see `n8n/PAYLOAD.md`, Server settings); `$env` stays blocked (n8n's default).
- **Postgres 16** — DB `n8n` for n8n itself; `db/init/01-bookleaf.sql` creates the `bookleaf`
  DB with the `royalty_jobs` ledger and the `bookleaf_settings` table on the first start. An
  existing database is upgraded with `db/migrations/*.sql` (additive, re-runnable;
  `scripts/ops/migrate-prod.sh` backs production up before applying one).

Secrets never travel in user data: `n8n-load-env` reads them from SSM before each start and
writes `/opt/n8n/.env` and `/opt/n8n/app.env` (mode 600).

**Cost:** about **$12–15/month** (t4g.small on-demand ≈ $12, 20 GB gp3 ≈ $1.8, public IPv4 ≈ $3.6
while running). `terraform destroy` brings it to zero.

## Apply / destroy

```bash
cd infra/terraform
export AWS_PROFILE=loopmethods
terraform init
terraform plan -out=n8n.tfplan && terraform apply n8n.tfplan
terraform output n8n_url             # https://n8n.<ip>.sslip.io (TLS takes ~3–5 min on first boot)
terraform destroy                    # removes everything, including the parameters and data
```

State is **local** (`terraform.tfstate`, git-ignored — it contains the generated secrets).
Editing the bootstrap or a newer AMI never replaces the running box (`ignore_changes`).

## Read the secrets and change settings

```bash
aws ssm get-parameter --profile loopmethods --region ap-south-1 \
  --name /bookleaf-a2/postgres/password --with-decryption --query Parameter.Value --output text

# Workflow settings live in the bookleaf_settings table. Write the per-environment ones with
# n8n/tools/settings-sql.mjs into a temp file outside the repo, apply it with
# scripts/ops/migrate-prod.sh <that file> (backs up first), then delete the file.
# n8n/app_env below is only read by the older $env workflows (kept for a rollback):
aws ssm get-parameter --profile loopmethods --region ap-south-1 \
  --name /bookleaf-a2/n8n/app_env --with-decryption --query Parameter.Value --output text > app.env
# edit app.env, then:
aws ssm put-parameter --profile loopmethods --region ap-south-1 --overwrite \
  --name /bookleaf-a2/n8n/app_env --type SecureString --value file://app.env
# and apply it on the box (restarts n8n with the new values):
aws ssm send-command --profile loopmethods --region ap-south-1 \
  --instance-ids "$(terraform -chdir=infra/terraform output -raw instance_id)" \
  --document-name AWS-RunShellScript --parameters 'commands=["systemctl restart n8n-stack"]'
```

The n8n owner login and public-API key are **not** in SSM: they live only in the git-ignored
`bubble/.secrets/n8n.env`.

## Get a shell on the box

```bash
aws ssm start-session --profile loopmethods --region ap-south-1 \
  --target "$(terraform -chdir=infra/terraform output -raw instance_id)"
sudo -i; cd /opt/n8n
docker compose ps; docker compose logs -f n8n
cat /var/log/n8n-bootstrap.log        # first-boot log
```

(`start-session` needs the Session Manager plugin for the AWS CLI installed locally.)
