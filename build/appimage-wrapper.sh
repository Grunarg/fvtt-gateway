#!/usr/bin/env bash
export ELECTRON_OZONE_PLATFORM_HINT=wayland
export LIBVA_DRIVER_NAME=radeonsi
exec "$(dirname "$0")/fvtt-gateway" --no-sandbox --disable-gpu-sandbox "$@"
