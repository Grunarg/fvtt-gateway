// fvtt-cachy-client – Main Process
// Fixes: #7 (AZERTY), #8 (Auto-Login V12/V13), #13 (Chromium zu alt → Electron 36)
//        #14 (Version-Check gegen eigenes Repo), GPU-Acceleration auf Wayland/AMD

import { app, BrowserWindow, ipcMain, safeStorage, session, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

if (require('electron-squirrel-startup')) app.quit();

// ─── CachyOS / Wayland / AMD / PipeWire ──────────────────────────────────────
// Alle Switches müssen VOR app.whenReady() gesetzt werden.

// Wayland-native – KDE Plasma 6 / KWin ohne XWayland
// Electron 36+ erkennt Wayland automatisch; expliziter Switch als harter Override
app.commandLine.appendSwitch('ozone-platform', 'wayland');

app.commandLine.appendSwitch('enable-features', [
  'SharedArrayBuffer',         // Foundry benötigt SharedArrayBuffer
  'WaylandWindowDecorations',  // Native KWin-Dekorationen
  'UseOzonePlatform',
  'VaapiVideoDecodeLinuxGL',   // AMD VA-API Hardware-Dekodierung (RADV/radeonsi)
  'VaapiVideoEncoder',
  'WebGPU',                    // PIXI.js v8+ / zukünftige Foundry-Versionen
  'WebRTCPipeWireCapturer',    // LiveKit PipeWire-nativ (PTT)
  'CanvasOopRasterization',
].join(','));

app.commandLine.appendSwitch('disable-features', [
  'UseChromeOSDirectVideoDecoder',  // Nicht auf Desktop-Linux nötig
].join(','));

// GPU-Beschleunigung – AMD/RADV auf Wayland
// ignore-gpu-blocklist: Chromiums interne Linux-Sperrliste umgehen
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
// disable-gpu-sandbox + in-process-gpu: Zuverlässige WebGL-Init auf Wayland/Ozone
// Ohne diese Flags meldet Foundry "hardware acceleration disabled"
app.commandLine.appendSwitch('disable-gpu-sandbox');
//app.commandLine.appendSwitch('in-process-gpu');

// Hohe Performance GPU bevorzugen (AMD Dedicated statt iGPU)
app.commandLine.appendSwitch('force_high_performance_gpu');

// WebRTC / PipeWire – LiveKit PTT Qualität
// RED = Redundant Encoding: bessere PTT-Qualität bei Paketverlust
app.commandLine.appendSwitch('force-fieldtrials',
  'WebRTC-Audio-Red-For-Opus/Enabled/WebRTC-Audio-OpusMinPacketLossRate/Enabled-1/');

// V8 – 4 GB JS-Heap für große Foundry-Welten mit vielen Modulen
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096 --turbofan');

// Kein FPS-Drop wenn das Fenster kurz den Fokus verliert (z.B. beim Würfeln)
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ─── Singleton ────────────────────────────────────────────────────────────────
const isSingleInstance = app.requestSingleInstanceLock();
if (!isSingleInstance) { app.quit(); }

// ─── Config / UserData ────────────────────────────────────────────────────────

const USER_DATA_FILE = () => path.join(app.getPath('userData'), 'userData.json');
const APP_CONFIG_FILE = () => path.join(app.getAppPath(), 'config.json');

function readUserData(): UserData {
  try {
    return JSON.parse(fs.readFileSync(USER_DATA_FILE()).toString());
  } catch { return {}; }
}

function writeUserData(data: UserData): void {
  fs.writeFileSync(USER_DATA_FILE(), JSON.stringify(data, null, 2));
}

function readAppConfig(): AppConfig {
  const defaults: AppConfig = {
    games: [],
    backgroundColor: '#1a1a2e',
    textColor: '#e8e0c8',
    accentColor: '#c8a84b',
    keyboardLayout: 'qwertz',
    lobbyMusicVolume: 0.4,
  };
  try {
    const file = JSON.parse(fs.readFileSync(APP_CONFIG_FILE()).toString()) as Partial<AppConfig>;
    const userData = readUserData();
    const userApp = (userData.app ?? {}) as Partial<AppConfig>;
    // Merge: defaults ← config.json ← userData.app (user overrides win)
    return {
      ...defaults,
      ...file,
      ...userApp,
      games: [
        ...(file.games ?? []),
        ...(userApp.games ?? []),
      ],
    };
  } catch { return defaults; }
}

// Cache-Pfad aus userData anwenden (vor app.ready)
{
  const ud = readUserData();
  if (ud.cachePath && typeof ud.cachePath === 'string') {
    app.setPath('sessionData', ud.cachePath);
  }
}

// ─── Login-Details ────────────────────────────────────────────────────────────

function getLoginDetails(gameId: GameId): GameUserDataDecrypted {
  const ud = readUserData();
  const entry = ud[gameId as string] as GameUserData | undefined;
  if (!entry) return { user: '', password: '', adminPassword: '' };  // ← nur auf entry prüfen

  const dec = (arr: number[]): string => {
    if (!arr?.length) return '';
    if (!safeStorage.isEncryptionAvailable()) return '';
    try { return safeStorage.decryptString(Buffer.from(new Uint8Array(arr))); }
    catch { return ''; }
  };

  return {
    user: entry.user ?? '',
    password: dec(entry.password ?? []),
    adminPassword: dec(entry.adminPassword ?? []),
  };
}

function saveLoginDetails(gameId: GameId, user: string, password: string, adminPassword: string): void {
  const ud = readUserData();
  const existing = ud[gameId as string] as GameUserData | undefined;

  const enc = (s: string, fallback: number[]): number[] => {
    if (!s) return fallback ?? [];
    if (!safeStorage.isEncryptionAvailable()) return [];
    return Array.from(safeStorage.encryptString(s));
  };

  ud[gameId as string] = {
    user: user || existing?.user || '',
    password: enc(password, existing?.password ?? []),
    adminPassword: enc(adminPassword, existing?.adminPassword ?? []),
  };
  writeUserData(ud);
}

// ─── Fenster-Management ───────────────────────────────────────────────────────

const windowsData: WindowsData = {};
let partitionCounter = 0;

function getSession(): Electron.Session {
  const id = partitionCounter++;
  if (id === 0) return session.defaultSession;
  return session.fromPartition(`persist:${id}`, { cache: true });
}

function rendererPath(): string {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) return MAIN_WINDOW_VITE_DEV_SERVER_URL;
  return path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
}

