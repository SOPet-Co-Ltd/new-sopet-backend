#!/usr/bin/env bash
# Deploy the backend container on EC2 via AWS Systems Manager Run Command.
set -euo pipefail

: "${EC2_INSTANCE_ID:?EC2_INSTANCE_ID is required}"
: "${IMAGE_URI:?IMAGE_URI is required}"
: "${AWS_REGION:?AWS_REGION is required}"

ENV_FILE="${1:-.env.deploy}"
CADDYFILE="${2:-.caddy.deploy}"
DEPLOY_SCRIPT_SRC="${DEPLOY_SCRIPT_SRC:-infra/ec2/deploy.sh}"
SETUP_CADDY_SRC="${SETUP_CADDY_SRC:-infra/ec2/setup-caddy.sh}"
SSM_TIMEOUT_SECONDS="${SSM_TIMEOUT_SECONDS:-1800}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-15}"

if [ ! -f "$ENV_FILE" ]; then
  echo "::error::Env file not found: $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$CADDYFILE" ]; then
  echo "::error::Caddyfile not found: $CADDYFILE" >&2
  exit 1
fi

if [ ! -f "$DEPLOY_SCRIPT_SRC" ]; then
  echo "::error::Deploy script not found: $DEPLOY_SCRIPT_SRC" >&2
  exit 1
fi

if [ ! -f "$SETUP_CADDY_SRC" ]; then
  echo "::error::Caddy setup script not found: $SETUP_CADDY_SRC" >&2
  exit 1
fi

ENV_B64=$(base64 <"$ENV_FILE" | tr -d '\n')
CADDY_B64=$(base64 <"$CADDYFILE" | tr -d '\n')
SCRIPT_B64=$(base64 <"$DEPLOY_SCRIPT_SRC" | tr -d '\n')
SETUP_CADDY_B64=$(base64 <"$SETUP_CADDY_SRC" | tr -d '\n')

PARAMS=$(jq -n \
  --arg env_b64 "$ENV_B64" \
  --arg caddy_b64 "$CADDY_B64" \
  --arg script_b64 "$SCRIPT_B64" \
  --arg setup_caddy_b64 "$SETUP_CADDY_B64" \
  --arg image "$IMAGE_URI" \
  --arg region "$AWS_REGION" \
  '{
    commands: [
      "set -euxo pipefail",
      "mkdir -p /opt/sopet",
      ("echo " + ($script_b64 | @json) + " | base64 -d > /opt/sopet/deploy.sh"),
      "chmod +x /opt/sopet/deploy.sh",
      ("echo " + ($setup_caddy_b64 | @json) + " | base64 -d > /opt/sopet/setup-caddy.sh"),
      "chmod +x /opt/sopet/setup-caddy.sh",
      ("echo " + ($env_b64 | @json) + " | base64 -d > /opt/sopet/.env"),
      "chmod 600 /opt/sopet/.env",
      ("echo " + ($caddy_b64 | @json) + " | base64 -d > /opt/sopet/Caddyfile"),
      "chmod 644 /opt/sopet/Caddyfile",
      ("export IMAGE_URI=" + ($image | @sh)),
      "export ENV_FILE=/opt/sopet/.env",
      ("export AWS_REGION=" + ($region | @sh)),
      "/opt/sopet/deploy.sh",
      "/opt/sopet/setup-caddy.sh"
    ]
  }')

echo "Sending SSM deploy to $EC2_INSTANCE_ID (region $AWS_REGION, timeout ${SSM_TIMEOUT_SECONDS}s)"

COMMAND_ID=$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --timeout-seconds "$SSM_TIMEOUT_SECONDS" \
  --parameters "$PARAMS" \
  --query 'Command.CommandId' \
  --output text)

echo "SSM deploy command started: $COMMAND_ID"

print_invocation() {
  aws ssm get-command-invocation \
    --region "$AWS_REGION" \
    --command-id "$COMMAND_ID" \
    --instance-id "$EC2_INSTANCE_ID" \
    --output json
}

get_status() {
  local err_file
  err_file=$(mktemp)
  local status
  if status=$(aws ssm get-command-invocation \
    --region "$AWS_REGION" \
    --command-id "$COMMAND_ID" \
    --instance-id "$EC2_INSTANCE_ID" \
    --query 'Status' \
    --output text 2>"$err_file"); then
    rm -f "$err_file"
    echo "$status"
    return 0
  fi

  if grep -q 'InvocationDoesNotExist' "$err_file"; then
    rm -f "$err_file"
    echo "Pending"
    return 0
  fi

  echo "::warning::get-command-invocation failed:" >&2
  cat "$err_file" >&2
  rm -f "$err_file"
  echo "Unknown"
  return 1
}

deadline=$((SECONDS + SSM_TIMEOUT_SECONDS))
last_status=""

while [ "$SECONDS" -lt "$deadline" ]; do
  STATUS=$(get_status || echo "Unknown")

  if [ "$STATUS" != "$last_status" ]; then
    echo "SSM status: $STATUS (elapsed: $((SECONDS))s)"
    last_status="$STATUS"
  fi

  case "$STATUS" in
    Success)
      aws ssm get-command-invocation \
        --region "$AWS_REGION" \
        --command-id "$COMMAND_ID" \
        --instance-id "$EC2_INSTANCE_ID" \
        --query 'StandardOutputContent' \
        --output text
      echo "Deploy succeeded on $EC2_INSTANCE_ID"
      exit 0
      ;;
    Failed | Cancelled | TimedOut)
      echo "::error::Deploy failed with status: $STATUS" >&2
      print_invocation >&2 || true
      exit 1
      ;;
    *)
      sleep "$POLL_INTERVAL_SECONDS"
      ;;
  esac
done

echo "::error::Timed out after ${SSM_TIMEOUT_SECONDS}s waiting for SSM command $COMMAND_ID" >&2
print_invocation >&2 || true
exit 1
