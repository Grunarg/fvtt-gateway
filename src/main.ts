// fvtt-gateway – Main Process
// Ein Fenster: Launcher bzw. Foundry, optional Discord-Panel mit verschiebbarer Trennlinie.
// Jede Ansicht ist eine eigene WebContentsView mit eigenem, minimalem Preload.

import { app, BaseWindow, WebContentsView, ipcMain, safeStorage, session, shell, Menu } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';

process.env['ELECTRON_OZONE_PLATFORM_HINT'] = 'wayland';
process.env['LIBVA_DRIVER_NAME'] ??= 'radeonsi';

if (app.isPackaged) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

app.commandLine.appendSwitch('ozone-platform', 'wayland');
// Chromium 146: Accelerated* ersetzt die alten Vaapi*-Namen (sonst nur Software-Encoding)
app.commandLine.appendSwitch('enable-features', [
  'SharedArrayBuffer','WaylandWindowDecorations',
  'AcceleratedVideoDecodeLinuxGL','AcceleratedVideoEncoder',
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

// Nur ein Fenster – ein zweiter Start holt das bestehende nach vorne
if (!app.requestSingleInstanceLock()) app.exit(0);

// ─── Persistenz ──────────────────────────────────────────────────────────────

const USER_DATA_FILE = () => path.join(app.getPath('userData'), 'userData.json');
const APP_CONFIG_FILE = () => {
  const userDataConfig = path.join(app.getPath('userData'), 'config.json');
  if (fs.existsSync(userDataConfig)) return userDataConfig;
  return path.join(app.getAppPath(), 'config.json');
};

function readUserData(): UserData {
  const file = USER_DATA_FILE();
  let raw: string;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { return {}; }
  try { return JSON.parse(raw); }
  catch {
    // Beschädigte Datei beiseitelegen statt sie beim nächsten Speichern zu überschreiben
    const backup = `${file}.corrupt-${Date.now()}`;
    try { fs.renameSync(file, backup); } catch { /* ignorieren */ }
    console.error(`[userData] Datei beschädigt, gesichert als ${backup}`);
    return {};
  }
}
function writeUserData(data: UserData): void {
  // Atomar: erst temporär schreiben, dann umbenennen
  const file = USER_DATA_FILE();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
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

// ─── Fenster-Zustand ─────────────────────────────────────────────────────────

const SPLITTER_PX = 6;
const MIN_PANEL   = 150;
const MIN_MAIN    = 300;
const POSITIONS: DiscordPanelConfig['position'][] = ['top', 'bottom', 'left', 'right'];

let win: BaseWindow;
let launcherView: WebContentsView | null = null;
let foundryView:  WebContentsView | null = null;
let discordView:  WebContentsView | null = null;
let splitterView: WebContentsView | null = null;
let discordVisible   = false;
let splitterDragging = false;
let currentGameId: GameId | null = null;
let autoLoginPending = true;
let discordConfig: DiscordPanelConfig = {
  enabled: false, position: 'bottom', size: 280, url: 'https://discord.com/app',
};

const preloadPath = (name: string) => path.join(__dirname, `${name}.js`);

function rendererPath(): string {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) return MAIN_WINDOW_VITE_DEV_SERVER_URL;
  return path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
}

function openExternal(url: string): void {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
}

// ─── Layout ──────────────────────────────────────────────────────────────────

const isVertical = () => discordConfig.position === 'top' || discordConfig.position === 'bottom';

function clampPanelSize(size: number, total: number): number {
  const max = Math.max(MIN_PANEL, total - MIN_MAIN - SPLITTER_PX);
  return Math.round(Math.min(max, Math.max(MIN_PANEL, size)));
}

function computeLayout(width: number, height: number) {
  const size = clampPanelSize(discordConfig.size, isVertical() ? height : width);
  const rest = (isVertical() ? height : width) - size - SPLITTER_PX;
  const S = SPLITTER_PX;
  switch (discordConfig.position) {
    case 'right':  return { main: { x: 0, y: 0, width: rest, height }, splitter: { x: rest, y: 0, width: S, height }, discord: { x: rest + S, y: 0, width: size, height } };
    case 'left':   return { discord: { x: 0, y: 0, width: size, height }, splitter: { x: size, y: 0, width: S, height }, main: { x: size + S, y: 0, width: rest, height } };
    case 'bottom': return { main: { x: 0, y: 0, width, height: rest }, splitter: { x: 0, y: rest, width, height: S }, discord: { x: 0, y: rest + S, width, height: size } };
    case 'top':    return { discord: { x: 0, y: 0, width, height: size }, splitter: { x: 0, y: size, width, height: S }, main: { x: 0, y: size + S, width, height: rest } };
  }
}

function updateLayout(): void {
  if (!win || win.isDestroyed()) return;
  const { width, height } = win.getContentBounds();
  const full = { x: 0, y: 0, width, height };
  const layout = computeLayout(width, height);
  const main = discordVisible ? layout.main : full;

  launcherView?.setBounds(main);
  foundryView?.setBounds(main);
  if (discordView) {
    discordView.setVisible(discordVisible);
    if (discordVisible) discordView.setBounds(layout.discord);
  }
  if (splitterView) {
    splitterView.setVisible(discordVisible);
    // Während des Ziehens liegt der Splitter transparent über dem ganzen Fenster,
    // damit die Maus nicht an Foundry oder Discord verloren geht
    if (discordVisible) splitterView.setBounds(splitterDragging ? full : layout.splitter);
  }
}

// ─── Gemeinsame View-Helfer ──────────────────────────────────────────────────

function attachShortcuts(wc: WebContents): void {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') wc.toggleDevTools();
    else if (input.key === 'F5' && input.control) wc.reloadIgnoringCache();
    else if (input.key === 'F5') wc.reload();
    else if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    else if (input.control && input.shift && input.key.toLowerCase() === 'l') returnToLauncher();
    else return;
    event.preventDefault();
  });
}