function createGameWindow(): BrowserWindow {
  const localSession = getSession();

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webgl: true,
      session: localSession,
      backgroundThrottling: false,
    },
  });

  // User-Agent: "Electron" entfernen → Foundry akzeptiert den Client als normalen Browser
  win.webContents.setUserAgent(
    win.webContents.getUserAgent().replace(/\s*Electron\/[\d.]+/, '')
  );

  // Ladefortschritt in der Taskbar
  win.webContents.on('did-start-loading', () => {
    win.setProgressBar(2, { mode: 'indeterminate' });
  });

  // Popouts erlauben (Foundry öffnet Regelreferenzen etc. in neuen Fenstern)
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { parent: win, autoHideMenuBar: true },
  }));

  win.menuBarVisible = false;

  // Tastenkürzel
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      win.webContents.toggleDevTools(); event.preventDefault();
    } else if (input.key === 'F5' && input.control) {
      win.webContents.reloadIgnoringCache(); event.preventDefault();
    } else if (input.key === 'F5') {
      win.webContents.reload(); event.preventDefault();
    } else if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen()); event.preventDefault();
    }
  });

  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return;
    handleFoundryPageLoad(win);
  });

  win.webContents.on('did-stop-loading', () => {
    if (win.isDestroyed()) return;
    win.setProgressBar(-1);
    win.setTitle(win.webContents.getTitle());
  });

  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  const winId = win.webContents.id;
  windowsData[winId] = { gameId: '', autoLogin: true };

  win.on('closed', () => {
    delete windowsData[winId];
  });
  return win;
}

// ─── Foundry-Seiten-Handler ───────────────────────────────────────────────────
// FIX Issue #8: Auto-Login für Foundry V12 UND V13 (unterschiedliche DOM-Struktur)

