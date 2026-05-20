import './style.css';

const REPO = 'OmegaRogue/fvtt-player-client';

// ─── Utilities ────────────────────────────────────────────────────────────────

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function generateId(): GameId {
  return Math.round(Math.random() * 1_000_000);
}

// ─── App-Config Helpers ───────────────────────────────────────────────────────

async function getLocalConfig(): Promise<Partial<AppConfig>> {
  return window.api.localAppConfig();
}

async function saveLocalConfig(patch: Partial<AppConfig>): Promise<void> {
  const current = await getLocalConfig();
  window.api.saveAppConfig({ ...current, ...patch });
}

// ─── CSS-Variablen und Background ─────────────────────────────────────────────

function applyTheme(config: Partial<AppConfig>): void {
  const root = document.documentElement;
  if (config.backgroundColor)
    root.style.setProperty('--color-bg', config.backgroundColor);
  if (config.textColor)
    root.style.setProperty('--color-text', config.textColor);
  if (config.accentColor)
    root.style.setProperty('--color-accent', config.accentColor);

  let bg = config.background ?? '';
  if (config.backgrounds?.length) {
    bg = config.backgrounds[Math.floor(Math.random() * config.backgrounds.length)];
  }
  if (bg) {
    document.body.style.backgroundImage = `url(${bg})`;
  }

  if (config.customCSS) {
    let el = document.getElementById('custom-css') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'custom-css';
      document.head.append(el);
    }
    el.textContent = config.customCSS;
  }
}

// ─── Tastaturlayout ───────────────────────────────────────────────────────────

function applyKeyboardLayout(layout: string): void {
  document.body.dataset.keyboardLayout = layout;
}

// ─── Lobby-Musik ──────────────────────────────────────────────────────────────

let lobbyAudio: HTMLAudioElement | null = null;
let lobbyTracks: string[] = [];
let lobbyTrackIndex = 0;

function startLobbyMusic(tracks: string[], volume = 0.4): void {
  if (!tracks.length) return;
  stopLobbyMusic();
  lobbyTracks = tracks;
  lobbyTrackIndex = 0;

  const playNext = (): void => {
    if (!lobbyTracks.length) return;
    lobbyAudio = new Audio(lobbyTracks[lobbyTrackIndex % lobbyTracks.length]);
    lobbyAudio.volume = volume;
    lobbyAudio.addEventListener('ended', () => {
      lobbyTrackIndex++;
      playNext();
    });
    lobbyAudio.play().catch(() => {});
  };
  playNext();
}

function stopLobbyMusic(): void {
  if (lobbyAudio) {
    lobbyAudio.pause();
    lobbyAudio.src = '';
    lobbyAudio = null;
  }
}

// ─── Spieleintrag rendern ─────────────────────────────────────────────────────

const gameList = document.getElementById('game-list') as HTMLUListElement;
const gameTemplate = (document.getElementById('game-item-template') as HTMLTemplateElement)
  .content.querySelector('li')!;

async function renderGameItem(game: GameConfig): Promise<void> {
  const li = document.importNode(gameTemplate, true) as HTMLLIElement;
  li.dataset.gameId = String(game.id);

  const creds = await window.api.userData(game.id);

  (li.querySelector('.game-name') as HTMLAnchorElement).textContent = game.name;
  (li.querySelector('.user-name')     as HTMLInputElement).value = creds.user;
  (li.querySelector('.user-password') as HTMLInputElement).value = creds.password;
  (li.querySelector('.admin-password')as HTMLInputElement).value = creds.adminPassword;
  (li.querySelector('.auto-login')    as HTMLInputElement).checked = game.autoLogin ?? true;

  li.querySelector('.game-launch')!.addEventListener('click', () => {
    stopLobbyMusic();
    window.api.openGame(game.id);
    window.api.launchGame(game.url);  // ← neu statt window.location.href
  });

  li.querySelector('.game-settings-toggle')!.addEventListener('click', () => {
    const cfg = li.querySelector('.game-config') as HTMLElement;
    cfg.classList.toggle('open');
  });

  li.querySelector('.save-creds')!.addEventListener('click', async () => {
    try {
      const user      = (li.querySelector('.user-name')     as HTMLInputElement).value;
      const password  = (li.querySelector('.user-password') as HTMLInputElement).value;
      const adminPwd  = (li.querySelector('.admin-password')as HTMLInputElement).value;
      const autoLogin = (li.querySelector('.auto-login')    as HTMLInputElement).checked;

      window.api.saveUserData({ gameId: game.id, user, password, adminPassword: adminPwd });

      const cfg = await window.api.localAppConfig();
      cfg.games = (cfg.games ?? []).map(g =>
        g.id === game.id ? { ...g, autoLogin } : g
      );
      window.api.saveAppConfig(cfg);

      showToast('Zugangsdaten gespeichert');
    } catch(e) {
      console.error('save error:', e);
    }
  });

  li.querySelector('.delete-game')!.addEventListener('click', async () => {
    if (!confirm(`"${game.name}" wirklich entfernen?`)) return;
    const cfg = await getLocalConfig();
    cfg.games = (cfg.games ?? []).filter(g => g.id !== game.id);
    window.api.saveAppConfig(cfg);
    li.remove();
  });

  gameList.appendChild(li);
}