type PermissionHandler = Parameters<Electron.Session['setPermissionRequestHandler']>[0];
function allowOnly(allowed: string[]): PermissionHandler {
  return (_wc, permission, callback) => callback(allowed.includes(permission));
}
const FOUNDRY_PERMISSIONS = ['media', 'fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'notifications', 'speaker-selection'];
const DISCORD_PERMISSIONS = ['media', 'fullscreen', 'clipboard-sanitized-write', 'notifications'];

// ─── Launcher ────────────────────────────────────────────────────────────────

function isLauncherUrl(url: string): boolean {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) return url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  return url.startsWith('file://');
}

function loadLauncher(): void {
  if (!launcherView) return;
  const rp = rendererPath();
  if (rp.startsWith('http')) launcherView.webContents.loadURL(rp);
  else launcherView.webContents.loadFile(rp);
}

function createLauncherView(): void {
  launcherView = new WebContentsView({ webPreferences: { preload: preloadPath('preload') } });
  const wc = launcherView.webContents;
  attachShortcuts(wc);
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => {
    if (!isLauncherUrl(url)) { e.preventDefault(); openExternal(url); }
  });
  win.contentView.addChildView(launcherView);
  loadLauncher();
}

// Nur der Launcher (Hauptframe) darf die privilegierte API benutzen
function fromLauncher(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!launcherView && e.sender === launcherView.webContents && e.senderFrame === e.sender.mainFrame;
}
function onLauncher(channel: string, handler: (...args: any[]) => void): void {
  ipcMain.on(channel, (e, ...args) => { if (fromLauncher(e)) handler(...args); });
}
function handleLauncher(channel: string, handler: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromLauncher(e)) throw new Error(`IPC "${channel}" nicht erlaubt`);
    return handler(...args);
  });
}

// ─── Foundry ─────────────────────────────────────────────────────────────────

function normalizeGameUrl(raw: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch { return null; }
}

