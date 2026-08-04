#!/usr/bin/env bash
# Deploy the backend container on EC2 via AWS Systems Manager Run Command.
#
# Timeout semantics (easy to confuse):
#   SSM_DELIVERY_TIMEOUT_SECONDS  — SendCommand --timeout-seconds: how long the
#                                   agent may take to *start* the command (default 120).
#   SSM_EXECUTION_TIMEOUT_SECONDS — AWS-RunShellScript executionTimeout: max runtime
#                                   on the instance before SSM marks TimedOut.
#   SSM_TIMEOUT_SECONDS           — How long this script polls get-command-invocation
#                                   before giving up (GHA waiter). Prefer matching
#                                   or slightly exceeding execution timeout.
#
# Without CloudWatch, StandardOutputContent/StandardErrorContent stay empty while
# Status=InProgress (ResponseCode -1). That is normal SSM behavior — not proof the
# agent is hung. Enable SSM_CLOUDWATCH_LOG_GROUP for live logs during long builds.
set -euo pipefail

: "${EC2_INSTANCE_ID:?EC2_INSTANCE_ID is required}"
: "${IMAGE_URI:?IMAGE_URI is required}"
: "${AWS_REGION:?AWS_REGION is required}"

ENV_FILE="${1:-.env.deploy}"
CADDYFILE="${2:-.caddy.deploy}"
DEPLOY_SCRIPT_SRC="${DEPLOY_SCRIPT_SRC:-infra/ec2/deploy.sh}"
SETUP_CADDY_SRC="${SETUP_CADDY_SRC:-infra/ec2/setup-caddy.sh}"
BUILD_ON_HOST_SRC="${BUILD_ON_HOST_SRC:-infra/ec2/build-on-host.sh}"
HEARTBEAT_SRC="${HEARTBEAT_SRC:-infra/ec2/ssm-heartbeat.sh}"
BUILD_ON_HOST="${BUILD_ON_HOST:-false}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-15}"
HEARTBEAT_EVERY_POLLS="${HEARTBEAT_EVERY_POLLS:-4}"
SSM_DELIVERY_TIMEOUT_SECONDS="${SSM_DELIVERY_TIMEOUT_SECONDS:-120}"
# Optional: CloudWatch log group for streaming SSM stdout/stderr (create once in AWS).
SSM_CLOUDWATCH_LOG_GROUP="${SSM_CLOUDWATCH_LOG_GROUP:-}"

if [ "$BUILD_ON_HOST" = "true" ]; then
  # Native arm64 docker build (yarn + native addons) on small t4g often exceeds 30m.
  SSM_TIMEOUT_SECONDS="${SSM_TIMEOUT_SECONDS:-3600}"
  SSM_EXECUTION_TIMEOUT_SECONDS="${SSM_EXECUTION_TIMEOUT_SECONDS:-3600}"
else
  SSM_TIMEOUT_SECONDS="${SSM_TIMEOUT_SECONDS:-1800}"
  SSM_EXECUTION_TIMEOUT_SECONDS="${SSM_EXECUTION_TIMEOUT_SECONDS:-1800}"
fi

required_files=("$ENV_FILE" "$CADDYFILE" "$DEPLOY_SCRIPT_SRC" "$SETUP_CADDY_SRC" "$HEARTBEAT_SRC")
for f in "${required_files[@]}"; do
  if [ ! -f "$f" ]; then
    echo "::error::Missing deploy input file: $f" >&2
    exit 1
  fi
done

if [ "$BUILD_ON_HOST" = "true" ]; then
  : "${GIT_COMMIT:?GIT_COMMIT is required when BUILD_ON_HOST=true}"
  : "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required when BUILD_ON_HOST=true}"
  : "${GITHUB_TOKEN:?GITHUB_TOKEN is required when BUILD_ON_HOST=true}"
  if [ ! -f "$BUILD_ON_HOST_SRC" ]; then
    echo "::error::Build script not found: $BUILD_ON_HOST_SRC" >&2
    exit 1
  fi
fi

ENV_B64=$(base64 <"$ENV_FILE" | tr -d '\n')
CADDY_B64=$(base64 <"$CADDYFILE" | tr -d '\n')
SCRIPT_B64=$(base64 <"$DEPLOY_SCRIPT_SRC" | tr -d '\n')
SETUP_CADDY_B64=$(base64 <"$SETUP_CADDY_SRC" | tr -d '\n')
HEARTBEAT_B64=$(base64 <"$HEARTBEAT_SRC" | tr -d '\n')

