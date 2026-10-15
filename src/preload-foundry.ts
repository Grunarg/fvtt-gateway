// Preload für den Foundry-Server (fremder Code!) – nur der Zurück-Button.
import { contextBridge, ipcRenderer } from 'electron';

const api: FoundryApi = {
  returnToSelect: () => ipcRenderer.send('return-select'),
};

contextBridge.exposeInMainWorld('api', api);