function createFoundryView(gameUrl: URL): void {
  closeFoundryView();

  const view = new WebContentsView({
    webPreferences: { preload: preloadPath('preload-foundry'), backgroundThrottling: false },
  });
  foundryView = view;
  const wc = view.webContents;
  const origin = gameUrl.origin;

  wc.setUserAgent(wc.getUserAgent().replace(/\s*Electron\/[\d.]+/, ''));
  attachShortcuts(wc);

  // Popups vom eigenen Server (z. B. PopOut!) erlauben, alles andere im System-Browser öffnen
  wc.setWindowOpenHandler(({ url }) => {
    if (normalizeGameUrl(url)?.origin === origin) {
      return { action: 'allow', overrideBrowserWindowOptions: { parent: win, autoHideMenuBar: true } };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  wc.on('did-start-loading', () => { if (!win.isDestroyed()) win.setProgressBar(2, { mode: 'indeterminate' }); });
  wc.on('did-stop-loading', () => {
    if (!win.isDestroyed()) { win.setProgressBar(-1); win.setTitle(wc.getTitle()); }
  });
  wc.on('did-finish-load', () => handleFoundryPageLoad(wc, origin));

  win.contentView.addChildView(view);
  launcherView?.setVisible(false);
  updateLayout();
  wc.loadURL(gameUrl.href);
}

function closeFoundryView(): void {
  if (!foundryView) return;
  const view = foundryView;
  foundryView = null;
  win.contentView.removeChildView(view);
  // Ohne close() läuft der Renderer (inkl. WebGL, Audio, Socket) unsichtbar weiter
  view.webContents.close();
  launcherView?.setVisible(true);
  updateLayout();
}

// ─── Foundry-Seiten-Handler ──────────────────────────────────────────────────

function handleFoundryPageLoad(wc: WebContents, origin: string): void {
  let url: URL;
  try { url = new URL(wc.getURL()); } catch { return; }
  // Fremde Seiten (Redirects, Links) bekommen weder Buttons noch Zugangsdaten
  if (url.origin !== origin) return;

  const p = url.pathname;
  injectReturnButton(wc, p);
  if (p.endsWith('/game')) injectInGameReturnButton(wc);
  if (!p.endsWith('/join') && !p.endsWith('/auth')) return;

  if (currentGameId === null) return;
  const creds = getLoginDetails(currentGameId);
  if (!creds.user && !creds.password) return;

  const gameConfig = readAppConfig().games.find(g => String(g.id) === String(currentGameId));
  const autoLogin  = (gameConfig?.autoLogin ?? true) && autoLoginPending;
  autoLoginPending = false;

  const user  = JSON.stringify(creds.user);
  const pwd   = JSON.stringify(creds.password);
  const admin = JSON.stringify(creds.adminPassword);

  wc.executeJavaScript(`
  (async function() {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let attempts = 0;
    while (attempts++ < 50) { if (document.querySelector('select[name="userid"]')) break; await wait(100); }
    const select = document.querySelector('select[name="userid"]');
    if (select) {
      let found = false;
      select.querySelectorAll('option').forEach(opt => {
        if (opt.textContent.trim() === ${user}) { select.value = opt.value; found = true; }
      });
      if (!found) select.value = ${user};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const pwInput = document.querySelector('input[name="password"]');
    if (pwInput) { pwInput.value = ${pwd}; pwInput.dispatchEvent(new Event('input', { bubbles: true })); }
    const adminInput = document.querySelector('#join-game-setup input[name="adminPassword"]');
    if (adminInput) { adminInput.value = ${admin}; adminInput.dispatchEvent(new Event('input', { bubbles: true })); }
    if (${autoLogin}) { await wait(200); document.querySelector('#join-game-form button[name="join"]')?.click(); }
  })();
  `).catch(console.error);
}

function injectReturnButton(wc: WebContents, pathname: string): void {
  if (pathname.endsWith('/setup')) {
    wc.executeJavaScript(`
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
  if (pathname.endsWith('/auth') || pathname.endsWith('/join')) {
    wc.executeJavaScript(`
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

function injectInGameReturnButton(wc: WebContents): void {
  wc.executeJavaScript(`
  if (typeof Hooks !== 'undefined') {
    Hooks.on('renderSettings', function(app, html) {
      // V12 liefert jQuery, ab V13 ein HTMLElement
      const root = html instanceof HTMLElement ? html : html?.[0];
      if (!root || root.querySelector('#fvtt-client-back')) return;
      const btn = document.createElement('button');
      btn.id = 'fvtt-client-back'; btn.type = 'button';
      btn.innerHTML = '<i class="fas fa-server"></i> Serverauswahl';
      btn.addEventListener('click', () => window.api.returnToSelect());
      const target = root.querySelector('#settings-access') ?? root.querySelector('section:last-of-type') ?? root;
      target.append(btn);
    });
    // Seitenleiste schon gerendert, bevor der Hook registriert war → einmal neu rendern
    if (typeof ui !== 'undefined' && ui.settings?.rendered) ui.settings.render();
  }
  `).catch(() => {});
}

function returnToLauncher(): void {
  if (!foundryView) return;
  closeFoundryView();
  currentGameId = null;
  win.setTitle(app.getName());
  loadLauncher();
}

// ─── Discord & Splitter ──────────────────────────────────────────────────────

function createDiscordView(): void {
  session.fromPartition('persist:discord').setPermissionRequestHandler(allowOnly(DISCORD_PERMISSIONS));

  // Mit Drosselung: ausgeblendet pausiert das Rendering, Voice (WebRTC) läuft weiter
  discordView = new WebContentsView({ webPreferences: { partition: 'persist:discord' } });
  const wc = discordView.webContents;
  wc.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
  );
  attachShortcuts(wc);
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.contentView.addChildView(discordView);
  wc.loadURL(discordConfig.url);
}

function splitterHtml(): string {
  const vertical = isVertical();
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: transparent;
                 cursor: ${vertical ? 'ns-resize' : 'ew-resize'}; }
    #bar { position: fixed; inset: 0; background: rgba(200,168,75,0.45); transition: background 0.15s; }
    body:hover #bar { background: rgba(200,168,75,0.85); }
    body.dragging #bar { display: none; }
  </style></head><body><div id="bar"></div><script>
    let dragging = false, pending = null;
    addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = true; document.body.classList.add('dragging');
      window.splitter.start(); e.preventDefault();
    });
    addEventListener('mousemove', e => {
      if (!dragging) return;
      if (pending === null) requestAnimationFrame(() => { window.splitter.move(pending); pending = null; });
      pending = ${vertical ? 'e.clientY' : 'e.clientX'};
    });
    const end = () => {
      if (!dragging) return;
      dragging = false; document.body.classList.remove('dragging');
      window.splitter.end();
    };
    addEventListener('mouseup', end);
    addEventListener('blur', end);
    document.addEventListener('mouseleave', end);
  </script></body></html>`;
}

function loadSplitter(): void {
  splitterView?.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splitterHtml())}`);
}

function createSplitterView(): void {
  splitterView = new WebContentsView({ webPreferences: { preload: preloadPath('preload-splitter') } });
  splitterView.setBackgroundColor('#00000000');
  splitterView.webContents.on('will-navigate', e => e.preventDefault());
  win.contentView.addChildView(splitterView);
  loadSplitter();
}

function toggleDiscord(): void {
  if (!discordView) createDiscordView();
  if (!splitterView) createSplitterView();
  discordVisible = !discordVisible;
  updateLayout();
}

function sanitizeDiscordConfig(c: unknown): Partial<DiscordPanelConfig> {
  const out: Partial<DiscordPanelConfig> = {};
  if (!c || typeof c !== 'object') return out;
  const { position, size, url, enabled } = c as Record<string, unknown>;
  if (POSITIONS.includes(position as DiscordPanelConfig['position'])) out.position = position as DiscordPanelConfig['position'];
  if (typeof size === 'number' && Number.isFinite(size)) out.size = Math.round(size);
  if (typeof url === 'string' && url.startsWith('https://')) out.url = url;
  if (typeof enabled === 'boolean') out.enabled = enabled;
  return out;
}

function saveDiscordConfig(): void {
  const ud = readUserData();
  ud.app = { ...(ud.app ?? {}), discord: discordConfig };
  writeUserData(ud);
}

function fromSplitter(e: IpcMainEvent): boolean {
  return !!splitterView && e.sender === splitterView.webContents;
}

// ─── System ──────────────────────────────────────────────────────────────────

const PIPEWIRE_QUANTA = [64, 128, 256, 512, 1024];

function setPipewireQuantum(frames: unknown): void {
  if (typeof frames !== 'number' || !PIPEWIRE_QUANTA.includes(frames)) return;
  execFile('pw-metadata', ['-n', 'settings', '0', 'clock.force-quantum', String(frames)], (err) => {
    if (err) console.error(`[PipeWire] Fehler: ${err.message}`);
  });
}

let pipewireCheck: Promise<boolean> | null = null;
function detectPipewire(): Promise<boolean> {
  pipewireCheck ??= new Promise(resolve => {
    execFile('pactl', ['info'], (err, out) => resolve(!err && /pipewire/i.test(out)));
  });
  return pipewireCheck;
}

async function getSystemInfo(): Promise<SystemInfo> {
  return {
    platform: process.platform, electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome, nodeVersion: process.versions.node,
    pipewireActive: await detectPipewire(), waylandActive: !!process.env['WAYLAND_DISPLAY'],
  };
}

function buildMenu(): void {
  const activeView = () => foundryView ?? launcherView;
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: 'FoundryVTT', submenu: [
      { label: 'Neu laden',   accelerator: 'F5',       click: () => activeView()?.webContents.reload() },
      { label: 'Hard Reload', accelerator: 'Shift+F5', click: () => activeView()?.webContents.reloadIgnoringCache() },
      { label: 'Zur Serverauswahl', accelerator: 'Ctrl+Shift+L', click: () => returnToLauncher() },
      { type: 'separator' },
      { label: 'Beenden',     accelerator: 'Ctrl+Q',   click: () => app.quit() },
    ]},
    { label: 'Ansicht', submenu: [
      { label: 'Vollbild', accelerator: 'F11', click: () => win?.setFullScreen(!win.isFullScreen()) },
      { label: 'DevTools', accelerator: 'F12', click: () => activeView()?.webContents.toggleDevTools() },
    ]},
    { label: 'Audio (PipeWire)', submenu: [
      { label: '⚡ Niedrig – 64 Frames  [PTT]',         click: () => setPipewireQuantum(64) },
      { label: '⚖ Ausgeglichen – 256 Frames [LiveKit]', click: () => setPipewireQuantum(256) },
      { label: '🎵 Qualität – 1024 Frames [Musik]',     click: () => setPipewireQuantum(1024) },
    ]},
    { label: 'Discord', submenu: [
      { label: 'Discord ein/ausblenden', accelerator: 'Ctrl+D', click: () => toggleDiscord() },
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── Fenster erstellen ───────────────────────────────────────────────────────

function createMainWindow(): void {
  win = new BaseWindow({
    show: false, width: 1280, height: 800, backgroundColor: '#1a1a2e', autoHideMenuBar: true,
  });
  win.setMenuBarVisibility(false);

  createLauncherView();

  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
    win.on(ev as 'resize', updateLayout);
  }
  win.on('closed', () => {
    for (const view of [foundryView, discordView, splitterView, launcherView]) view?.webContents.close();
    foundryView = discordView = splitterView = launcherView = null;
  });

  win.maximize();
  win.show();
  updateLayout();
}

app.whenReady().then(() => {
  const srcConfig = path.join(app.getAppPath(), 'config.json');
  const dstConfig = path.join(app.getPath('userData'), 'config.json');
  if (!fs.existsSync(dstConfig) && fs.existsSync(srcConfig)) fs.copyFileSync(srcConfig, dstConfig);

  discordConfig = { ...discordConfig, ...sanitizeDiscordConfig(readUserData().app?.discord) };

  session.defaultSession.setPermissionRequestHandler(allowOnly(FOUNDRY_PERMISSIONS));
  if (readAppConfig().autoCacheClear) session.defaultSession.clearCache();

  buildMenu();
  createMainWindow();
});

app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// ─── IPC: Launcher ───────────────────────────────────────────────────────────

onLauncher('launch-game', (gameId: unknown) => {
  const game = readAppConfig().games.find(g => String(g.id) === String(gameId));
  const url = game && normalizeGameUrl(game.url);
  if (!game || !url) return;
  currentGameId = game.id;
  autoLoginPending = true;
  createFoundryView(url);
});

onLauncher('clear-cache', () => session.defaultSession.clearCache());

onLauncher('save-user-data', (data: SaveUserData) => {
  if (!data || typeof data !== 'object') return;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  saveLoginDetails(data.gameId, str(data.user), str(data.password), str(data.adminPassword));
});

onLauncher('save-app-config', (data: Partial<AppConfig>) => {
  if (!data || typeof data !== 'object') return;
  const ud = readUserData();
  ud.app = { ...(ud.app ?? {}), ...data };
  writeUserData(ud);
});

onLauncher('cache-path', (cachePath: unknown) => {
  if (typeof cachePath !== 'string' || (cachePath && !path.isAbsolute(cachePath))) return;
  const ud = readUserData();
  ud.cachePath = cachePath;
  writeUserData(ud);
});

onLauncher('toggle-discord', () => toggleDiscord());

onLauncher('set-discord-config', (config: unknown) => {
  const patch = sanitizeDiscordConfig(config);
  const positionChanged = patch.position && patch.position !== discordConfig.position;
  const urlChanged = patch.url && patch.url !== discordConfig.url;
  discordConfig = { ...discordConfig, ...patch };
  saveDiscordConfig();
  if (positionChanged) loadSplitter();
  if (urlChanged) discordView?.webContents.loadURL(discordConfig.url);
  updateLayout();
});

onLauncher('set-pipewire-quantum', (frames: unknown) => setPipewireQuantum(frames));

handleLauncher('get-discord-config', () => discordConfig);
handleLauncher('get-user-data',      (gameId: GameId) => getLoginDetails(gameId));
handleLauncher('app-config',         () => readAppConfig());
handleLauncher('local-app-config',   () => (readUserData().app ?? {}) as Partial<AppConfig>);
handleLauncher('app-version',        () => app.getVersion());
handleLauncher('cache-path',         () => app.getPath('sessionData'));
handleLauncher('get-system-info',    () => getSystemInfo());

// ─── IPC: Foundry ────────────────────────────────────────────────────────────

ipcMain.on('return-select', (e) => {
  if (!foundryView || e.sender !== foundryView.webContents) return;
  returnToLauncher();
});

// ─── IPC: Splitter ───────────────────────────────────────────────────────────

ipcMain.on('splitter-start', (e) => {
  if (!fromSplitter(e) || !splitterView) return;
  splitterDragging = true;
  win.contentView.addChildView(splitterView); // nach oben holen
  updateLayout();
});

ipcMain.on('splitter-move', (e, pos: unknown) => {
  if (!fromSplitter(e) || !splitterDragging || typeof pos !== 'number' || !Number.isFinite(pos)) return;
  const { width, height } = win.getContentBounds();
  const half = SPLITTER_PX / 2;
  let size: number;
  switch (discordConfig.position) {
    case 'right':  size = width - pos - half; break;
    case 'left':   size = pos - half; break;
    case 'bottom': size = height - pos - half; break;
    case 'top':    size = pos - half; break;
  }
  discordConfig.size = clampPanelSize(size, isVertical() ? height : width);
  updateLayout();
});

ipcMain.on('splitter-end', (e) => {
  if (!fromSplitter(e)) return;
  splitterDragging = false;
  updateLayout();
  saveDiscordConfig();
});
