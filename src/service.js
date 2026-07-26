const fs = require('fs');
const path = require('path');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');

const DEFAULT_DATESTR = '1970-01-01T00:00:00Z';

/**
 * SoundTouch service - handles business logic and XML generation for a flat datastore mapping
 */
class SoundTouchService {
  /**
   * @param {DataStore} datastore - Data store instance
   */
  constructor(datastore) {
    this.datastore = datastore;
    this.parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
    this.builder = new XMLBuilder({ ignoreAttributes: false });
  }

  /**
   * Convert preset object to XML element
   * @param {Object} preset - Preset object
   * @returns {Object} XML element
   */
  presetToXml(preset) {
    const createdOn = this.parseTimestamp(preset.createdOn);
    const updatedOn = this.parseTimestamp(preset.updatedOn);
    
    const location = preset.location || preset.url || '';
    let sourceId = preset.sourceId || preset.source || '112347';
    let sourceProviderId = preset.sourceProviderId || '11';
    let sourceName = preset.sourceName || 'LOCAL_INTERNET RADIO';

    if (sourceId === 'LOCAL_INTERNET_RADIO' || sourceId === 'STORED_MUSIC') {
      sourceId = '112347';
      sourceProviderId = '11';
      sourceName = 'LOCAL_INTERNET RADIO';
    }

    return {
      '@_buttonNumber': String(preset.id),
      containerArt: preset.containerArt || '',
      contentItemType: preset.type || 'stationurl',
      createdOn,
      location: location,
      name: preset.name || '',
      username: preset.name || '',
      source: {
        '@_id': String(sourceId),
        '@_type': 'Audio',
        createdOn: createdOn,
        credential: { '@_type': 'token' },
        name: '',
        sourceproviderid: String(sourceProviderId),
        sourcename: sourceName,
        sourceSettings: '',
        updatedOn: updatedOn,
        username: '',
      },
      updatedOn,
    };
  }

  /**
   * Get all presets for a device as XML
   * @param {string} deviceId - Device ID
   * @returns {string} XML string
   */
  presetsToXml(deviceId) {
    const presets = this.datastore.getPresets(deviceId);
    const device = this.datastore.getDevice(deviceId);
    const presetElements = presets.map(p => this.presetToXml(p, device));

    const obj = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
      presets: {
        preset: presetElements.length > 0 ? presetElements : [],
      },
    };

