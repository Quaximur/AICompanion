const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  onEvent: (handler) => ipcRenderer.on('companion-event', (_e, event) => handler(event)),
  onSettings: (handler) => ipcRenderer.on('settings', (_e, settings) => handler(settings)),
  onPoke: (handler) => ipcRenderer.on('poke', () => handler()),
  reportHitRects: (rects) => ipcRenderer.send('hit-rects', rects),
  pressStart: () => ipcRenderer.send('press-start'),
  pressEnd: () => ipcRenderer.send('press-end'),
  showMenu: () => ipcRenderer.send('show-menu'),
});
