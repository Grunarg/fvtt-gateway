// Preload für den Launcher (lokale Seite) – volle API.
// Der Main-Prozess prüft zusätzlich, dass Aufrufe wirklich vom Launcher kommen.
import { contextBridge, ipcRenderer } from 'electron';

const api: ClientApi = {
  userData:          (gameId) => ipcRenderer.invoke('get-user-data', gameId),
  appVersion:        ()       => ipcRenderer.invoke('app-version'),
  appConfig:         ()       => ipcRenderer.invoke('app-config'),
  localAppConfig:    ()       => ipcRenderer.invoke('local-app-config'),
  cachePath:         ()       => ipcRenderer.invoke('cache-path'),
  getSystemInfo:     ()       => ipcRenderer.invoke('get-system-info'),
  launchGame:        (id)     => ipcRenderer.send('launch-game', id),
  clearCache:        ()       => ipcRenderer.send('clear-cache'),
  saveUserData:      (d)      => ipcRenderer.send('save-user-data', d),
  saveAppConfig:     (d)      => ipcRenderer.send('save-app-config', d),
  setCachePath:      (p)      => ipcRenderer.send('cache-path', p),
  setPipewireQuantum:(f)      => ipcRenderer.send('set-pipewire-quantum', f),
  toggleDiscord:     ()       => ipcRenderer.send('toggle-discord'),
  setDiscordPanel:   (c)      => ipcRenderer.send('set-discord-config', c),
  getDiscordConfig:  ()       => ipcRenderer.invoke('get-discord-config'),
};

contextBridge.exposeInMainWorld('api', api);