// ─── Spiel hinzufügen ─────────────────────────────────────────────────────────

document.getElementById('add-game')!.addEventListener('click', async () => {
  const nameEl = document.getElementById('new-game-name') as HTMLInputElement;
  const urlEl  = document.getElementById('new-game-url')  as HTMLInputElement;
  const name = nameEl.value.trim();
  const url  = urlEl.value.trim();
  if (!name || !url) return showToast('Name und URL erforderlich', 'error');

  const newGame: GameConfig = { name, url, id: generateId() };
  const cfg = await getLocalConfig();
  cfg.games = [...(cfg.games ?? []), newGame];
  window.api.saveAppConfig(cfg);

  nameEl.value = '';
  urlEl.value  = '';
  await renderGameItem(newGame);
  showToast(`"${name}" hinzugefügt`);
});

// ─── App-Einstellungen ────────────────────────────────────────────────────────

document.getElementById('open-settings')!.addEventListener('click', () => {
  document.getElementById('settings-panel')!.classList.toggle('open');
});

document.getElementById('save-settings')!.addEventListener('click', async () => {
  const get = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
  const getCheck = (id: string) => (document.getElementById(id) as HTMLInputElement).checked;

  const patch: Partial<AppConfig> = {
    backgroundColor:         get('cfg-bg-color'),
    textColor:               get('cfg-text-color'),
    accentColor:             get('cfg-accent-color'),
    background:              get('cfg-background'),
    cachePath:               get('cfg-cache-path'),
    autoCacheClear:          getCheck('cfg-auto-cache'),
    ignoreCertificateErrors: getCheck('cfg-ignore-cert'),
    keyboardLayout:          get('cfg-keyboard-layout') as AppConfig['keyboardLayout'],
    lobbyMusic:              get('cfg-lobby-music').split('\n').map(s => s.trim()).filter(Boolean),
    lobbyMusicVolume:        parseFloat(get('cfg-music-volume')) || 0.4,
    customCSS:               get('cfg-custom-css'),
    discord: {
      enabled: true,
      position: get('cfg-discord-position') as DiscordPanelConfig['position'],
      size:     parseInt(get('cfg-discord-size')) || 280,
      url:      get('cfg-discord-url') || 'https://discord.com/app',
    },
  };

  await saveLocalConfig(patch);
  applyTheme(patch);
  applyKeyboardLayout(patch.keyboardLayout ?? 'qwertz');

  if (patch.cachePath) window.api.setCachePath(patch.cachePath);
  if (patch.lobbyMusic?.length) startLobbyMusic(patch.lobbyMusic, patch.lobbyMusicVolume);
  if (patch.discord) window.api.setDiscordPanel(patch.discord);

  document.getElementById('settings-panel')!.classList.remove('open');
  showToast('Einstellungen gespeichert');
});

document.getElementById('clear-cache')!.addEventListener('click', () => {
  window.api.clearCache();
  showToast('Cache geleert');
});

