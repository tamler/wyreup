#!/usr/bin/env bash
# Push every secret currently set in .dev.vars to the production CF Pages
# project. Skips empty values (so you can re-run as you fill more in).
#
# Values flow stdin → wrangler so they don't show up in process listings.
# Re-running is safe: wrangler upserts.
#
# Requires: wrangler logged in (`wrangler whoami`).

set -euo pipefail
cd "$(dirname "$0")/.."

DEV_VARS="${DEV_VARS:-.dev.vars}"
PROJECT="${PROJECT:-wyreup}"

if [[ ! -f "$DEV_VARS" ]]; then
  echo "error: $DEV_VARS not found" >&2
  exit 1
fi

# Names we manage as Pages secrets (in push order). SESSION_SECRET is
# included so a regen propagates with the same script.
SECRETS=(
  SESSION_SECRET
  LS_WEBHOOK_SECRET
  LS_VARIANT_STARTER
  LS_VARIANT_STANDARD
  LS_VARIANT_POWER
  LS_VARIANT_MONTHLY
  ZEPTOMAIL_TOKEN
  ZEPTOMAIL_SENDER
  ZEPTOMAIL_SENDER_NAME
  IMAGE_MODEL_TOKEN
  ADMIN_EMAILS
)

# Read KEY="value" lines from .dev.vars into an associative-style lookup.
# Avoids `source <(...)` which is unreliable on macOS bash 3.2.
read_var() {
  # $1 = key name. Echoes the value (no surrounding quotes) or nothing.
  local key="$1"
  awk -v k="$key" '
    $0 ~ "^" k "=\"" {
      sub("^" k "=\"", "", $0);
      sub("\"$", "", $0);
      print;
      exit;
    }
  ' "$DEV_VARS"
}

PADDLE_NAMES=(
  PADDLE_API_KEY PADDLE_CLIENT_TOKEN PADDLE_WEBHOOK_SECRET
  PADDLE_PRICE_STARTER PADDLE_PRICE_STANDARD PADDLE_PRICE_POWER PADDLE_PRICE_MONTHLY
  APP_ORIGIN PADDLE_ENVIRONMENT
)

paddle_present=false
for name in "${PADDLE_NAMES[@]}"; do
  if [[ "$name" != APP_ORIGIN && -n "$(read_var "$name")" ]]; then
    paddle_present=true
    break
  fi
done
if [[ "$paddle_present" == true ]]; then
  if [[ "$PROJECT" != wyreup || "$(read_var APP_ORIGIN)" != https://wyreup.com
      || "$(read_var PADDLE_ENVIRONMENT)" != live
      || "$(read_var PADDLE_API_KEY)" != pdl_live_apikey_*
      || "$(read_var PADDLE_CLIENT_TOKEN)" != live_* ]]; then
    echo "error: this helper only accepts live Paddle settings for the canonical production project" >&2
    exit 1
  fi
  for name in "${PADDLE_NAMES[@]}"; do
    if [[ -z "$(read_var "$name")" ]]; then
      echo "error: missing $name" >&2
      exit 1
    fi
  done
  SECRETS+=("${PADDLE_NAMES[@]}")
fi

PUSHED=0
SKIPPED=0
for name in "${SECRETS[@]}"; do
  value="$(read_var "$name")"
  if [[ -z "$value" ]]; then
    echo "  skip   $name (empty in $DEV_VARS)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  printf "  push   %s … " "$name"
  if printf '%s' "$value" | pnpm wrangler pages secret put "$name" --project-name="$PROJECT" >/dev/null 2>&1; then
    echo "ok"
    PUSHED=$((PUSHED + 1))
  else
    echo "FAILED"
    exit 1
  fi
done

echo ""
echo "Pushed $PUSHED secrets to '$PROJECT' production. Skipped $SKIPPED (empty)."
