#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  printf 'Usage: %s <data.tar.gz> <code.tar.gz> [data-sha256] [code-sha256]\n' "$0" >&2
  exit 2
fi

data_archive="$1"
code_archive="$2"
expected_data_sha="${3:-}"
expected_code_sha="${4:-}"

actual_data_sha="$(sha256sum "$data_archive" | awk '{ print $1 }')"
actual_code_sha="$(sha256sum "$code_archive" | awk '{ print $1 }')"
if [[ -n "$expected_data_sha" ]]; then
  [[ "$actual_data_sha" == "$expected_data_sha" ]]
fi
if [[ -n "$expected_code_sha" ]]; then
  [[ "$actual_code_sha" == "$expected_code_sha" ]]
fi

release_id="$(date -u +%Y%m%d-%H%M%S)-${actual_code_sha:0:12}"
release_dir="/opt/gupiaomoniqi/releases/$release_id"
data_stage="/var/lib/gupiaomoniqi/.import-$release_id"

install -d -m 0755 -o root -g root "$release_dir"
tar -xzf "$code_archive" -C "$release_dir"

cd "$release_dir"
npm ci --omit=dev --no-audit --no-fund

install -d -m 0750 -o gupiaomoniqi -g gupiaomoniqi "$data_stage"
tar -xzf "$data_archive" -C "$data_stage"

test -f "$data_stage/pgdata/PG_VERSION"
test -f "$data_stage/real-pgdata/PG_VERSION"
chown -R gupiaomoniqi:gupiaomoniqi "$data_stage"

backup_id="$(date -u +%Y%m%d-%H%M%S)"
if [[ -e /var/lib/gupiaomoniqi/pgdata ]]; then
  mv \
    /var/lib/gupiaomoniqi/pgdata \
    "/var/lib/gupiaomoniqi/pgdata.backup-$backup_id"
fi
if [[ -e /var/lib/gupiaomoniqi/real-pgdata ]]; then
  mv \
    /var/lib/gupiaomoniqi/real-pgdata \
    "/var/lib/gupiaomoniqi/real-pgdata.backup-$backup_id"
fi

mv "$data_stage/pgdata" /var/lib/gupiaomoniqi/pgdata
mv "$data_stage/real-pgdata" /var/lib/gupiaomoniqi/real-pgdata
rmdir "$data_stage"

ln -sfn "$release_dir" /opt/gupiaomoniqi/current

printf 'RELEASE_ID=%s\n' "$release_id"
du -sh /var/lib/gupiaomoniqi/pgdata
du -sh /var/lib/gupiaomoniqi/real-pgdata
