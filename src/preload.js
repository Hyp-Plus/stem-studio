const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('stemStudio', {
  pickInput: () => ipcRenderer.invoke('pick-input'),
  pickOutput: () => ipcRenderer.invoke('pick-output'),
  pickEngine: () => ipcRenderer.invoke('pick-engine'),
  pickDefaultOutput: () => ipcRenderer.invoke('pick-default-output'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  engineStatus: () => ipcRenderer.invoke('engine-status'),
  stemOptions: () => ipcRenderer.invoke('stem-options'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  getQueue: () => ipcRenderer.invoke('get-queue'),
  start: (options) => ipcRenderer.invoke('start-separation', options),
  cancel: () => ipcRenderer.invoke('cancel-separation'),
  openPath: (target) => ipcRenderer.invoke('open-path', target),
  appVersion: () => ipcRenderer.invoke('app-version'),
  modelsStatus: () => ipcRenderer.invoke('models-status'),
  modelDownload: (name) => ipcRenderer.invoke('model-download', name),
  modelDownloadCancel: (name) => ipcRenderer.invoke('model-download-cancel', name),
  modelImport: (name, filePath) => ipcRenderer.invoke('model-import', name, filePath),
  onModelProgress: (listener) => ipcRenderer.on('model-progress', (_event, data) => listener(data)),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onUpdate: (listener) => ipcRenderer.on('separation-update', (_event, data) => listener(data)),
  onQueueUpdate: (listener) => ipcRenderer.on('queue-update', (_event, data) => listener(data)),
  onQueueFinished: (listener) => ipcRenderer.on('queue-finished', (_event, data) => listener(data))
});