function handleFoundryPageLoad(win: BrowserWindow): void {
  const url = win.webContents.getURL();

  injectReturnButton(win, url);

  if (!url.endsWith('/join') && !url.endsWith('/auth')) return;

  const wData = windowsData[win.webContents.id];
  if (!wData?.gameId) return;

  const creds = getLoginDetails(wData.gameId);
  if (!creds.user && !creds.password) return;

  const safeUser  = creds.user.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safePwd   = creds.password.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeAdmin = creds.adminPassword.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const gameConfig = readAppConfig().games.find(g => String(g.id) === String(wData.gameId));
  const autoLogin  = (gameConfig?.autoLogin ?? true) && wData.autoLogin;
  wData.autoLogin  = false;

  win.webContents.executeJavaScript(`
  (async function() {
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // Warten bis select[name="userid"] im DOM ist
    let attempts = 0;
    while (attempts++ < 50) {
      if (document.querySelector('select[name="userid"]')) break;
      await wait(100);
    }

    // Spieler auswählen (V13: value ist die userId, nicht der Name)
    const select = document.querySelector('select[name="userid"]');
    if (select) {
      // Erst nach Text suchen, dann nach value
      let found = false;
      select.querySelectorAll('option').forEach(opt => {
        if (opt.textContent.trim() === '${safeUser}') {
          select.value = opt.value;
          found = true;
        }
      });
      if (!found) {
        // Fallback: direkt als value versuchen
        select.value = '${safeUser}';
      }
      // Change-Event feuern damit Foundry reagiert
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Passwort setzen
    const pwInput = document.querySelector('input[name="password"]');
    if (pwInput) {
      pwInput.value = '${safePwd}';
  pwInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Admin-Passwort
    const adminInput = document.querySelector('#join-game-setup input[name="adminPassword"]');
    if (adminInput) {
      adminInput.value = '${safeAdmin}';
  adminInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Auto-Submit
    if (${autoLogin}) {
      await wait(200);
      // V13: button[name="join"] im join-game-form
      const joinBtn = document.querySelector('#join-game-form button[name="join"]');
      if (joinBtn) joinBtn.click();
    }
  })();
  `).catch(console.error);
}

function injectReturnButton(win: BrowserWindow, url: string): void {
  if (url.endsWith('/setup')) {
    win.webContents.executeJavaScript(`
      if (!document.getElementById('fvtt-client-back')) {
        const btn = document.createElement('button');
        btn.id = 'fvtt-client-back';
        btn.type = 'button';
        btn.setAttribute('data-action', 'returnServerSelect');
        btn.setAttribute('data-tooltip', 'Server auswählen');
        btn.innerHTML = '<i class="fas fa-server"></i>';
        btn.addEventListener('click', () => window.api.returnToSelect());
        setTimeout(() => document.querySelector('nav#setup-menu')?.append(btn), 200);
      }
    `).catch(() => {});
  }

  if (url.endsWith('/auth') || url.endsWith('/join')) {
    win.webContents.executeJavaScript(`
      if (!document.getElementById('fvtt-client-back')) {
        const btn = document.createElement('button');
        btn.id = 'fvtt-client-back';
        btn.type = 'button';
        btn.className = 'bright';
        btn.innerHTML = '<i class="fa-solid fa-server"></i> Serverauswahl';
        btn.addEventListener('click', () => window.api.returnToSelect());
        setTimeout(() => document.querySelector('.form-footer, footer.form-footer')?.append(btn), 200);
      }
    `).catch(() => {});
  }
}

// Hook für "Return"-Button im laufenden Spiel (renderSettings)
function injectInGameReturnButton(win: BrowserWindow): void {
  win.webContents.executeJavaScript(`
    if (typeof Hooks !== 'undefined') {
      Hooks.on('renderSettings', function(app, html) {
        if (html.find?.('#fvtt-client-back').length > 0) return;
        if (html.querySelector?.('#fvtt-client-back')) return;
        const btn = document.createElement('button');
        btn.id = 'fvtt-client-back';
        btn.innerHTML = '<i class="fas fa-server"></i> Serverauswahl';
        btn.addEventListener('click', () => window.api.returnToSelect());
        (html.find?.('#settings-access')[0] || html.querySelector?.('#settings-access'))?.append(btn);
      });
    }
  `).catch(() => {});
}

// ─── PipeWire ─────────────────────────────────────────────────────────────────

function setPipewireQuantum(frames: number): void {
  exec(`pw-metadata -n settings 0 clock.force-quantum ${frames}`, (err) => {
    if (err) console.error(`[PipeWire] Fehler: ${err.message}`);
  });
}