    return this.builder.build(obj);
  }

  /**
   * Update or add a preset
   * @param {string} deviceId - Device ID
   * @param {string} presetNumber - Preset number
   * @param {string} xmlData - XML data string
   * @returns {string} Response XML
   */
  updatePreset(deviceId, presetNumber, xmlData) {
    try {
      const parsed = this.parser.parse(xmlData);
      const presetData = parsed.preset;

      let name, location, type, sourceId;
      let sourceProviderId = '11';
      let sourceName = 'LOCAL_INTERNET RADIO';

      if (presetData.ContentItem) {
        // Handle nested <ContentItem> payload format
        const ci = presetData.ContentItem;
        name = ci.itemName || ci.name || ci.username;
        location = ci['@_location'] || ci.location;
        type = ci['@_type'] || ci.type || 'stationurl';
        sourceId = '112347';
        sourceProviderId = '11';
        sourceName = 'LOCAL_INTERNET RADIO';
      } else {
        // Handle flat payload format (standard Bose Marge API)
        name = presetData.name || presetData.username;
        location = presetData.location;
        type = presetData.contentItemType || 'stationurl';
        sourceId = '112347';

        if (presetData.sourceid) {
          sourceId = presetData.sourceid;
          sourceName = presetData.sourcename || 'LOCAL_INTERNET RADIO';
          sourceProviderId = presetData.sourceproviderid || '11';
        } else if (presetData.source) {
          sourceId = presetData.source['@_id'] || presetData.source.id || '112347';
          sourceProviderId = presetData.source.sourceproviderid || '11';
          sourceName = presetData.source.sourcename || 'LOCAL_INTERNET RADIO';
        }
      }

      const containerArt = presetData.containerArt || '';

      if (!name || !location) {
        throw new Error('Missing required preset fields: name, location');
      }

      const now = Math.floor(Date.now() / 1000).toString();

      const preset = {
        id: presetNumber,
        name,
        type,
        location,
        containerArt,
        sourceId,
        sourceProviderId,
        sourceName,
        createdOn: now,
        updatedOn: now,
      };

      this.datastore.addPreset(deviceId, preset);

      const device = this.datastore.getDevice(deviceId);
      const obj = {
        '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
        preset: this.presetToXml(preset, device),
      };

      return this.builder.build(obj);
    } catch (error) {
      throw new Error(`Failed to update preset: ${error.message}`);
    }
  }

  /**
   * Delete a preset
   * @param {string} deviceId - Device ID
   * @param {string} presetId - Preset ID
   * @returns {boolean} True if successful
   */
  deletePreset(deviceId, presetId) {
    const removed = this.datastore.deletePreset(deviceId, presetId);
    if (!removed) {
      throw new Error(`Preset ${presetId} not found`);
    }
    return true;
  }

  /**
   * Device info to XML element
   * @param {Object} device - Device object
   * @param {Array} presets - Array of presets
   * @returns {Object} XML element
   */
  deviceToXml(device, presets) {
    const presetElements = presets.map(p => this.presetToXml(p, device));

    return {
      '@_deviceid': device.deviceId,
      attachedProduct: {
        '@_product_code': device.productCode || 'SoundTouch 20 sm2 ',
        components: '',
        productlabel: device.productCode || 'SoundTouch 20 sm2 ',
        serialnumber: device.systemSerialNumber || device.serialNumber || '069430P53450503AE',
      },
      createdOn: device.createdOn || '2012-09-19T12:43:00.000+00:00',
      firmwareVersion: device.firmwareVersion || '27.0.6.46330.5043500 epdbuild.trunk.hepdswbld04.2022-08-04T11:20:29',
      ipaddress: device.ipAddress || '',
      name: device.name || 'Bose',
      presets: {
        preset: presetElements.length > 0 ? presetElements : [],
      },
      recents: '',
      serialnumber: device.serialNumber || 'U5337009304720048000140',
      updatedOn: device.updatedOn || '2026-06-29T16:08:49.000+00:00',
    };
  }

  /**
   * Get full account XML for an account ID (boseID)
   * @param {string} accountId - Bose Account ID (e.g. 8361499)
   * @returns {string} XML string
   */
  accountFullXml(accountId, clientIp = '') {
    const deviceId = this.datastore.getDeviceIdForAccount(accountId, clientIp);
    const device = this.datastore.getDevice(deviceId) || { deviceId };
    const presets = this.datastore.getPresets(deviceId || accountId);

    const presetsXmlArr = presets.filter(p => p.name && (p.url || p.location)).map(p => {
      const buttonNum = p.id || '1';
      const name = p.name || '';
      const url = p.location || p.url || '';
      const createdOn = p.createdOn || '2026-06-29T16:43:37+00:00';
      const updatedOn = p.updatedOn || '2026-06-29T16:43:37+00:00';
      return `            <preset buttonNumber="${buttonNum}">
               <containerArt />
               <contentItemType>stationurl</contentItemType>
               <createdOn>${createdOn}</createdOn>
               <location>${url}</location>
               <name>${name}</name>
               <username>${name}</username>
               <source id="112347" type="Audio">
                  <createdOn>2026-06-29T16:13:03.003+00:00</createdOn>
                  <credential type="token" />
                  <name />
                  <sourceproviderid>11</sourceproviderid>
                  <sourcename>LOCAL_INTERNET RADIO</sourcename>
                  <sourceSettings />
                  <updatedOn>2026-06-29T16:13:03.003+00:00</updatedOn>
                  <username />
               </source>
               <updatedOn>${updatedOn}</updatedOn>
            </preset>`;
    });

    const presetsXml = presetsXmlArr.join('\n');

    try {
      const filePath = path.join(__dirname, 'resources', 'marge-account.xml');
      if (fs.existsSync(filePath)) {
        const template = fs.readFileSync(filePath, 'utf8');
        const prodCode = device.productCode || 'SoundTouch 20 sm2 ';
        const prodLabel = device.productCode ? device.productCode.trim() : 'SoundTouch 20 sm2';
        const sysSerial = device.systemSerialNumber || '069430P53450503AE';
        const devSerial = device.serialNumber || 'U5337009304720048000140';
        const ipAddr = device.ipAddress || '192.168.68.56';
        const devName = device.name || 'Bose';
        const createdOn = device.createdOn || '2012-09-19T12:43:00.000+00:00';
        const updatedOn = device.updatedOn || '2026-06-29T16:08:49.000+00:00';
        const firmwareVer = device.firmwareVersion || '27.0.6.46330.5043500 epdbuild.trunk.hepdswbld04.2022-08-04T11:20:29';

        return template
          .replace(/\{ACCOUNT_ID\}/g, String(accountId))
          .replace(/\{DEVICE_ID\}/g, String(device.deviceId || deviceId || accountId))
          .replace(/\{PRODUCT_CODE\}/g, prodCode)
          .replace(/\{PRODUCT_LABEL\}/g, prodLabel)
          .replace(/\{SYSTEM_SERIAL_NUMBER\}/g, sysSerial)
          .replace(/\{SERIAL_NUMBER\}/g, devSerial)
          .replace(/\{FIRMWARE_VERSION\}/g, firmwareVer)
          .replace(/\{IP_ADDRESS\}/g, ipAddr)
          .replace(/\{DEVICE_NAME\}/g, devName)
          .replace(/\{DEVICE_CREATED_ON\}/g, createdOn)
          .replace(/\{DEVICE_UPDATED_ON\}/g, updatedOn)
          .replace(/\{PRESETS_XML\}/g, presetsXml)
          .trim();
      }
    } catch (e) {
      console.error('[Service] Error reading marge-account.xml:', e.message);
    }

    const obj = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
      account: {
        '@_id': String(accountId),
        accountStatus: 'OK',
        devices: {
          device: device ? [this.deviceToXml(device, presets)] : []
        },
        mode: 'global',
        preferredLanguage: 'en'
      }
    };
    return this.builder.build(obj);
  }

  /**
   * Add device to account
   * @param {string} deviceId - Device ID
   * @param {string} xmlData - XML data string
   * @returns {Object} { deviceId, xml }
   */
  addDeviceToAccount(deviceId, xmlData) {
    try {
      const parsed = this.parser.parse(xmlData);
      const deviceData = parsed.device;

      const parsedDeviceId = deviceData['@_deviceid'] || deviceData.deviceid || deviceId;
      const name = deviceData.name;

      if (!parsedDeviceId || !name) {
        throw new Error('Missing required device fields: deviceid, name');
      }

      const now = new Date().toISOString();

      const device = {
        deviceId: parsedDeviceId,
        name,
        productCode: 'SoundTouch',
        serialNumber: parsedDeviceId,
        firmwareVersion: '1.0.0',
        ipAddress: '0.0.0.0',
        createdOn: now,
        updatedOn: now,
      };

      this.datastore.addDevice(parsedDeviceId, device);

      const obj = {
        '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
        device: {
          '@_deviceid': parsedDeviceId,
          createdOn: now,
          ipaddress: '',
          name,
          updatedOn: now,
        },
      };

      const returnXml = this.builder.build(obj);
      return { deviceId: parsedDeviceId, xml: returnXml };
    } catch (error) {
      throw new Error(`Failed to add device: ${error.message}`);
    }
  }

  /**
   * Rename device
   * @param {string} deviceId - Device ID
   * @param {string} xmlData - XML data string
   * @returns {string} Response XML
   */
  renameDevice(deviceId, xmlData) {
    try {
      const parsed = this.parser.parse(xmlData);
      const deviceData = parsed.device;

      const newName = deviceData.name;
      if (!newName) {
        throw new Error('Missing required field: name');
      }

      const device = this.datastore.renameDevice(deviceId, newName);
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      const obj = {
        '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
        device: {
          '@_deviceid': device.deviceId,
          createdOn: device.createdOn,
          ipaddress: device.ipAddress,
          name: device.name,
          updatedOn: device.updatedOn,
        },
      };

      return this.builder.build(obj);
    } catch (error) {
      throw new Error(`Failed to rename device: ${error.message}`);
    }
  }

  /**
   * Remove device
   * @param {string} deviceId - Device ID
   * @returns {boolean} True if removed
   */
  removeDeviceFromAccount(deviceId) {
    return this.datastore.removeDevice(deviceId);
  }

  /**
   * Parse timestamp string or return default
   * @param {string|number} timestamp - Timestamp
   * @returns {string} ISO string
   */
  parseTimestamp(timestamp) {
    try {
      if (typeof timestamp === 'string' && !isNaN(Number(timestamp))) {
        return new Date(parseInt(timestamp) * 1000).toISOString();
      }
      return DEFAULT_DATESTR;
    } catch {
      return DEFAULT_DATESTR;
    }
  }

  loginResponseXml(deviceId) {
    const accountId = this.datastore.getAccountIdForDeviceId(deviceId) || '8053210';
    const obj = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
      account: {
        '@_id': String(accountId),
        accountStatus: 'OK',
        mode: 'global',
        preferredLanguage: 'de',
      }
    };
    return this.builder.build(obj);
  }

  updateDeviceBoseId(deviceId, boseID, deviceInfo = {}, clientIp = null) {
    const isDigitsOnly = boseID && /^\d+$/.test(String(boseID));
    const effectiveBoseId = isDigitsOnly && String(boseID) !== '8053210' ? String(boseID) : undefined;
    if (deviceId) {
      const sysSerial = deviceInfo.systemSerialNumber || deviceInfo.sysSerial || deviceInfo.serialNumber || '';
      this.datastore.saveAccountMapping(deviceId, effectiveBoseId, sysSerial, clientIp || '');
    }
    let device = this.datastore.getDevice(deviceId);
    const now = new Date().toISOString();
    if (!device) {
      device = {
        deviceId,
        name: deviceInfo.deviceType || deviceInfo.name || `SoundTouch Speaker ${deviceId.slice(-4)}`,
        productCode: deviceInfo.deviceType || 'SoundTouch 20 sm2',
        serialNumber: deviceInfo.serialNumber || deviceId,
        systemSerialNumber: deviceInfo.systemSerialNumber || '',
        firmwareVersion: deviceInfo.softwareVersion || deviceInfo.firmwareVersion || '1.0.0',
        ipAddress: clientIp || '0.0.0.0',
        createdOn: now,
        updatedOn: now,
      };
      this.datastore.addDevice(deviceId, device);
      console.log(`[SYSTEM] Auto-registered device from scmudc telemetry: ${deviceId} (IP: ${clientIp})`);
    } else {
      let changed = false;
      if (deviceInfo.deviceType && device.productCode !== deviceInfo.deviceType) {
        device.productCode = deviceInfo.deviceType;
        changed = true;
      }
      if (deviceInfo.serialNumber && device.serialNumber !== deviceInfo.serialNumber) {
        device.serialNumber = deviceInfo.serialNumber;
        changed = true;
      }
      if (deviceInfo.systemSerialNumber && device.systemSerialNumber !== deviceInfo.systemSerialNumber) {
        device.systemSerialNumber = deviceInfo.systemSerialNumber;
        changed = true;
      }
      const swVersion = deviceInfo.softwareVersion || deviceInfo.firmwareVersion;
      if (swVersion && device.firmwareVersion !== swVersion) {
        device.firmwareVersion = swVersion;
        changed = true;
      }
      if (clientIp && clientIp !== '0.0.0.0' && device.ipAddress !== clientIp) {
        device.ipAddress = clientIp;
        changed = true;
      }
      if (changed) {
        device.updatedOn = now;
        this.datastore.saveDeviceInfo(deviceId, device);
        console.log(`[SYSTEM] Updated details for device ${deviceId} (IP: ${device.ipAddress})`);
      }
    }
  }

  sourceProvidersToXml() {
    try {
      const filePath = path.join(__dirname, 'resources', 'sourceproviders.xml');
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8').trim();
      }
    } catch (e) {
      console.error('[Service] Error reading sourceproviders.xml:', e.message);
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sourceProviders></sourceProviders>';
  }

  sourcesToXml(deviceId) {
    const obj = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
      sources: {
        source: [
          {
            '@_id': '112345',
            '@_type': 'Audio',
            createdOn: '2026-06-29T16:13:03.003+00:00',
            credential: { '@_type': '' },
            name: 'AUX',
            sourceproviderid: '9',
            sourcename: 'AUX IN',
            sourceSettings: '',
            updatedOn: '2026-06-29T16:13:03.003+00:00',
            username: 'AUX',
          },
          {
            '@_id': '112346',
            '@_type': 'Audio',
            createdOn: '2026-06-29T16:13:03.003+00:00',
            credential: { '@_type': 'token' },
            name: '',
            sourceproviderid: '2',
            sourcename: 'INTERNET RADIO',
            sourceSettings: '',
            updatedOn: '2026-06-29T16:13:03.003+00:00',
            username: '',
          },
          {
            '@_id': '112347',
            '@_type': 'Audio',
            createdOn: '2026-06-29T16:13:03.003+00:00',
            credential: { '@_type': 'token' },
            name: '',
            sourceproviderid: '11',
            sourcename: 'LOCAL_INTERNET RADIO',
            sourceSettings: '',
            updatedOn: '2026-06-29T16:13:03.003+00:00',
            username: '',
          },
          {
            '@_id': '112348',
            '@_type': 'Audio',
            createdOn: '2026-06-29T16:13:03.003+00:00',
            credential: { '@_type': 'token' },
            name: '',
            sourceproviderid: '25',
            sourcename: '',
            sourceSettings: '',
            updatedOn: '2026-06-29T16:13:03.003+00:00',
            username: '',
          }
        ]
      }
    };
    return this.builder.build(obj);
  }

  providerSettingsToXml(accountId) {
    try {
      const filePath = path.join(__dirname, 'resources', 'provider_settings.xml');
      if (fs.existsSync(filePath)) {
        const template = fs.readFileSync(filePath, 'utf8');
        return template.replace(/\{BOSE_ID\}/g, String(accountId)).trim();
      }
    } catch (e) {
      console.error('[Service] Error reading provider_settings.xml:', e.message);
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><providerSettings><providerSetting><boseId>${accountId}</boseId><keyName>ELIGIBLE_FOR_TRIAL</keyName><value>true</value><providerId>14</providerId></providerSetting></providerSettings>`;
  }

  deviceGroupToXml(accountId, deviceId, clientIp = null) {
    if (deviceId && accountId) {
      this.datastore.saveAccountMapping(deviceId, accountId, '', clientIp || '');
    }

    const obj = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
      group: {
        userDefinedName: '',
        masterDevice: '',
        members: ''
      }
    };
    return this.builder.build(obj);
  }

  softwareUpdateToXml(deviceId) {
    const obj = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
      software_update: {
        softwareUpdateLocation: '',
      }
    };
    return this.builder.build(obj);
  }

  recentToXml(recentData) {
    const now = new Date().toISOString();
    const sourceId = recentData.sourceid || 'STORED_MUSIC';
    const obj = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
      recent: {
        '@_id': '2239532516',
        contentItemType: recentData.contentItemType || 'stationurl',
        createdOn: now,
        lastplayedat: recentData.lastplayedat || now,
        location: recentData.location || '',
        name: recentData.name || '',
        source: {
          '@_id': sourceId,
          '@_type': 'Audio',
          createdOn: now,
          credential: { '@_type': 'token', '#text': '' },
          name: '',
          sourceproviderid: sourceId === 'STORED_MUSIC' ? '7' : '11',
          sourcename: sourceId,
          sourceSettings: '',
          updatedOn: now,
          username: '',
        },
        sourceid: sourceId,
        updatedOn: now,
      }
    };
    return this.builder.build(obj);
  }

  addRecentToAccount(deviceId, xmlData) {
    try {
      const parsed = this.parser.parse(xmlData);
      const recentData = parsed.recent;
      return this.recentToXml(recentData);
    } catch (error) {
      throw new Error(`Failed to process recent: ${error.message}`);
    }
  }

  powerOn(xmlData, fallbackIp) {
    try {
      const parsed = this.parser.parse(xmlData);
      
      let deviceData = {};
      let ipAddress = fallbackIp || '0.0.0.0';
      
      if (parsed.poweron) {
        deviceData = parsed.poweron.device || {};
        const diagnosticData = parsed.poweron['diagnostic-data'] || {};
        const landscape = diagnosticData['device-landscape'] || {};
        if (landscape['ip-address']) {
          ipAddress = landscape['ip-address'];
        }
      } else if (parsed['device-data']) {
        deviceData = parsed['device-data'].device || {};
        if (Array.isArray(deviceData)) {
          deviceData = deviceData[0] || {};
        }
      } else if (parsed.device) {
        deviceData = parsed.device;
      }
      
      const deviceId = deviceData['@_id'] || deviceData.id;

      if (!deviceId) {
        throw new Error('Missing device ID in poweron XML');
      }

      let device = this.datastore.getDevice(deviceId);
      const now = new Date().toISOString();
      
      if (!device) {
        device = {
          deviceId,
          name: deviceData.name || `SoundTouch Speaker ${deviceId.slice(-4)}`,
          productCode: (deviceData.product && deviceData.product['@_product_code']) || 'SoundTouch',
          serialNumber: deviceData.serialnumber || deviceId,
          firmwareVersion: deviceData['firmware-version'] || '1.0.0',
          ipAddress: ipAddress,
          createdOn: now,
          updatedOn: now,
        };
        this.datastore.addDevice(deviceId, device);
        console.log(`[SYSTEM] Auto-registered new device: ${deviceId} at ${ipAddress}`);
      } else {
        let changed = false;
        if (device.ipAddress !== ipAddress) {
          device.ipAddress = ipAddress;
          changed = true;
        }
        if (deviceData.serialnumber && device.serialNumber !== deviceData.serialnumber) {
          device.serialNumber = deviceData.serialnumber;
          changed = true;
        }
        if (deviceData['firmware-version'] && device.firmwareVersion !== deviceData['firmware-version']) {
          device.firmwareVersion = deviceData['firmware-version'];
          changed = true;
        }
        const prodCode = deviceData.product && deviceData.product['@_product_code'];
        if (prodCode && device.productCode !== prodCode) {
          device.productCode = prodCode;
          changed = true;
        }
        if (changed) {
          device.updatedOn = now;
          this.datastore.saveDeviceInfo(deviceId, device);
          console.log(`[SYSTEM] Updated details for device ${deviceId} (IP: ${ipAddress})`);
        }
      }

      // Ensure account mapping in datastore is updated upon power_on
      const sysSerial = (deviceData.product && deviceData.product.serialnumber) || deviceData.serialnumber || '';
      const accountId = this.datastore.getAccountIdForDeviceId(deviceId);
      this.datastore.saveAccountMapping(deviceId, accountId, sysSerial, ipAddress);

      return deviceId;
    } catch (error) {
      throw new Error(`Failed to handle power_on: ${error.message}`);
    }
  }
}

module.exports = SoundTouchService;
