const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
    const appOutDir = context.appOutDir;
    const exePath = path.join(appOutDir, 'fvtt-gateway');

    // Original umbenennen
    fs.renameSync(exePath, exePath + '.bin');

    // Wrapper-Script erstellen
    fs.writeFileSync(exePath, `#!/bin/bash
    export ELECTRON_OZONE_PLATFORM_HINT=wayland
    export LIBVA_DRIVER_NAME=radeonsi
    exec "$(dirname "$0")/fvtt-gateway.bin" --no-sandbox "$@"
    `);
    fs.chmodSync(exePath, '755');
};
