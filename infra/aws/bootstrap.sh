#!/bin/bash
# Bootstraps the dedicated Dalgo Codebox AMD64/ARM64 host. No credentials belong in user data.
set -euo pipefail
umask 077
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
architecture="$(dpkg --print-architecture)"
case "$architecture" in
  amd64|arm64) ;;
  *) echo "Unsupported architecture: $architecture"; exit 1 ;;
esac
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 24.04 ] || {
  echo 'Expected Ubuntu 24.04'; exit 1;
}
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable\n' "$architecture" > /etc/apt/sources.list.d/docker.list
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /etc/apt/keyrings/cloudflare.gpg
chmod a+r /etc/apt/keyrings/cloudflare.gpg
printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/cloudflare.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin cloudflared
systemctl enable --now docker
install -d -m 0700 /opt/dalgo-codebox
printf '%s\n' 'Dalgo Codebox host bootstrap completed.'
touch /var/lib/dalgo-bootstrap-complete
