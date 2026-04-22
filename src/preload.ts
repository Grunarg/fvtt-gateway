import { contextBridge, ipcRenderer } from 'electron';

const api: ClientApi = {
  userData:          (gameId) => ipcRenderer.invoke('get-user-data', gameId),
  appVersion:        ()       => ipcRenderer.invoke('app-version'),
  appConfig:         ()       => ipcRenderer.invoke('app-config'),
  localAppConfig:    ()       => ipcRenderer.invoke('local-app-config'),
  cachePath:         ()       => ipcRenderer.invoke('cache-path'),
  getSystemInfo:     ()       => ipcRenderer.invoke('get-system-info'),
  returnToSelect:    ()       => ipcRenderer.send('return-select'),
  openGame:          (id)     => ipcRenderer.send('open-game', id),
  clearCache:        ()       => ipcRenderer.send('clear-cache'),
  saveUserData:      (d)      => ipcRenderer.send('save-user-data', d),
  saveAppConfig:     (d)      => ipcRenderer.send('save-app-config', d),
  setCachePath:      (p)      => ipcRenderer.send('cache-path', p),
  setPipewireQuantum:(f)      => ipcRenderer.send('set-pipewire-quantum', f),
};

contextBridge.exposeInMainWorld('api', api);
