const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Receives server logs
  onServerLog: (callback) => {
    ipcRenderer.on('server-log', (event, log) => callback(log));
  },
  // Receives firewall status updates
  onFirewallStatus: (callback) => {
    ipcRenderer.on('firewall-status', (event, status) => callback(status));
  },
  // Triggers/re-checks server status
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  // Triggers network discovery
  scanNetwork: () => ipcRenderer.invoke('scan-network'),
  // Starts telnet deployment to speaker
  deployOverride: (options) => ipcRenderer.invoke('deploy-override', options),
  // Receives deploy progress messages
  onDeployProgress: (callback) => {
    ipcRenderer.on('deploy-progress', (event, msg) => callback(msg));
  },
  // Get all accounts/devices/presets from in-memory datastore
  getEmulationData: () => ipcRenderer.invoke('get-emulation-data'),

  // Generate Override config file
  generateOverrideFile: (options) => ipcRenderer.invoke('generate-override-file', options),
  // Favorites management
  addFavoriteByUuid: (uuid) => ipcRenderer.invoke('add-favorite-by-uuid', uuid),
  getFavorites: () => ipcRenderer.invoke('get-favorites'),
  deleteFavorite: (uuid) => ipcRenderer.invoke('delete-favorite', uuid),
  deleteDevice: (deviceId) => ipcRenderer.invoke('delete-device', deviceId),
  // Speaker preset management
  getSpeakerPresets: (targetIp) => ipcRenderer.invoke('get-speaker-presets', targetIp),
  saveSpeakerPreset: (options) => ipcRenderer.invoke('save-speaker-preset', options),
  // USB & Modification features
  selectUsbDirectory: () => ipcRenderer.invoke('select-usb-directory'),
  createUsbFile: (folderPath) => ipcRenderer.invoke('create-usb-file', folderPath),
  // Speaker controls
  triggerSpeakerKey: (targetIp, key) => ipcRenderer.invoke('trigger-speaker-key', { targetIp, key }),
  playSpeakerFavorite: (targetIp, name, uuid) => ipcRenderer.invoke('play-speaker-favorite', { targetIp, name, uuid }),
  getSpeakerRecents: (targetIp) => ipcRenderer.invoke('get-speaker-recents', targetIp),
  playSpeakerRecent: (options) => ipcRenderer.invoke('play-speaker-recent', options),
  getSpeakerState: (targetIp) => ipcRenderer.invoke('get-speaker-state', targetIp),
  setSpeakerVolume: (targetIp, volume) => ipcRenderer.invoke('set-speaker-volume', { targetIp, volume }),
  setSpeakerBass: (targetIp, bass) => ipcRenderer.invoke('set-speaker-bass', { targetIp, bass }),
  checkTelnet: (targetIp) => ipcRenderer.invoke('check-telnet', targetIp),
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
});
