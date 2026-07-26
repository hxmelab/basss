const fs = require('fs');
const path = require('path');

/**
 * Flat persistent data store for devices and presets mapped by deviceId
 */
class DataStore {
  constructor(filePath) {
    if (filePath) {
      this.filePath = filePath;
    } else {
      let app;
      try {
        app = require('electron').app;
      } catch (e) {}

      let dataDir;
      if (app) {
        dataDir = app.isPackaged 
          ? path.join(app.getPath('userData'), 'data') 
          : path.join(__dirname, '..', 'data');
      } else {
        dataDir = path.join(__dirname, '..', 'data');
      }

      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.filePath = path.join(dataDir, 'devices.json');
    }
    this.devices = new Map();
    this.presets = new Map(); // key: deviceId, value: array of presets
    this.load();
  }

  /**
   * Load data from devices.json
   */
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        this.devices = new Map();
        this.presets = new Map();
        
        if (data.devices) {
          for (const [deviceId, device] of Object.entries(data.devices)) {
            const devClone = { ...device };
            
            // Extract presets if nested and NOT an empty skeleton from previous run
            if (device.presets && device.presets.some(p => p.name || p.type || p.url)) {
              this.presets.set(deviceId, device.presets);
              delete devClone.presets;
            } else if (device.presets) {
              // Ignore empty skeleton presets list to let legacy presets load from top-level key
              delete devClone.presets;
            }
            
            // Force account to match deviceId
            devClone.account = deviceId;

            // Remove modifiedByServerIp
            delete devClone.modifiedByServerIp;
            
            this.devices.set(deviceId, devClone);
          }
        }
        
