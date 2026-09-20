#!/bin/sh
# Bootstrap the dedicated Dalgo Codebox VM on Ubuntu 24.04 ARM64.
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo'; exit 1; }
[ "$(uname -m)" = aarch64 ] || { echo 'Expected an ARM64 T2A server'; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 24.04 ] || { echo 'Expected Ubuntu 24.04'; exit 1; }
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
printf '%s\n' 'deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable' > /etc/apt/sources.list.d/docker.list
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /etc/apt/keyrings/cloudflare.gpg
printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/cloudflare.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin cloudflared
systemctl enable --now docker
install -d -m 0700 /opt/dalgo-codebox
printf '%s\n' 'Docker and cloudflared installed. The Codebox API remains bound to loopback.'
touch /var/lib/dalgo-bootstrap-complete
