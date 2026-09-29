#!/usr/bin/env bash
# Idempotent host setup for the API server: SSD swapfile, sysctl, and the systemd resource
# budget. Run as: sudo bash setup-host.sh [swap size, default 1G]
set -euo pipefail
SIZE="${1:-1G}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  if [ ! -f /swapfile ]; then
    fallocate -l "$SIZE" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count="$(( ${SIZE%G} * 1024 ))" status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

install -m 644 "$HERE/99-pytorch-ph.conf" /etc/sysctl.d/99-pytorch-ph.conf
sysctl --quiet --load /etc/sysctl.d/99-pytorch-ph.conf

install -d /etc/systemd/system/pytorch-ph-api.service.d
install -m 644 "$HERE/pytorch-ph-api.resources.conf" /etc/systemd/system/pytorch-ph-api.service.d/resources.conf
systemctl daemon-reload

echo "{\"event\":\"host.setup\",\"swap\":\"$(swapon --show=SIZE --noheadings | head -1 | tr -d ' ')\",\"swappiness\":$(sysctl -n vm.swappiness)}"
