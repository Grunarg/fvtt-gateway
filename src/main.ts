// fvtt-cachy-client – Main Process
// Fixes: #7 (AZERTY), #8 (Auto-Login V12/V13), #13 (Chromium zu alt → Electron 36)
//        #14 (Version-Check gegen eigenes Repo), GPU-Acceleration auf Wayland/AMD

import { app, BrowserWindow, ipcMain, safeStorage, session, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

process.env['ELECTRON_OZONE_PLATFORM_HINT'] = 'wayland';
process.env['LIBVA_DRIVER_NAME'] = 'radeonsi';

// MaxListeners erhöhen
require('events').EventEmitter.defaultMaxListeners = 20;

if (require('electron-squirrel-startup')) app.quit();

if (app.isPackaged) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

app.commandLine.appendSwitch('ozone-platform', 'wayland');
app.commandLine.appendSwitch('enable-features', [
  'SharedArrayBuffer','WaylandWindowDecorations','UseOzonePlatform',
  'VaapiVideoDecodeLinuxGL','VaapiVideoEncoder','WebGPU',
  'WebRTCPipeWireCapturer','CanvasOopRasterization',
].join(','));
app.commandLine.appendSwitch('disable-features','UseChromeOSDirectVideoDecoder');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('force-fieldtrials',
                             'WebRTC-Audio-Red-For-Opus/Enabled/WebRTC-Audio-OpusMinPacketLossRate/Enabled-1/');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=2048 --turbofan --expose-gc');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const isSingleInstance = app.requestSingleInstanceLock();
if (!isSingleInstance) { app.quit(); }

const USER_DATA_FILE = () => path.join(app.getPath('userData'), 'userData.json');
const APP_CONFIG_FILE = () => {
  const userDataConfig = path.join(app.getPath('userData'), 'config.json');
  if (fs.existsSync(userDataConfig)) return userDataConfig;
  return path.join(app.getAppPath(), 'config.json');
};

function readUserData(): UserData {
  try { return JSON.parse(fs.readFileSync(USER_DATA_FILE()).toString()); }
  catch { return {}; }
}
function writeUserData(data: UserData): void {
  fs.writeFileSync(USER_DATA_FILE(), JSON.stringify(data, null, 2));
}
function readAppConfig(): AppConfig {
  const defaults: AppConfig = {
    games: [], backgroundColor: '#1a1a2e', textColor: '#e8e0c8',
    accentColor: '#c8a84b', keyboardLayout: 'qwertz', lobbyMusicVolume: 0.4,
  };
  try {
    const file = JSON.parse(fs.readFileSync(APP_CONFIG_FILE()).toString()) as Partial<AppConfig>;
    const userData = readUserData();
    const userApp = (userData.app ?? {}) as Partial<AppConfig>;
    return { ...defaults, ...file, ...userApp,
      games: [...(file.games ?? []), ...(userApp.games ?? [])] };
  } catch { return defaults; }
}

{ const ud = readUserData();
  if (ud.cachePath && typeof ud.cachePath === 'string') app.setPath('sessionData', ud.cachePath); }

  function getLoginDetails(gameId: GameId): GameUserDataDecrypted {
    const ud = readUserData();
    const entry = ud[gameId as string] as GameUserData | undefined;
    if (!entry) return { user: '', password: '', adminPassword: '' };
    const dec = (arr: number[]): string => {
      if (!arr?.length) return '';
      if (!safeStorage.isEncryptionAvailable()) return '';
      try { return safeStorage.decryptString(Buffer.from(new Uint8Array(arr))); }
      catch { return ''; }
    };
    return { user: entry.user ?? '', password: dec(entry.password ?? []), adminPassword: dec(entry.adminPassword ?? []) };
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

  // ─── Discord & Foundry BrowserViews ──────────────────────────────────────────

  let discordView: Electron.BrowserView | null = null;
  let foundryView: Electron.BrowserView | null = null;
  let discordVisible = false;
  let discordConfig: DiscordPanelConfig = {
    enabled: false, position: 'bottom', size: 280, url: 'https://discord.com/app',
  };

  function getDiscordBounds(win: BrowserWindow, config: DiscordPanelConfig): Electron.Rectangle {
    const { width, height } = win.getContentBounds();
    const size = config.size;
    switch (config.position) {
      case 'bottom': return { x: 0, y: height - size, width, height: size };
      case 'top':    return { x: 0, y: 0, width, height: size };
      case 'left':   return { x: 0, y: 0, width: size, height };
      case 'right':  return { x: width - size, y: 0, width: size, height };
    }
  }

  function getFoundryBounds(win: BrowserWindow, config: DiscordPanelConfig): Electron.Rectangle {
    const { width, height } = win.getContentBounds();
    const size = config.size;
    if (!discordVisible) return { x: 0, y: 0, width, height };
    switch (config.position) {
      case 'bottom': return { x: 0, y: 0, width, height: height - size };
      case 'top':    return { x: 0, y: size, width, height: height - size };
      case 'left':   return { x: size, y: 0, width: width - size, height };
      case 'right':  return { x: 0, y: 0, width: width - size, height };
    }
  }

  function updateLayout(win: BrowserWindow): void {
    if (foundryView) foundryView.setBounds(getFoundryBounds(win, discordConfig));
    if (discordView && discordVisible) {
      win.removeBrowserView(discordView);
      win.addBrowserView(discordView);
      discordView.setBounds(getDiscordBounds(win, discordConfig));
    }
  }

  function createFoundryView(win: BrowserWindow, url: string): void {
    if (foundryView) { win.removeBrowserView(foundryView); foundryView = null; }

    foundryView = new (require('electron').BrowserView)({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
                                                        nodeIntegration: false, contextIsolation: true, webgl: true, backgroundThrottling: false,
      },
    });

    foundryView.webContents.setUserAgent(
      foundryView.webContents.getUserAgent().replace(/\s*Electron\/[\d.]+/, '')
    );

    win.addBrowserView(foundryView);
    const { width, height } = win.getContentBounds();
    foundryView.setBounds({ x: 0, y: 0, width, height });
    foundryView.setAutoResize({ width: true, height: true });

    foundryView.webContents.on('did-start-loading', () => {
      if (!win.isDestroyed()) win.setProgressBar(2, { mode: 'indeterminate' });
    });
    foundryView.webContents.on('did-stop-loading', () => {
      if (!win.isDestroyed()) { win.setProgressBar(-1); win.setTitle(foundryView!.webContents.getTitle()); }
    });
    foundryView.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) handleFoundryPageLoad(win, foundryView!);
    });
      foundryView.webContents.setWindowOpenHandler(() => ({
        action: 'allow', overrideBrowserWindowOptions: { parent: win, autoHideMenuBar: true },
      }));
      foundryView.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') { foundryView!.webContents.toggleDevTools(); event.preventDefault(); }
        else if (input.key === 'F5' && input.control) { foundryView!.webContents.reloadIgnoringCache(); event.preventDefault(); }
        else if (input.key === 'F5') { foundryView!.webContents.reload(); event.preventDefault(); }
        else if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
      });

      if (url.startsWith('http')) foundryView.webContents.loadURL(url);
      else foundryView.webContents.loadFile(url);
  }

  function createDiscordView(win: BrowserWindow): void {
    if (discordView) { win.removeBrowserView(discordView); discordView = null; }

    // Discord-Session mit PipeWire/Mikrofon-Support konfigurieren
    const discordSession = session.fromPartition('persist:discord');
    discordSession.setPermissionRequestHandler((_wc, permission, callback) => {
      if (['media', 'microphone', 'camera', 'audioCapture', 'videoCapture'].includes(permission)) {
        callback(true);
      } else {
        callback(false);
      }
    });

    discordView = new (require('electron').BrowserView)({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:discord',
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    discordView.webContents.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
    );
    win.addBrowserView(discordView);
    discordView.setBounds(getDiscordBounds(win, discordConfig));
    discordView.setAutoResize({ width: true, height: false });
    discordView.webContents.loadURL(discordConfig.url);
  }

  function toggleDiscord(win: BrowserWindow): void {
    if (!discordView) createDiscordView(win);
    discordVisible = !discordVisible;
    if (discordVisible) {
      discordView!.setBounds(getDiscordBounds(win, discordConfig));
      updateLayout(win);
      if (foundryView) {
        injectSplitterInDiscord(foundryView.webContents);
      } else {
        discordView!.webContents.once('did-finish-load', () => {
          injectSplitterInDiscord(discordView!.webContents);
        });
        if (discordView!.webContents.getURL()) {
          injectSplitterInDiscord(discordView!.webContents);
        }
      }
    } else {
      discordView!.setBounds({ x: -10000, y: -10000, width: 1, height: 1 });
      foundryView?.webContents.executeJavaScript(
        `document.getElementById('fvtt-discord-splitter')?.remove();`
      ).catch(() => {});
    }
    updateLayout(win);
  }

  function injectSplitterInDiscord(wc: Electron.WebContents): void {
    const size = discordConfig.size;
    const pos = discordConfig.position;
    const target = foundryView?.webContents ?? wc;

    const isVertical = pos === 'bottom' || pos === 'top';
    const cursor = isVertical ? 'ns-resize' : 'ew-resize';

    // Splitter-Style je nach Position
    const baseStyle = `position:fixed;z-index:2147483647;background:rgba(200,168,75,0.6);cursor:${cursor};pointer-events:all;`;
    const posStyle = isVertical
    ? `left:0;right:0;height:8px;${pos === 'bottom' ? 'bottom:0' : 'top:0'};`
    : `top:0;bottom:0;width:8px;${pos === 'right' ? 'right:0' : 'left:0'};`;

    // Bewegungsrichtung und Vorzeichen
    const axis = isVertical ? 'clientY' : 'clientX';
    const sign = (pos === 'bottom' || pos === 'right') ? 1 : -1;
    const edge = pos === 'bottom' ? 'bottom' : pos === 'top' ? 'top' : pos === 'right' ? 'right' : 'left';

    target.executeJavaScript(`
    (() => {
      document.getElementById('fvtt-discord-splitter')?.remove();
      const splitter = document.createElement('div');
      splitter.id = 'fvtt-discord-splitter';
    splitter.style.cssText = '${baseStyle}${posStyle}';
    let dragging = false, startPos = 0, currentSize = ${size};
    splitter.addEventListener('mousedown', (e) => {
      dragging = true;
      startPos = e.${axis};
      document.body.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
    }, true);
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const diff = (startPos - e.${axis}) * ${sign};
      const newSize = Math.max(100, Math.min(800, currentSize + diff));
      currentSize = newSize;
      startPos = e.${axis};
      splitter.style['${edge}'] = '0px';
    window.api.setDiscordPanel({ size: newSize });
    }, true);
    window.addEventListener('mouseup', () => {
      dragging = false;
      document.body.style.userSelect = '';
    }, true);
    document.body.appendChild(splitter);
    })();
    `).catch(e => console.error('[Splitter] JS Fehler:', e.message));
  }

  function injectSplitter(wc: Electron.WebContents): void {
    const size = discordConfig.size;
    wc.executeJavaScript(`
    document.getElementById('fvtt-discord-splitter')?.remove();
    const splitter = document.createElement('div');
    splitter.id = 'fvtt-discord-splitter';
    splitter.style.cssText = 'position:fixed;z-index:99999;background:rgba(200,168,75,0.4);cursor:ns-resize;left:0;right:0;height:6px;bottom:${size}px;transition:background 0.2s;';
    splitter.addEventListener('mouseenter', () => splitter.style.background = 'rgba(200,168,75,0.8)');
    splitter.addEventListener('mouseleave', () => splitter.style.background = 'rgba(200,168,75,0.4)');
    let dragging = false, startY = 0, startSize = ${size};
    splitter.addEventListener('mousedown', (e) => {
      dragging = true; startY = e.clientY; startSize = parseInt(splitter.style.bottom);
      document.body.style.userSelect = 'none'; e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newSize = Math.max(100, Math.min(800, startSize + (startY - e.clientY)));
      splitter.style.bottom = newSize + 'px';
    window.api.setDiscordPanel({ size: newSize });
    });
    document.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });
    document.body.appendChild(splitter);
  }
  `).catch(() => {});
  }

  // ─── Fenster erstellen ────────────────────────────────────────────────────────

  function createGameWindow(): BrowserWindow {
    const win = new BrowserWindow({
      show: false, width: 1280, height: 800, backgroundColor: '#1a1a2e',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
                                  nodeIntegration: false, contextIsolation: true,
      },
    });

    win.menuBarVisible = false;

    win.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') { win.webContents.toggleDevTools(); event.preventDefault(); }
    });

    win.once('ready-to-show', () => { win.maximize(); win.show(); win.focus(); win.moveTop(); });
    win.on('resize', () => updateLayout(win));

    const winId = win.webContents.id;
    windowsData[winId] = { gameId: '', autoLogin: true };
    win.on('closed', () => { delete windowsData[winId]; });

    return win;
  }

  // ─── Foundry-Seiten-Handler ───────────────────────────────────────────────────

  function handleFoundryPageLoad(win: BrowserWindow, view: Electron.BrowserView): void {
    const url = view.webContents.getURL();
    injectReturnButton(view, url);
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

    view.webContents.executeJavaScript(`
    (async function() {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      let attempts = 0;
      while (attempts++ < 50) { if (document.querySelector('select[name="userid"]')) break; await wait(100); }
      const select = document.querySelector('select[name="userid"]');
      if (select) {
        let found = false;
        select.querySelectorAll('option').forEach(opt => {
          if (opt.textContent.trim() === '${safeUser}') { select.value = opt.value; found = true; }
        });
        if (!found) select.value = '${safeUser}';
    select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const pwInput = document.querySelector('input[name="password"]');
      if (pwInput) { pwInput.value = '${safePwd}'; pwInput.dispatchEvent(new Event('input', { bubbles: true })); }
      const adminInput = document.querySelector('#join-game-setup input[name="adminPassword"]');
      if (adminInput) { adminInput.value = '${safeAdmin}'; adminInput.dispatchEvent(new Event('input', { bubbles: true })); }
      if (${autoLogin}) { await wait(200); document.querySelector('#join-game-form button[name="join"]')?.click(); }
    })();
    `).catch(console.error);
  }

  function injectReturnButton(view: Electron.BrowserView, url: string): void {
    if (url.endsWith('/setup')) {
      view.webContents.executeJavaScript(`
      if (!document.getElementById('fvtt-client-back')) {
        const btn = document.createElement('button');
        btn.id = 'fvtt-client-back'; btn.type = 'button';
      btn.setAttribute('data-action', 'returnServerSelect');
      btn.setAttribute('data-tooltip', 'Server auswählen');
      btn.innerHTML = '<i class="fas fa-server"></i>';
      btn.addEventListener('click', () => window.api.returnToSelect());
      setTimeout(() => document.querySelector('nav#setup-menu')?.append(btn), 200);
      }
      `).catch(() => {});
    }
    if (url.endsWith('/auth') || url.endsWith('/join')) {
      view.webContents.executeJavaScript(`
      if (!document.getElementById('fvtt-client-back')) {
        const btn = document.createElement('button');
        btn.id = 'fvtt-client-back'; btn.type = 'button'; btn.className = 'bright';
      btn.innerHTML = '<i class="fa-solid fa-server"></i> Serverauswahl';
      btn.addEventListener('click', () => window.api.returnToSelect());
      setTimeout(() => document.querySelector('.form-footer, footer.form-footer')?.append(btn), 200);
      }
      `).catch(() => {});
    }
  }

  function injectInGameReturnButton(view: Electron.BrowserView): void {
    view.webContents.executeJavaScript(`
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

  function setPipewireQuantum(frames: number): void {
    exec(`pw-metadata -n settings 0 clock.force-quantum ${frames}`, (err) => {
      if (err) console.error(`[PipeWire] Fehler: ${err.message}`);
    });
  }

  async function getSystemInfo() {
    const pipewireActive = await new Promise<boolean>(resolve => {
      exec('pactl info 2>/dev/null | grep -i pipewire', (err, out) => resolve(!err && out.length > 0));
    });
    return {
      platform: process.platform, electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome, nodeVersion: process.versions.node,
      pipewireActive, waylandActive: !!process.env['WAYLAND_DISPLAY'],
    };
  }

  function buildMenu(): void {
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'FoundryVTT', submenu: [
        { label: 'Neu laden',   accelerator: 'F5',       click: () => foundryView?.webContents.reload() },
        { label: 'Hard Reload', accelerator: 'Shift+F5', click: () => foundryView?.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Beenden',     accelerator: 'Ctrl+Q',   click: () => app.quit() },
      ]},
      { label: 'Ansicht', submenu: [
        { label: 'Vollbild', accelerator: 'F11', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.setFullScreen(!w.isFullScreen()); }},
        { label: 'DevTools', accelerator: 'F12', click: () => foundryView?.webContents.toggleDevTools() },
      ]},
      { label: 'Audio (PipeWire)', submenu: [
        { label: '⚡ Niedrig – 64 Frames  [PTT]',         click: () => setPipewireQuantum(64) },
        { label: '⚖ Ausgeglichen – 256 Frames [LiveKit]', click: () => setPipewireQuantum(256) },
        { label: '🎵 Qualität – 1024 Frames [Musik]',     click: () => setPipewireQuantum(1024) },
      ]},
      { label: 'Discord', submenu: [
        { label: 'Discord ein/ausblenden', accelerator: 'Ctrl+D',
          click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) toggleDiscord(win); }},
      ]},
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  app.whenReady().then(() => {
    const srcConfig = path.join(app.getAppPath(), 'config.json');
    const dstConfig = path.join(app.getPath('userData'), 'config.json');
    if (!fs.existsSync(dstConfig) && fs.existsSync(srcConfig)) fs.copyFileSync(srcConfig, dstConfig);

    const savedDiscord = (readUserData().app as any)?.discord;
    if (savedDiscord) discordConfig = { ...discordConfig, ...savedDiscord };

    buildMenu();

    setInterval(() => {
      if (global.gc) (global.gc as () => void)();
      session.defaultSession.clearCache();
    }, 30 * 60 * 1000);

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

      ipcMain.on('open-game', (e, gameId: GameId) => {
        const win = BrowserWindow.fromWebContents(e.sender);
        if (!win) return;
        if (windowsData[e.sender.id]) windowsData[e.sender.id].gameId = gameId;
        // Foundry in BrowserView laden wenn ein Spiel gestartet wird
        // (wird von renderer.ts via window.location.href ausgelöst – kein separater IPC nötig)
      });

        ipcMain.on('launch-game', (e, url: string) => {
          const win = BrowserWindow.fromWebContents(e.sender);
          if (win) createFoundryView(win, url);
        });

          ipcMain.on('return-select', (e) => {
            const win = BrowserWindow.fromWebContents(e.sender);
            if (win && foundryView) { win.removeBrowserView(foundryView); foundryView = null; }
            if (windowsData[e.sender.id]) windowsData[e.sender.id].autoLogin = true;
            const rp = rendererPath();
            if (rp.startsWith('http')) e.sender.loadURL(rp);
            else e.sender.loadFile(rp);
          });

            ipcMain.on('game-loaded', (e) => {
              if (foundryView) injectInGameReturnButton(foundryView);
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

              ipcMain.on('toggle-discord', (e) => {
                const win = BrowserWindow.fromWebContents(e.sender);
                if (win) toggleDiscord(win);
              });

                ipcMain.on('set-discord-config', (_e, config: Partial<DiscordPanelConfig>) => {
                  discordConfig = { ...discordConfig, ...config };
                  const ud = readUserData();
                  ud.app = { ...(ud.app ?? {}), discord: discordConfig };
                  writeUserData(ud);
                  const win = BrowserWindow.getAllWindows()[0];
                  if (win) updateLayout(win);
                  if (foundryView && discordVisible) {
                    foundryView.webContents.executeJavaScript(
                      `const s = document.getElementById('fvtt-discord-splitter'); if (s) s.style.bottom = '${discordConfig.size}px';`
                    ).catch(() => {});
                  }
                });

                ipcMain.handle('get-discord-config', () => discordConfig);
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
