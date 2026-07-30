#!/usr/bin/env bash
set -euo pipefail

public_host="${PUBLIC_HOST:-${1:-}}"
certificate="/etc/ssl/gupiaomoniqi/selfsigned.crt"

if [[ -z "$public_host" ]]; then
  printf 'Usage: PUBLIC_HOST=example.com %s\n' "$0" >&2
  printf '   or: %s <public-ip-or-domain>\n' "$0" >&2
  exit 2
fi

http_code="$(
  curl \
    -sS \
    -o /dev/null \
    -w "%{http_code}" \
    -H "Host: $public_host" \
    http://127.0.0.1/
)"
redirect_url="$(
  curl \
    -sS \
    -o /dev/null \
    -w "%{redirect_url}" \
    -H "Host: $public_host" \
    http://127.0.0.1/
)"
https_root_code="$(
  curl \
    -ksS \
    -o /dev/null \
    -w "%{http_code}" \
    -H "Host: $public_host" \
    https://127.0.0.1/
)"
https_health_code="$(
  curl \
    -ksS \
    -o /dev/null \
    -w "%{http_code}" \
    -H "Host: $public_host" \
    https://127.0.0.1/api/health
)"

[[ "$http_code" == "301" ]]
[[ "$redirect_url" == "https://$public_host/" ]]
[[ "$https_root_code" == "200" ]]
[[ "$https_health_code" == "200" ]]

certificate_details="$(
  openssl x509 \
    -in "$certificate" \
    -noout \
    -subject \
    -issuer \
    -dates \
    -ext subjectAltName
)"
if [[ "$public_host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  grep -Fq "IP Address:$public_host" <<<"$certificate_details"
else
  grep -Fq "DNS:$public_host" <<<"$certificate_details"
fi

printf 'ROUTING\n'
printf 'http=%s redirect=%s\n' "$http_code" "$redirect_url"
printf 'https_root=%s https_health=%s\n' \
  "$https_root_code" \
  "$https_health_code"
printf 'CERTIFICATE\n%s\n' "$certificate_details"
printf 'SERVICES\n'
systemctl is-active gupiaomoniqi nginx
systemctl is-enabled gupiaomoniqi nginx
printf 'PORTS\n'
ss -lntp | grep -E ':(80|443|3100)[[:space:]]'
printf 'FIREWALL\n'
ufw status
printf 'WARNINGS\n'
journalctl \
  -u gupiaomoniqi \
  --since "30 minutes ago" \
  -p warning \
  --no-pager
