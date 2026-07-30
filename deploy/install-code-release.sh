#!/usr/bin/env bash
set -euo pipefail

code_archive="${1:-/tmp/gupiaomoniqi-deploy/code.tar.gz}"
expected_code_sha="${2:-}"

actual_code_sha="$(sha256sum "$code_archive" | awk '{ print $1 }')"
if [[ -n "$expected_code_sha" ]]; then
  [[ "$actual_code_sha" == "$expected_code_sha" ]]
fi

release_id="$(date -u +%Y%m%d-%H%M%S)-${actual_code_sha:0:12}"
release_dir="/opt/gupiaomoniqi/releases/$release_id"

install -d -m 0755 -o root -g root "$release_dir"
tar -xzf "$code_archive" -C "$release_dir"

cd "$release_dir"
npm ci --omit=dev --no-audit --no-fund

test -f "$release_dir/server/dist/index.js"
test -f "$release_dir/web/dist/index.html"
test -f /var/lib/gupiaomoniqi/pgdata/PG_VERSION
test -f /var/lib/gupiaomoniqi/real-pgdata/PG_VERSION

ln -sfn "$release_dir" /opt/gupiaomoniqi/current
systemctl restart gupiaomoniqi

health_code="000"
for _ in $(seq 1 60); do
  health_code="$(
    curl \
      -sS \
      -o /dev/null \
      -w "%{http_code}" \
      http://127.0.0.1:3100/api/health || true
  )"
  if [[ "$health_code" == "200" ]]; then
    break
  fi
  sleep 2
done
[[ "$health_code" == "200" ]]

printf 'RELEASE_ID=%s\n' "$release_id"
printf 'CODE_SHA=%s\n' "$actual_code_sha"
printf 'HEALTH=%s\n' "$health_code"