        // Also support loading legacy presets mapping if they were written in the old format and not nested
        if (data.presets) {
          for (const [deviceId, presets] of Object.entries(data.presets)) {
            if (!this.presets.has(deviceId)) {
              this.presets.set(deviceId, presets);
            }
          }
        }
      }
    } catch (err) {
      console.error('[DataStore] Error loading devices.json:', err.message);
    }
  }

  /**
   * Save data to devices.json
   */
  save() {
    try {
      const data = {
        devices: {}
      };
      for (const [deviceId, device] of this.devices.entries()) {
        const devClone = { ...device };
        delete devClone.account; // Remove account field since account = deviceId is inferred
        delete devClone.modifiedByServerIp; // Remove redundant field
        const presets = this.presets.get(deviceId) || [];
        
        // Ensure there are 6 presets
        const filledPresets = [];
        for (let i = 1; i <= 6; i++) {
          const existing = presets.find(p => String(p.id) === String(i));
          if (existing) {
            filledPresets.push(existing);
          } else {
            filledPresets.push({
              id: String(i),
              name: '',
              type: '',
              url: ''
            });
          }
        }
        devClone.presets = filledPresets;
        data.devices[deviceId] = devClone;
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('[DataStore] Error saving devices.json:', err.message);
    }
  }

  /**
   * Save or update account mapping directly in devices
   * @param {string} deviceId - Device ID
   * @param {string|number} boseID - Bose Account ID
   * @param {string} systemSerialNumber - System Serial Number
   * @param {string} clientIp - Client IP address
   */
  saveAccountMapping(deviceId, boseID, systemSerialNumber = '', clientIp = '') {
    if (!deviceId) return;
    
    let device = this.getDevice(deviceId);
    if (!device) {
      device = {
        deviceId,
        name: 'SoundTouch Device',
        account: deviceId,
        ipAddress: clientIp || '0.0.0.0',
        productCode: 'SoundTouch',
        serialNumber: deviceId,
        firmwareVersion: '1.0.0',
        updatedOn: new Date().toISOString()
      };
    }

    // Determine effective accountId
    let effectiveBoseId = device.accountId;
    if (boseID === '' || boseID === null) {
      effectiveBoseId = '';
    } else if (boseID !== undefined) {
      const isDigitsOnly = boseID && /^\d+$/.test(String(boseID));
      if (isDigitsOnly && String(boseID) !== '8053210') {
        effectiveBoseId = String(boseID);
      }
    }

    const newSysSerial = systemSerialNumber || device.systemSerialNumber || '';
    const newIp = clientIp || device.ipAddress || '';

    // Check if anything has changed
    const hasAccountIdChange = (effectiveBoseId !== undefined && device.accountId !== effectiveBoseId);
    const hasSysSerialChange = (systemSerialNumber && device.systemSerialNumber !== systemSerialNumber);
    const hasIpChange = (clientIp && device.ipAddress !== clientIp);
    const hasModifiedByServerIp = ('modifiedByServerIp' in device);

    if (
      hasAccountIdChange ||
      hasSysSerialChange ||
      hasIpChange ||
      hasModifiedByServerIp
    ) {
      if (effectiveBoseId !== undefined) {
        device.accountId = String(effectiveBoseId);
      }
      device.systemSerialNumber = newSysSerial;
      device.ipAddress = newIp;
      
      // Remove modifiedByServerIp
      delete device.modifiedByServerIp;
      
      device.updatedOn = new Date().toISOString();
      this.devices.set(deviceId, device);
      this.save();
      console.log(`[DataStore] Updated device info for ${deviceId} -> accountId: ${device.accountId || 'none'}, sysSerial: ${newSysSerial}, ip: ${newIp}`);
    }
  }

  /**
   * Find deviceId associated with a given accountId (boseID) and client IP
   * @param {string|number} accountId - Bose Account ID
   * @param {string} clientIp - Client IP address
   * @returns {string} Device ID
   */
  getDeviceIdForAccount(accountId, clientIp = '') {
    if (!accountId) return undefined;
    const searchId = String(accountId);

    // Priority 1: Match both accountId AND IP address
    if (clientIp) {
      const cleanClientIp = clientIp.startsWith('::ffff:') ? clientIp.substring(7) : (clientIp === '::1' ? '127.0.0.1' : clientIp);
      for (const [devId, device] of this.devices.entries()) {
        if (String(device.accountId) === searchId) {
          const recordIp = device.ipAddress || '';
          const cleanRecordIp = recordIp.startsWith('::ffff:') ? recordIp.substring(7) : (recordIp === '::1' ? '127.0.0.1' : recordIp);
          if (cleanRecordIp === cleanClientIp) {
            return devId;
          }
        }
      }
    }

    // Priority 2: Match accountId, record.deviceId, or key
    for (const [devId, device] of this.devices.entries()) {
      if (String(device.accountId) === searchId || devId === searchId || String(device.deviceId) === searchId) {
        return devId;
      }
    }

    // 3. Fallback: if searchId is itself a registered deviceId
    if (this.devices.has(searchId)) {
      return searchId;
    }

    // 4. Fallback: return first deviceId if exists, otherwise searchId
    const firstDevId = this.listDevices()[0];
    if (firstDevId) return firstDevId;

    return searchId;
  }

  /**
   * Find accountId associated with a given deviceId
   * @param {string} deviceId - Device ID
   * @returns {string|undefined} Account ID
   */
  getAccountIdForDeviceId(deviceId) {
    if (!deviceId) return undefined;
    const device = this.devices.get(deviceId);
    if (device && device.accountId) {
      return String(device.accountId);
    }
    return undefined;
  }

  // ==================== DEVICE METHODS ====================

  /**
   * Add device
   * @param {string} deviceId - Device ID
   * @param {Object} device - Device info object
   */
  addDevice(deviceId, device) {
    const devClone = { ...device };
    delete devClone.modifiedByServerIp;
    this.devices.set(deviceId, devClone);
    this.save();
  }

  /**
   * Get device by ID
   * @param {string} deviceId - Device ID
   * @returns {Object|undefined} Device info
   */
  getDevice(deviceId) {
    return this.devices.get(deviceId);
  }

  /**
   * List all device IDs
   * @returns {string[]} Array of device IDs
   */
  listDevices() {
    return Array.from(this.devices.keys());
  }

  /**
   * Remove device
   * @param {string} deviceId - Device ID
   * @returns {boolean} True if removed
   */
  removeDevice(deviceId) {
    this.presets.delete(deviceId);
    const deleted = this.devices.delete(deviceId);
    this.save();
    return deleted;
  }

  /**
   * Save/update device info
   * @param {string} deviceId - Device ID
   * @param {Object} device - Device info
   * @returns {Object} Updated device
   */
  saveDeviceInfo(deviceId, device) {
    this.devices.set(deviceId, device);
    this.save();
    return device;
  }

  /**
   * Rename device
   * @param {string} deviceId - Device ID
   * @param {string} newName - New device name
   * @returns {Object|undefined} Updated device
   */
  renameDevice(deviceId, newName) {
    const device = this.getDevice(deviceId);
    if (device) {
      device.name = newName;
      device.updatedOn = new Date().toISOString();
      this.saveDeviceInfo(deviceId, device);
    }
    return device;
  }

  /**
   * Find device (compatibility wrapper)
   * @param {string} deviceId - Device ID
   * @returns {Object} { device, account: deviceId }
   */
  findDevice(deviceId) {
    const device = this.getDevice(deviceId);
    return { device, account: device ? deviceId : undefined };
  }

  // ==================== PRESET METHODS ====================

  /**
   * Get all presets for a device
   * @param {string} deviceId - Device ID
   * @returns {Array} Array of presets
   */
  getPresets(deviceId) {
    return this.presets.get(deviceId) || [];
  }

  /**
   * Save presets for a device
   * @param {string} deviceId - Device ID
   * @param {Array} presets - Array of presets
   */
  savePresets(deviceId, presets) {
    this.presets.set(deviceId, presets);
    this.save();
  }

  /**
   * Add or update a preset
   * @param {string} deviceId - Device ID
   * @param {Object} preset - Preset object
   */
  addPreset(deviceId, preset) {
    const presets = this.getPresets(deviceId);
    const filtered = presets.filter(p => p.id !== preset.id);
    filtered.push(preset);
    this.savePresets(deviceId, filtered);
  }

  /**
   * Delete a preset
   * @param {string} deviceId - Device ID
   * @param {string} presetId - Preset ID
   * @returns {boolean} True if deleted
   */
  deletePreset(deviceId, presetId) {
    const presets = this.getPresets(deviceId);
    const filtered = presets.filter(p => p.id !== presetId);
    if (filtered.length < presets.length) {
      this.savePresets(deviceId, filtered);
      return true;
    }
    return false;
  }

  /**
   * Clear all data for a device
   * @param {string} deviceId - Device ID
   */
  clearAccount(deviceId) {
    this.devices.delete(deviceId);
    this.presets.delete(deviceId);
    this.save();
  }

  /**
   * Get all device IDs (wrapper for account list)
   * @returns {string[]} Array of device IDs
   */
  getAllAccounts() {
    return this.listDevices();
  }
}

module.exports = DataStore;
