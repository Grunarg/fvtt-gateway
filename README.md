# fvtt-gateway

Ein FoundryVTT Desktop Client, optimiert für CachyOS/Linux (Wayland, AMD, PipeWire).

Basiert auf [OmegaRogue/fvtt-player-client](https://github.com/OmegaRogue/fvtt-player-client),
welches selbst ein Fork von [theripper93/fvtt-player-client](https://github.com/theripper93/fvtt-player-client) ist.

## Änderungen gegenüber dem Original

- Electron 36 / Chromium 132 (Original: Electron 29 / Chromium 122)
- Wayland-native (KDE Plasma 6 / KWin, kein XWayland)
- AMD VA-API Hardware-Dekodierung (RADV/radeonsi)
- PipeWire WebRTC-Integration für LiveKit PTT
- PipeWire Quantum-Steuerung direkt im Menü
- Auto-Login Fix für Foundry V13 (neue DOM-Struktur)
- Tastaturlayout-Einstellung (QWERTZ/QWERTY/AZERTY)
- Lobby-Musik
- Bugfix: Crash beim Beenden

## Installation

```bash
yarn install
./launch-cachy.sh
```

## Tastenkürzel

| Kürzel | Aktion |
|--------|--------|
| F5 | Neu laden |
| Shift+F5 | Hard Reload |
| F11 | Vollbild |
| F12 | DevTools |
| Ctrl+Q | Beenden |

LICENSE:
MIT License

Copyright (c) theripper93
Copyright (c) OmegaRogue <omegarogue@omegavoid.codes>
Copyright (c) 2025 grunarg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
