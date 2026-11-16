const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eeg', {
  openFile:    () => ipcRenderer.invoke('open-file'),
  openMarkers: () => ipcRenderer.invoke('open-markers'),
});
