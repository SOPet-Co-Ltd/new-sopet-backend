#!/usr/bin/env bash
# Export GitHub Environment values (step env) into GITHUB_ENV for later steps.
# Environment-scoped vars/secrets must be mapped on the step, not at job level.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYS_FILE="$SCRIPT_DIR/github-env.keys"

while IFS= read -r key; do
  [ -z "$key" ] && continue
  [[ "$key" =~ ^# ]] && continue

  value="${!key:-}"
  if [ -z "$value" ]; then
    continue
  fi

  delimiter="GITHUB_ENV_$(openssl rand -hex 8)"
  {
    echo "$key<<$delimiter"
    printf '%s\n' "$value"
    echo "$delimiter"
  } >> "$GITHUB_ENV"
done < "$KEYS_FILE"

echo "Loaded GitHub Environment keys into the workflow runner."
