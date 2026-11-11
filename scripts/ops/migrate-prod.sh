#!/usr/bin/env bash
# Applies a job-ledger migration to the production n8n box, safely:
#   1. pg_dump backup of the `bookleaf` database on the box (/opt/n8n/backups)
#   2. the migration, in one transaction, stopping on the first error
#   3. a read-back of the job counts and the column count
# Usage: scripts/ops/migrate-prod.sh infra/db/migrations/02-drafts-stages.sql
# Needs: AWS profile `loopmethods`, and N8N_INSTANCE_ID in .secrets/n8n.env. No secret is printed.
set -euo pipefail
cd "$(dirname "$0")/../.."

SQL_FILE="${1:?usage: migrate-prod.sh <migration.sql>}"
[ -f "$SQL_FILE" ] || { echo "no such file: $SQL_FILE" >&2; exit 1; }
IID="$(grep '^N8N_INSTANCE_ID=' .secrets/n8n.env | cut -d= -f2)"
[ -n "$IID" ] || { echo "N8N_INSTANCE_ID missing in .secrets/n8n.env" >&2; exit 1; }
AWS=(aws --profile loopmethods --region ap-south-1)
B64="$(base64 < "$SQL_FILE" | tr -d '\n')"
PARAMS="$(mktemp)"
trap 'rm -f "$PARAMS"' EXIT

python3 - "$B64" > "$PARAMS" <<'PY'
import json, sys
b64 = sys.argv[1]
cmds = [
  "set -eu", "cd /opt/n8n", "mkdir -p /opt/n8n/backups",
  "TS=$(date +%Y%m%d-%H%M%S)",
  "docker compose exec -T postgres pg_dump -U n8n -d bookleaf -Fc > /opt/n8n/backups/bookleaf-$TS.dump",
  "ls -la /opt/n8n/backups | tail -3",
  f"echo '{b64}' | base64 -d > /tmp/migration.sql",
  "docker compose exec -T postgres psql -U n8n -d bookleaf -v ON_ERROR_STOP=1 < /tmp/migration.sql",
  "docker compose exec -T postgres psql -U n8n -d bookleaf -c \"select status, count(*) from royalty_jobs group by 1\" "
  "-c \"select count(*) as columns from information_schema.columns where table_name='royalty_jobs'\"",
]
print(json.dumps({"commands": cmds}))
PY

CID="$("${AWS[@]}" ssm send-command --instance-ids "$IID" --document-name AWS-RunShellScript \
  --parameters "file://$PARAMS" --query Command.CommandId --output text)"
echo "SSM command $CID"
for _ in $(seq 1 40); do
  STATUS="$("${AWS[@]}" ssm get-command-invocation --command-id "$CID" --instance-id "$IID" --query Status --output text 2>/dev/null || true)"
  case "$STATUS" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 3
done
"${AWS[@]}" ssm get-command-invocation --command-id "$CID" --instance-id "$IID" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
[ "$STATUS" = "Success" ]
