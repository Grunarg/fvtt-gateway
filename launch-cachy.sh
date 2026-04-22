#!/usr/bin/env bash
# fvtt-gateway – Linux Launch-Script
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export ELECTRON_OZONE_PLATFORM_HINT=wayland
export LIBVA_DRIVER_NAME=radeonsi
export PIPEWIRE_LATENCY="${PIPEWIRE_LATENCY:-256/48000}"

if [[ "${1:-}" == "--check" ]]; then
  echo "=== fvtt-cachy-client – Systemcheck ==="
  echo "Wayland:  ${WAYLAND_DISPLAY:-nicht gesetzt}"
  echo "PipeWire: $(pactl info 2>/dev/null | grep 'Server Name' || echo 'nicht aktiv')"
  echo "VA-API:   $(vainfo 2>/dev/null | head -1 || echo 'nicht verfügbar')"
  echo "Node:     $(node --version 2>/dev/null || echo 'nicht installiert')"
  echo ""
fi

cd "$SCRIPT_DIR"

if command -v yarn &>/dev/null; then
  exec yarn start
elif command -v npx &>/dev/null; then
  exec npx electron-forge start
else
  echo "Fehler: yarn oder npx nicht gefunden."
  echo "  sudo pacman -S nodejs npm && npm install -g yarn"
  exit 1
fi
