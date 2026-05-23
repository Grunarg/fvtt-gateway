# fvtt-gateway

A FoundryVTT Desktop Client optimized for Linux (Wayland, AMD, PipeWire).

Based on [OmegaRogue/fvtt-player-client](https://github.com/OmegaRogue/fvtt-player-client),
which itself is a fork of [theripper93/fvtt-player-client](https://github.com/theripper93/fvtt-player-client).

## Features

- **Discord Integration** – embedded Discord panel with resizable splitter, microphone and camera support
- **Wayland-native** – KDE Plasma 6 / KWin, no XWayland
- **AMD GPU** – VA-API hardware decoding (RADV/radeonsi)
- **PipeWire** – WebRTC integration for LiveKit PTT, quantum control via menu
- **Auto-Login** – per server, compatible with Foundry V13
- **Multi-Server** – manage multiple FoundryVTT servers with saved credentials
- **Lobby Music** – playlist support while on the server selection screen
- **Keyboard Layout** – QWERTZ/QWERTY/AZERTY support

## Installation

### AppImage (recommended)
1. Download `fvtt-gateway-2.1.1.AppImage` from [Releases](https://github.com/Grunarg/fvtt-gateway/releases/latest)
2. `chmod +x fvtt-gateway-2.1.1.AppImage`
3. Double-click to launch

### From Source
```bash
yarn install
yarn start
```

## Requirements

- Linux with Wayland (KDE Plasma 6 recommended)
- AMD GPU with RADV driver
- PipeWire

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+D | Toggle Discord panel |
| F5 | Reload |
| Shift+F5 | Hard Reload |
| F11 | Fullscreen |
| F12 | DevTools |
| Ctrl+Q | Quit |

## Attribution

Based on [OmegaRogue/fvtt-player-client](https://github.com/OmegaRogue/fvtt-player-client)
and [theripper93/fvtt-player-client](https://github.com/theripper93/fvtt-player-client).
