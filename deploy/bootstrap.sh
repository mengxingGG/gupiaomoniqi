#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y nginx curl ca-certificates python3 xz-utils

download_dir="/opt/nodejs-download"
install -d -m 0755 "$download_dir"
cd "$download_dir"

curl -fsSLo SHASUMS256.txt \
  "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt"
archive="$(
  awk '/linux-x64\.tar\.xz$/ { print $2; exit }' SHASUMS256.txt
)"
test -n "$archive"

curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$archive"
grep "  $archive$" SHASUMS256.txt | sha256sum -c -

node_dir="${archive%.tar.xz}"
if [[ ! -x "/opt/$node_dir/bin/node" ]]; then
  tar -xJf "$archive" -C /opt
fi

ln -sfn "/opt/$node_dir/bin/node" /usr/local/bin/node
ln -sfn "/opt/$node_dir/bin/npm" /usr/local/bin/npm
ln -sfn "/opt/$node_dir/bin/npx" /usr/local/bin/npx

if ! id -u gupiaomoniqi >/dev/null 2>&1; then
  useradd \
    --system \
    --home-dir /var/lib/gupiaomoniqi \
    --shell /usr/sbin/nologin \
    gupiaomoniqi
fi

install -d -m 0755 -o root -g root /opt/gupiaomoniqi
install -d -m 0755 -o root -g root /opt/gupiaomoniqi/releases
install -d -m 0750 -o gupiaomoniqi -g gupiaomoniqi \
  /var/lib/gupiaomoniqi

node --version
npm --version
nginx -v