BASE_COMMANDS='
      "set -euo pipefail",
      "echo \"=== SSM deploy start $(date -u +%Y-%m-%dT%H:%M:%SZ) host=$(hostname) arch=$(uname -m) ===\"",
      "df -h /",
      "docker --version || true",
      "mkdir -p /opt/sopet /opt/sopet/logs",
      ("echo " + ($heartbeat_b64 | @json) + " | base64 -d > /opt/sopet/ssm-heartbeat.sh"),
      "chmod +x /opt/sopet/ssm-heartbeat.sh",
      ". /opt/sopet/ssm-heartbeat.sh",
      "ssm_heartbeat_start",
      "command -v git >/dev/null || (command -v dnf >/dev/null && dnf install -y git || (apt-get update -y && apt-get install -y git))",
      ("echo " + ($script_b64 | @json) + " | base64 -d > /opt/sopet/deploy.sh"),
      "chmod +x /opt/sopet/deploy.sh",
      ("echo " + ($setup_caddy_b64 | @json) + " | base64 -d > /opt/sopet/setup-caddy.sh"),
      "chmod +x /opt/sopet/setup-caddy.sh",
      ("echo " + ($env_b64 | @json) + " | base64 -d > /opt/sopet/.env"),
      "chmod 600 /opt/sopet/.env",
      ("echo " + ($caddy_b64 | @json) + " | base64 -d > /opt/sopet/Caddyfile"),
      "chmod 644 /opt/sopet/Caddyfile"
'

BUILD_COMMANDS='
      ,("echo " + ($build_b64 | @json) + " | base64 -d > /opt/sopet/build-on-host.sh"),
      "chmod +x /opt/sopet/build-on-host.sh",
      ("export IMAGE_URI=" + ($image | @sh)),
      ("export GIT_COMMIT=" + ($git_commit | @sh)),
      ("export GITHUB_REPOSITORY=" + ($github_repo | @sh)),
      ("export GITHUB_TOKEN=" + ($github_token | @sh)),
      "echo \"=== build-on-host begin $(date -u +%Y-%m-%dT%H:%M:%SZ) ===\"",
      "/opt/sopet/build-on-host.sh",
      "echo \"=== build-on-host end $(date -u +%Y-%m-%dT%H:%M:%SZ) ===\""
'

TAIL_COMMANDS='
      ,("export IMAGE_URI=" + ($image | @sh)),
      "export ENV_FILE=/opt/sopet/.env",
      ("export AWS_REGION=" + ($region | @sh)),
      "echo \"=== deploy.sh begin $(date -u +%Y-%m-%dT%H:%M:%SZ) ===\"",
      "/opt/sopet/deploy.sh",
      "echo \"=== setup-caddy begin $(date -u +%Y-%m-%dT%H:%M:%SZ) ===\"",
      "/opt/sopet/setup-caddy.sh",
      "echo \"=== SSM deploy complete $(date -u +%Y-%m-%dT%H:%M:%SZ) ===\"",
      "ssm_heartbeat_stop"
'

if [ "$BUILD_ON_HOST" = "true" ]; then
  BUILD_B64=$(base64 <"$BUILD_ON_HOST_SRC" | tr -d '\n')
  echo "Build on EC2 enabled (BUILD_ON_HOST=true escape hatch)"
  echo "SSM poll timeout: ${SSM_TIMEOUT_SECONDS}s | executionTimeout: ${SSM_EXECUTION_TIMEOUT_SECONDS}s | delivery: ${SSM_DELIVERY_TIMEOUT_SECONDS}s"
  PARAMS=$(jq -n \
    --arg env_b64 "$ENV_B64" \
    --arg caddy_b64 "$CADDY_B64" \
    --arg script_b64 "$SCRIPT_B64" \
    --arg setup_caddy_b64 "$SETUP_CADDY_B64" \
    --arg heartbeat_b64 "$HEARTBEAT_B64" \
    --arg build_b64 "$BUILD_B64" \
    --arg image "$IMAGE_URI" \
    --arg region "$AWS_REGION" \
    --arg git_commit "$GIT_COMMIT" \
    --arg github_repo "$GITHUB_REPOSITORY" \
    --arg github_token "$GITHUB_TOKEN" \
    --arg exec_timeout "$SSM_EXECUTION_TIMEOUT_SECONDS" \
    "{
      commands: [
        ${BASE_COMMANDS}
        ${BUILD_COMMANDS}
        ${TAIL_COMMANDS}
      ],
      executionTimeout: [\$exec_timeout]
    }")
else
  echo "SSM poll timeout: ${SSM_TIMEOUT_SECONDS}s | executionTimeout: ${SSM_EXECUTION_TIMEOUT_SECONDS}s | delivery: ${SSM_DELIVERY_TIMEOUT_SECONDS}s"
  PARAMS=$(jq -n \
    --arg env_b64 "$ENV_B64" \
    --arg caddy_b64 "$CADDY_B64" \
    --arg script_b64 "$SCRIPT_B64" \
    --arg setup_caddy_b64 "$SETUP_CADDY_B64" \
    --arg heartbeat_b64 "$HEARTBEAT_B64" \
    --arg image "$IMAGE_URI" \
    --arg region "$AWS_REGION" \
    --arg exec_timeout "$SSM_EXECUTION_TIMEOUT_SECONDS" \
    "{
      commands: [
        ${BASE_COMMANDS}
        ${TAIL_COMMANDS}
      ],
      executionTimeout: [\$exec_timeout]
    }")
fi

echo "Sending SSM deploy to $EC2_INSTANCE_ID (region $AWS_REGION)"

