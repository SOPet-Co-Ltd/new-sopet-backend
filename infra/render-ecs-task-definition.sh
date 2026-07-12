#!/usr/bin/env bash
# Build an ECS task definition JSON from GitHub Environment variables/secrets
# exported into the shell and infra/env.manifest.json.
#
# Required shell env (deploy infrastructure — GitHub Variables):
#   ECS_TASK_DEFINITION_FAMILY, ECS_CONTAINER_NAME, ECS_EXECUTION_ROLE_ARN,
#   ECS_TASK_ROLE_ARN, ECS_LOG_GROUP, CONTAINER_IMAGE, AWS_REGION
# Optional: ECS_CPU (default 512), ECS_MEMORY (default 1024)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$SCRIPT_DIR/env.manifest.json"
BASE="$REPO_ROOT/ecs/task-definition.base.json"
OUTPUT="${1:-task-definition.json}"

: "${ECS_TASK_DEFINITION_FAMILY:?ECS_TASK_DEFINITION_FAMILY is required}"
: "${ECS_CONTAINER_NAME:?ECS_CONTAINER_NAME is required}"
: "${ECS_EXECUTION_ROLE_ARN:?ECS_EXECUTION_ROLE_ARN is required}"
: "${ECS_TASK_ROLE_ARN:?ECS_TASK_ROLE_ARN is required}"
: "${ECS_LOG_GROUP:?ECS_LOG_GROUP is required}"
: "${CONTAINER_IMAGE:?CONTAINER_IMAGE is required}"

ECS_CPU="${ECS_CPU:-512}"
ECS_MEMORY="${ECS_MEMORY:-1024}"
AWS_REGION="${AWS_REGION:-ap-southeast-7}"

ENV_ENTRIES=()
while IFS= read -r name; do
  [ -z "$name" ] && continue
  value="${!name:-}"
  if [ -n "$value" ]; then
    ENV_ENTRIES+=("$(jq -n --arg name "$name" --arg value "$value" '{name: $name, value: $value}')")
  fi
done < <(jq -r '.variables[], .secrets[]' "$MANIFEST")

if [ "${#ENV_ENTRIES[@]}" -eq 0 ]; then
  echo "::error::No application environment variables were set. Configure GitHub Environment variables/secrets (see infra/env.manifest.json)." >&2
  exit 1
fi

ENV_JSON=$(printf '%s\n' "${ENV_ENTRIES[@]}" | jq -s '.')

jq \
  --arg family "$ECS_TASK_DEFINITION_FAMILY" \
  --arg cpu "$ECS_CPU" \
  --arg memory "$ECS_MEMORY" \
  --arg executionRoleArn "$ECS_EXECUTION_ROLE_ARN" \
  --arg taskRoleArn "$ECS_TASK_ROLE_ARN" \
  --arg containerName "$ECS_CONTAINER_NAME" \
  --arg image "$CONTAINER_IMAGE" \
  --arg logGroup "$ECS_LOG_GROUP" \
  --arg awsRegion "$AWS_REGION" \
  --argjson environment "$ENV_JSON" \
  '
  .family = $family
  | .cpu = $cpu
  | .memory = $memory
  | .executionRoleArn = $executionRoleArn
  | .taskRoleArn = $taskRoleArn
  | .containerDefinitions[0].name = $containerName
  | .containerDefinitions[0].image = $image
  | .containerDefinitions[0].environment = $environment
  | .containerDefinitions[0].logConfiguration.options["awslogs-group"] = $logGroup
  | .containerDefinitions[0].logConfiguration.options["awslogs-region"] = $awsRegion
  ' "$BASE" > "$OUTPUT"

echo "Wrote $OUTPUT with ${#ENV_ENTRIES[@]} environment variables"
