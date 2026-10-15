// Preload für die Trennlinie zwischen Hauptbereich und Discord.
import { contextBridge, ipcRenderer } from 'electron';

const api: SplitterApi = {
  start: ()               => ipcRenderer.send('splitter-start'),
  move:  (pos: number)    => ipcRenderer.send('splitter-move', pos),
  end:   ()               => ipcRenderer.send('splitter-end'),
};

contextBridge.exposeInMainWorld('splitter', api);
