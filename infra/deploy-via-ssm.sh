#!/usr/bin/env bash
# Deploy the backend container on EC2 via AWS Systems Manager Run Command.
set -euo pipefail

: "${EC2_INSTANCE_ID:?EC2_INSTANCE_ID is required}"
: "${IMAGE_URI:?IMAGE_URI is required}"

ENV_FILE="${1:-.env.deploy}"
DEPLOY_SCRIPT_PATH="${DEPLOY_SCRIPT_PATH:-/opt/sopet/deploy.sh}"
SSM_TIMEOUT_SECONDS="${SSM_TIMEOUT_SECONDS:-600}"

if [ ! -f "$ENV_FILE" ]; then
  echo "::error::Env file not found: $ENV_FILE" >&2
  exit 1
fi

ENV_B64=$(base64 <"$ENV_FILE" | tr -d '\n')
PARAMS=$(jq -n \
  --arg image "$IMAGE_URI" \
  --arg env_b64 "$ENV_B64" \
  --arg script "$DEPLOY_SCRIPT_PATH" \
  '{
    commands: [
      "set -euo pipefail",
      "mkdir -p /opt/sopet",
      "echo \($env_b64) | base64 -d > /opt/sopet/.env",
      "chmod 600 /opt/sopet/.env",
      ("export IMAGE_URI=" + ($image | @sh)),
      "export ENV_FILE=/opt/sopet/.env",
      $script
    ]
  }')

COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --timeout-seconds "$SSM_TIMEOUT_SECONDS" \
  --parameters "$PARAMS" \
  --query 'Command.CommandId' \
  --output text)

echo "SSM deploy command started: $COMMAND_ID"

deadline=$((SECONDS + SSM_TIMEOUT_SECONDS))
while [ "$SECONDS" -lt "$deadline" ]; do
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$EC2_INSTANCE_ID" \
    --query 'Status' \
    --output text 2>/dev/null || echo "Pending")

  case "$STATUS" in
    Success)
      aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$EC2_INSTANCE_ID" \
        --query 'StandardOutputContent' \
        --output text
      echo "Deploy succeeded on $EC2_INSTANCE_ID"
      exit 0
      ;;
    Failed | Cancelled | TimedOut)
      echo "::error::Deploy failed with status: $STATUS" >&2
      aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$EC2_INSTANCE_ID" \
        --output json >&2 || true
      exit 1
      ;;
    *)
      sleep 5
      ;;
  esac
done

echo "::error::Timed out waiting for SSM command $COMMAND_ID" >&2
exit 1