// ─── System-Info ──────────────────────────────────────────────────────────────

async function getSystemInfo() {
  const pipewireActive = await new Promise<boolean>(resolve => {
    exec('pactl info 2>/dev/null | grep -i pipewire', (err, out) => resolve(!err && out.length > 0));
  });
  return {
    platform: process.platform,
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    pipewireActive,
    waylandActive: !!process.env['WAYLAND_DISPLAY'],
  };
}

// ─── Menü ─────────────────────────────────────────────────────────────────────

function buildMenu(): void {
  const getFocused = () => BrowserWindow.getFocusedWindow();
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'FoundryVTT',
      submenu: [
        { label: 'Neu laden',   accelerator: 'F5',       click: () => getFocused()?.webContents.reload() },
        { label: 'Hard Reload', accelerator: 'Shift+F5', click: () => getFocused()?.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Beenden',     accelerator: 'Ctrl+Q',   click: () => app.quit() },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { label: 'Vollbild', accelerator: 'F11', click: () => { const w = getFocused(); if (w) w.setFullScreen(!w.isFullScreen()); } },
        { label: 'DevTools', accelerator: 'F12', click: () => getFocused()?.webContents.toggleDevTools() },
      ],
    },
    {
      label: 'Audio (PipeWire)',
      submenu: [
        { label: '⚡ Niedrig – 64 Frames  [PTT]',         click: () => setPipewireQuantum(64) },
        { label: '⚖ Ausgeglichen – 256 Frames [LiveKit]', click: () => setPipewireQuantum(256) },
        { label: '🎵 Qualität – 1024 Frames [Musik]',     click: () => setPipewireQuantum(1024) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── App-Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  buildMenu();
  const win = createGameWindow();
  const rp = rendererPath();
  if (rp.startsWith('http')) win.loadURL(rp);
  else win.loadFile(rp);
});

app.on('second-instance', () => {
  const win = createGameWindow();
  const rp = rendererPath();
  if (rp.startsWith('http')) win.loadURL(rp);
  else win.loadFile(rp);
});

app.on('activate', (_, hasVisible) => {
  if (!hasVisible) {
    const win = createGameWindow();
    const rp = rendererPath();
    if (rp.startsWith('http')) win.loadURL(rp);
    else win.loadFile(rp);
  }
});

// ─── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.on('open-game', (e, gameId: GameId) => {
  if (windowsData[e.sender.id]) windowsData[e.sender.id].gameId = gameId;
});

ipcMain.on('return-select', (e) => {
  if (windowsData[e.sender.id]) windowsData[e.sender.id].autoLogin = true;
  const rp = rendererPath();
  if (rp.startsWith('http')) e.sender.loadURL(rp);
  else e.sender.loadFile(rp);
});

ipcMain.on('game-loaded', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) injectInGameReturnButton(win);
});

ipcMain.on('clear-cache', async (e) => e.sender.session.clearCache());

ipcMain.on('save-user-data', (_e, data: SaveUserData) => {
  saveLoginDetails(data.gameId, data.user, data.password, data.adminPassword);
});

ipcMain.on('save-app-config', (_e, data: Partial<AppConfig>) => {
  const ud = readUserData();
  ud.app = { ...(ud.app ?? {}), ...data };
  writeUserData(ud);
});

ipcMain.on('cache-path', (_e, cachePath: string) => {
  const ud = readUserData();
  ud.cachePath = cachePath;
  writeUserData(ud);
});

ipcMain.on('set-pipewire-quantum', (_e, frames: number) => setPipewireQuantum(frames));

ipcMain.handle('get-user-data',    (_, gameId: GameId) => getLoginDetails(gameId));
ipcMain.handle('app-config',       () => readAppConfig());
ipcMain.handle('local-app-config', () => (readUserData().app ?? {}) as Partial<AppConfig>);
ipcMain.handle('app-version',      () => app.getVersion());
ipcMain.handle('cache-path',       () => app.getPath('sessionData'));
ipcMain.handle('get-system-info',  () => getSystemInfo());

ipcMain.handle('select-path', (e) => {
  if (windowsData[e.sender.id]) windowsData[e.sender.id].autoLogin = true;
  return rendererPath();
});
