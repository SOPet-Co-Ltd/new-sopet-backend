#!/usr/bin/env bash
# Build a dotenv file from GitHub Environment variables/secrets and env.manifest.json.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/env.manifest.json"
OUTPUT="${1:-.env.deploy}"

: >"$OUTPUT"

write_entry() {
  local name="$1"
  local value="${!name:-}"
  if [ -n "$value" ]; then
    printf '%s=%s\n' "$name" "$value" >>"$OUTPUT"
  fi
}

while IFS= read -r name; do
  [ -z "$name" ] && continue
  write_entry "$name"
done < <(jq -r '.variables[], .secrets[]' "$MANIFEST")

if [ ! -s "$OUTPUT" ]; then
  echo "::error::No application environment variables were set. Configure GitHub Environment variables/secrets (see infra/env.manifest.json)." >&2
  exit 1
fi

chmod 600 "$OUTPUT"
echo "Wrote $OUTPUT with $(wc -l <"$OUTPUT" | tr -d ' ') environment variables"
