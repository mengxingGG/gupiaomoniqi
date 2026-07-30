#!/usr/bin/env bash
set -euo pipefail

deploy_dir="/tmp/gupiaomoniqi-deploy"
certificate_dir="/etc/ssl/gupiaomoniqi"
public_host="${PUBLIC_HOST:-${1:-}}"

if [[ -z "$public_host" ]]; then
  printf 'Usage: PUBLIC_HOST=example.com %s\n' "$0" >&2
  printf '   or: %s <public-ip-or-domain>\n' "$0" >&2
  exit 2
fi

if [[ "$public_host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  certificate_san="IP:$public_host"
  certificate_match="IP Address:$public_host"
else
  certificate_san="DNS:$public_host"
  certificate_match="DNS:$public_host"
fi

install -d -m 0700 -o root -g root "$certificate_dir"
if [[ ! -s "$certificate_dir/selfsigned.crt" ]] ||
   [[ ! -s "$certificate_dir/selfsigned.key" ]] ||
   ! openssl x509 \
     -in "$certificate_dir/selfsigned.crt" \
     -noout \
     -ext subjectAltName 2>/dev/null |
     grep -Fq "$certificate_match"; then
  openssl req \
    -x509 \
    -nodes \
    -newkey rsa:3072 \
    -sha256 \
    -days 825 \
    -subj "/CN=$public_host" \
    -addext "subjectAltName=$certificate_san" \
    -keyout "$certificate_dir/selfsigned.key" \
    -out "$certificate_dir/selfsigned.crt"
fi
chmod 0600 "$certificate_dir/selfsigned.key"
chmod 0644 "$certificate_dir/selfsigned.crt"

install \
  -m 0644 \
  "$deploy_dir/gupiaomoniqi.service" \
  /etc/systemd/system/gupiaomoniqi.service
install \
  -m 0644 \
  "$deploy_dir/nginx-gupiaomoniqi.conf" \
  /etc/nginx/sites-available/gupiaomoniqi

install -d -m 0755 -o root -g root /etc/nginx/sites-disabled
for default_site in \
  /etc/nginx/sites-enabled/default \
  /etc/nginx/sites-enabled/default.disabled-*; do
  if [[ -e "$default_site" ]] || [[ -L "$default_site" ]]; then
    mv \
      "$default_site" \
      "/etc/nginx/sites-disabled/$(basename "$default_site").$(date -u +%Y%m%d-%H%M%S)"
  fi
done
ln -sfn \
  /etc/nginx/sites-available/gupiaomoniqi \
  /etc/nginx/sites-enabled/gupiaomoniqi

nginx -t
systemctl daemon-reload
systemctl enable gupiaomoniqi
systemctl restart gupiaomoniqi
systemctl restart nginx

if ufw status | grep -q '^Status: active'; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi

systemctl --no-pager --full status gupiaomoniqi
systemctl --no-pager --full status nginx