SEND_ARGS=(
  ssm send-command
  --region "$AWS_REGION"
  --instance-ids "$EC2_INSTANCE_ID"
  --document-name "AWS-RunShellScript"
  --timeout-seconds "$SSM_DELIVERY_TIMEOUT_SECONDS"
  --parameters "$PARAMS"
  --comment "sopet-backend deploy ${IMAGE_URI##*:}"
  --query 'Command.CommandId'
  --output text
)

if [ -n "$SSM_CLOUDWATCH_LOG_GROUP" ]; then
  echo "CloudWatch output enabled → log group: $SSM_CLOUDWATCH_LOG_GROUP"
  SEND_ARGS+=(
    --cloud-watch-output-config
    "CloudWatchLogGroupName=${SSM_CLOUDWATCH_LOG_GROUP},CloudWatchOutputEnabled=true"
  )
fi

COMMAND_ID=$(aws "${SEND_ARGS[@]}")

echo "SSM deploy command started: $COMMAND_ID"
echo "Inspect anytime:"
echo "  aws ssm get-command-invocation --command-id $COMMAND_ID --instance-id $EC2_INSTANCE_ID --region $AWS_REGION"
if [ -n "$SSM_CLOUDWATCH_LOG_GROUP" ]; then
  echo "  aws logs tail \"$SSM_CLOUDWATCH_LOG_GROUP\" --follow --region $AWS_REGION"
fi

print_invocation() {
  aws ssm get-command-invocation \
    --region "$AWS_REGION" \
    --command-id "$COMMAND_ID" \
    --instance-id "$EC2_INSTANCE_ID" \
    --output json
}

print_diagnostics() {
  echo "::group::SSM diagnostics for $COMMAND_ID" >&2
  echo "get-command-invocation:" >&2
  print_invocation >&2 || true
  echo "" >&2
  echo "Run these now (command may still be InProgress on the instance):" >&2
  echo "  aws ssm get-command-invocation --command-id $COMMAND_ID --instance-id $EC2_INSTANCE_ID --region $AWS_REGION" >&2
  echo "  aws ssm list-command-invocations --command-id $COMMAND_ID --details --region $AWS_REGION" >&2
  echo "  aws ssm describe-instance-information --filters Key=InstanceIds,Values=$EC2_INSTANCE_ID --region $AWS_REGION" >&2
  if [ -n "$SSM_CLOUDWATCH_LOG_GROUP" ]; then
    echo "  aws logs tail \"$SSM_CLOUDWATCH_LOG_GROUP\" --since 2h --region $AWS_REGION" >&2
  fi
  echo "On the instance (SSM Session Manager):" >&2
  echo "  sudo docker ps -a; df -h; free -h" >&2
  echo "  sudo journalctl -u amazon-ssm-agent -n 100 --no-pager" >&2
  echo "  sudo tail -n 200 /var/log/amazon/ssm/amazon-ssm-agent.log" >&2
  echo "  ps aux | grep -E 'docker|build-on-host|deploy.sh' | grep -v grep" >&2
  echo "::endgroup::" >&2
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
poll_count=0

while [ "$SECONDS" -lt "$deadline" ]; do
  STATUS=$(get_status || echo "Unknown")
  poll_count=$((poll_count + 1))
  elapsed=$((SECONDS))

  if [ "$STATUS" != "$last_status" ]; then
    echo "SSM status: $STATUS (elapsed: ${elapsed}s)"
    last_status="$STATUS"
  elif [ $((poll_count % HEARTBEAT_EVERY_POLLS)) -eq 0 ]; then
    # Status unchanged (usually InProgress) — still emit progress so GHA is not silent.
    echo "SSM still $STATUS (elapsed: ${elapsed}s / ${SSM_TIMEOUT_SECONDS}s, command: $COMMAND_ID)"
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
      print_diagnostics
      aws ssm get-command-invocation \
        --region "$AWS_REGION" \
        --command-id "$COMMAND_ID" \
        --instance-id "$EC2_INSTANCE_ID" \
        --query 'StandardErrorContent' \
        --output text >&2 || true
      exit 1
      ;;
    *)
      sleep "$POLL_INTERVAL_SECONDS"
      ;;
  esac
done

echo "::error::Timed out after ${SSM_TIMEOUT_SECONDS}s waiting for SSM command $COMMAND_ID" >&2
echo "::error::Status was still '${last_status:-unknown}'. Empty stdout/stderr while InProgress is normal without CloudWatch — the EC2 command may still be running (docker build)." >&2
print_diagnostics

# Best-effort cancel so the next deploy does not pile onto a stuck shell.
if aws ssm cancel-command \
  --region "$AWS_REGION" \
  --command-id "$COMMAND_ID" \
  --instance-ids "$EC2_INSTANCE_ID" 2>/dev/null; then
  echo "Requested SSM cancel for $COMMAND_ID (agent may take a moment to stop)." >&2
else
  echo "::warning::Could not cancel SSM command (need ssm:CancelCommand on deploy role)." >&2
fi

exit 1