// PipeWire Schnellzugriff
document.querySelectorAll('[data-quantum]').forEach(btn => {
  btn.addEventListener('click', () => {
    const frames = parseInt((btn as HTMLElement).dataset.quantum ?? '256');
    window.api.setPipewireQuantum(frames);
    document.querySelectorAll('[data-quantum]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showToast(`PipeWire: ${frames} Frames`);
  });
});

document.getElementById('discord-toggle')!.addEventListener('click', () => {
  window.api.toggleDiscord();
});

// ─── Discord Splitter ─────────────────────────────────────────────────────────



// ─── System-Info ──────────────────────────────────────────────────────────────

async function populateSystemInfo(): Promise<void> {
  const info = await window.api.getSystemInfo();
  const el = document.getElementById('system-info');
  if (!el) return;
  el.innerHTML = `
    Electron ${info.electronVersion} &nbsp;·&nbsp; Chromium ${info.chromiumVersion}<br>
    Wayland: ${info.waylandActive ? '✓' : '✗'} &nbsp;·&nbsp;
    PipeWire: ${info.pipewireActive ? '✓' : '✗'}
  `;
}

// ─── Toast-Notifications ──────────────────────────────────────────────────────

function showToast(msg: string, type: 'success' | 'error' = 'success'): void {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('visible'));
  setTimeout(() => {
    t.classList.remove('visible');
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// ─── Config-Migration (von localStorage) ──────────────────────────────────────

async function migrateFromLocalStorage(): Promise<void> {
  const gameList = localStorage.getItem('gameList');
  const appCfg   = localStorage.getItem('appConfig');
  if (!gameList && !appCfg) return;

  const current = await getLocalConfig();
  if (gameList) {
    current.games = [...(current.games ?? []), ...JSON.parse(gameList)];
    localStorage.removeItem('gameList');
  }
  if (appCfg) {
    Object.assign(current, JSON.parse(appCfg));
    localStorage.removeItem('appConfig');
  }
  window.api.saveAppConfig(current);
}

// ─── Settings-Panel befüllen ──────────────────────────────────────────────────

async function populateSettings(cfg: Partial<AppConfig>): Promise<void> {
  const set = (id: string, val: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = val;
  };
  const setCheck = (id: string, val: boolean) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.checked = val;
  };

  set('cfg-bg-color',        cfg.backgroundColor ?? '#1a1a2e');
  set('cfg-text-color',      cfg.textColor       ?? '#e8e0c8');
  set('cfg-accent-color',    cfg.accentColor     ?? '#c8a84b');
  set('cfg-background',      cfg.background      ?? '');
  set('cfg-cache-path',      cfg.cachePath       ?? '');
  set('cfg-keyboard-layout', cfg.keyboardLayout  ?? 'qwertz');
  set('cfg-lobby-music',     (cfg.lobbyMusic ?? []).join('\n'));
  set('cfg-music-volume',    String(cfg.lobbyMusicVolume ?? 0.4));
  set('cfg-custom-css',      cfg.customCSS       ?? '');
  setCheck('cfg-auto-cache',  cfg.autoCacheClear          ?? false);
  setCheck('cfg-ignore-cert', cfg.ignoreCertificateErrors ?? false);

  // Discord
  const discord = cfg.discord ?? { position: 'bottom', size: 280, url: 'https://discord.com/app', enabled: false };
  set('cfg-discord-position', discord.position);
  set('cfg-discord-size',     String(discord.size));
  set('cfg-discord-url',      discord.url);
}

// ─── Initialisierung ──────────────────────────────────────────────────────────

async function init(): Promise<void> {
  await migrateFromLocalStorage();

  let config: AppConfig;
  try { config = await window.api.appConfig(); }
  catch { config = { games: [] } as AppConfig; }

  const localCfg = await getLocalConfig();

  applyTheme({ ...config, ...localCfg });
  applyKeyboardLayout(localCfg.keyboardLayout ?? config.keyboardLayout ?? 'qwertz');
  await populateSettings({ ...config, ...localCfg });
  await populateSystemInfo();

  const appVersion = await window.api.appVersion();
  document.getElementById('app-version')!.textContent = `v${appVersion}`;
  try {
    const latest = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { mode: 'cors' }
    ).then(r => r.json()).then(d => d.tag_name as string);
    if (latest && compareSemver(appVersion, latest) < 0) {
      const banner = document.getElementById('update-banner') as HTMLElement;
      banner.querySelector('.latest-version')!.textContent = latest;
      banner.classList.remove('hidden');
    }
  } catch { /* Update-Check schlägt still fehl */ }

  const allGames = config.games ?? [];
  for (const game of allGames) {
    await renderGameItem(game);
  }

  const music = localCfg.lobbyMusic ?? config.lobbyMusic ?? [];
  if (music.length) startLobbyMusic(music, localCfg.lobbyMusicVolume ?? config.lobbyMusicVolume ?? 0.4);

}

init();
