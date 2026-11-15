#!/bin/sh
# Copies the app's PUBLIC build-time settings into Expo's EAS environment
# variables, so cloud builds get the same values as `expo start` does from
# .env.local (which EAS never sees: it is git-ignored).
#
#   ./scripts/set-eas-env.sh            # reads ./.env.local
#
# Only EXPO_PUBLIC_* values go here. They are compiled into the app and are
# public by design: the Supabase anon key is not a secret (Row Level Security
# is the boundary). NEVER put a service-role key or any other secret in one.
# This sends the values to Expo's servers, so run it deliberately.
set -eu

FILE="${1:-.env.local}"
[ -f "$FILE" ] || { echo "Missing $FILE (copy .env.example and fill it in)" >&2; exit 1; }

for NAME in EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY; do
  VALUE=$(grep "^$NAME=" "$FILE" | head -1 | cut -d= -f2-)
  [ -n "$VALUE" ] || { echo "$NAME is empty in $FILE" >&2; exit 1; }
  # env:set creates or updates, so this is safe to re-run.
  npx eas-cli@latest env:set --name "$NAME" --value "$VALUE" \
    --environment preview --environment production \
    --visibility plaintext --non-interactive
done
echo "Done. EXPO_PUBLIC_API_BASE_URL is set per profile in eas.json."
