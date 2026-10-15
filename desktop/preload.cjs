const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('apoxiaDesktop', {
  platform: process.platform,
  onPasteCommand: callback => {const listener=()=>callback();ipcRenderer.on('desktop:paste-command',listener);return ()=>ipcRenderer.removeListener('desktop:paste-command',listener);},
  pasteNative: () => ipcRenderer.invoke('desktop:paste-native'),
  transfer: action => ipcRenderer.invoke('desktop:transfer',action),
  onTransferProgress: callback => {const listener=(_event,value)=>callback(value);ipcRenderer.on('desktop:transfer-progress',listener);return ()=>ipcRenderer.removeListener('desktop:transfer-progress',listener);},
  chooseFile: () => ipcRenderer.invoke('desktop:choose-file'),
  linkPickedFile: file => ipcRenderer.invoke('desktop:register-picked-file', webUtils.getPathForFile(file)),
  importLinkedMedia: (file,query,headers) => ipcRenderer.invoke('desktop:import-linked-media',webUtils.getPathForFile(file),query,headers),
  openFile: id => ipcRenderer.invoke('desktop:open-file', id),
  openOriginal: id => ipcRenderer.invoke('desktop:open-original', id),
  showCanvasFolder: () => ipcRenderer.invoke('desktop:show-canvas-folder'),
  savePreferences: values => ipcRenderer.invoke('desktop:save-preferences', values),
  restorePreferences: () => ipcRenderer.invoke('desktop:restore-preferences'),
  setLanguage: language => ipcRenderer.invoke('desktop:set-language', language),
});
