const express = require('express');
const fs = require('fs');
const path = require('path');

/**
 * Setup all routes for the SoundTouch API (flat mapping, device ID == account ID)
 * @param {Express} app - Express app instance
 * @param {SoundTouchService} service - Service instance
 */
function setupRoutes(app, service) {
  // Automatically rewrite account param to speaker device ID from headers if present
  app.param('account', (req, res, next, account) => {
    const headerDeviceId = req.headers['x-screamer-deviceid'] || req.headers['x-bose-device-id'];
    if (headerDeviceId) {
      req.params.account = headerDeviceId;
    } else {
      const rawIp = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress;
      const clientIp = rawIp ? (rawIp.startsWith('::ffff:') ? rawIp.substring(7) : (rawIp === '::1' ? '127.0.0.1' : rawIp)) : '';
      const resolvedDeviceId = service.datastore.getDeviceIdForAccount(account, clientIp);
      if (resolvedDeviceId) {
        req.params.account = resolvedDeviceId;
      }
    }
    next();
  });

  /**
   * GET /account/:account
   * Get full account info with all devices and presets (backward compatibility)
   */
  app.get('/account/:account', (req, res) => {
    try {
      const { account } = req.params;
      const rawIp = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress;
      const clientIp = rawIp ? (rawIp.startsWith('::ffff:') ? rawIp.substring(7) : (rawIp === '::1' ? '127.0.0.1' : rawIp)) : '';
      const xml = service.accountFullXml(account, clientIp);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400)
        .type('application/xml')
        .send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  /**
   * POST /account/:account/devices
   * Add device to account (backward compatibility)
   */
  app.post('/account/:account/devices', (req, res) => {
    try {
      const { account } = req.params;
      const xmlData = req.body instanceof Buffer ? req.body.toString() : String(req.body);
      const { xml } = service.addDeviceToAccount(account, xmlData);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400)
        .type('application/xml')
        .send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  /**
   * PUT /account/:account/devices/:deviceId
   * Rename device (backward compatibility)
   */
  app.put('/account/:account/devices/:deviceId', (req, res) => {
    try {
      const { deviceId } = req.params;
      const xmlData = req.body instanceof Buffer ? req.body.toString() : String(req.body);
      const xml = service.renameDevice(deviceId, xmlData);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400)
        .type('application/xml')
        .send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  /**
   * DELETE /account/:account/devices/:deviceId
   * Remove device from account (backward compatibility)
   */
  app.delete('/account/:account/devices/:deviceId', (req, res) => {
    try {
      const { deviceId } = req.params;
      const success = service.removeDeviceFromAccount(deviceId);
      if (success) {
        res.type('application/xml').send('<?xml version="1.0"?><result>ok</result>');
      } else {
        res.status(404)
          .type('application/xml')
          .send('<?xml version="1.0"?><error>Device not found</error>');
      }
    } catch (error) {
      res.status(400)
        .type('application/xml')
        .send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  /**
   * GET /account/:account/devices/:deviceId/presets
   * Get all presets for a device (backward compatibility)
   */
  app.get('/account/:account/devices/:deviceId/presets', (req, res) => {
    try {
      const { deviceId } = req.params;
      const xml = service.presetsToXml(deviceId);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400)
        .type('application/xml')
        .send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  /**
   * POST /account/:account/devices/:deviceId/presets/:presetId
   * Add/Update preset on a device (backward compatibility)
   */
  app.post('/account/:account/devices/:deviceId/presets/:presetId', (req, res) => {
    try {
      const { deviceId, presetId } = req.params;
      const xmlData = req.body instanceof Buffer ? req.body.toString() : String(req.body);
      const xml = service.updatePreset(deviceId, presetId, xmlData);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400)
        .type('application/xml')
        .send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  /**
   * DELETE /account/:account/devices/:deviceId/presets/:presetId
   * Delete preset from a device (backward compatibility)
   */
  app.delete('/account/:account/devices/:deviceId/presets/:presetId', (req, res) => {
    try {
      const { deviceId, presetId } = req.params;
      service.deletePreset(deviceId, presetId);
      res.type('application/xml').send('<?xml version="1.0"?><result>ok</result>');
    } catch (error) {
      res.status(400)
        .type('application/xml')
        .send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  // ==========================================
  // BOSE MARGE STREAMING API ENDPOINTS
  // ==========================================

  app.post('/marge/streaming/account/login', (req, res) => {
    try {
      const deviceId = req.headers['x-screamer-deviceid'] || req.headers['x-bose-device-id'] || '1234567';
      const xml = service.loginResponseXml(deviceId);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400).type('application/xml').send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  app.get('/marge/streaming/account/:account/sources', (req, res) => {
    try {
      const xml = service.sourcesToXml(req.params.account);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400).type('application/xml').send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  app.get('/marge/streaming/sourceproviders', (req, res) => {
    try {
      const xml = service.sourceProvidersToXml();
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400).type('application/xml').send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  app.get('/marge/streaming/account/:account/device/:deviceId/presets', (req, res) => {
    try {
      const { deviceId } = req.params;
      const xml = service.presetsToXml(deviceId);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400).type('application/xml').send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  app.get([
    '/marge/streaming/account/:account/device/:deviceId/group',
    '/marge/streaming/account/:account/device/:deviceId/group/',
    '/marge/streaming/account/:account/group',
    '/marge/streaming/account/:account/group/'
  ], (req, res) => {
    try {
      const account = req.params.account;
      const deviceId = req.params.deviceId || req.headers['x-screamer-deviceid'] || req.headers['x-bose-device-id'];
      const rawIp = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress;
      const clientIp = rawIp ? (rawIp.startsWith('::ffff:') ? rawIp.substring(7) : (rawIp === '::1' ? '127.0.0.1' : rawIp)) : undefined;

      const xml = service.deviceGroupToXml(account, deviceId, clientIp);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400).type('application/xml').send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  app.put('/marge/streaming/account/:account/device/:deviceId/preset/:presetNumber', (req, res) => {
    try {
      const { deviceId, presetNumber } = req.params;
      const xmlData = req.body instanceof Buffer ? req.body.toString() : String(req.body);
      const xml = service.updatePreset(deviceId, presetNumber, xmlData);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400).type('application/xml').send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  app.delete('/marge/streaming/account/:account/device/:deviceId/preset/:presetNumber', (req, res) => {
    try {
      const { deviceId, presetNumber } = req.params;
      service.deletePreset(deviceId, presetNumber);
      res.type('application/xml').send('<?xml version="1.0"?><result>ok</result>');
    } catch (error) {
      res.status(400).type('application/xml').send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  /**
   * PUT /marge/streaming/account/:account/device/:deviceId
   * Rename device (Marge API)
   */
  app.put('/marge/streaming/account/:account/device/:deviceId', (req, res) => {
    try {
      const { deviceId } = req.params;
      const xmlData = req.body instanceof Buffer ? req.body.toString() : String(req.body);

      // 1. XML-Body parsen und den neuen Namen extrahieren
      const parsed = service.parser.parse(xmlData);
      const deviceData = parsed?.device;
      if (!deviceData || !deviceData.name) {
        throw new Error('Missing required field: name');
      }
      const newName = deviceData.name;

      // 2. Namen lokal updaten in devices.json
      const device = service.datastore.renameDevice(deviceId, newName);
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      // 3. Korrekte XML-Antwort zurückgeben (Standard-Status-XML)
      const obj = {
        '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
        status: {
          message: 'success',
          'status-code': '0'
        }
      };
      const xml = service.builder.build(obj);
      res.status(200).type('application/xml').send(xml);
    } catch (error) {
      res.status(400)
        .type('application/xml')
        .send(`<?xml version="1.0"?><status><message>${error.message}</message><status-code>4012</status-code></status>`);
    }
  });

  app.get('/marge/streaming/account/:account/provider_settings', (req, res) => {
    try {
      const xml = service.providerSettingsToXml(req.params.account);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400).type('application/xml').send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  app.get('/marge/streaming/software/update/account/:account', (req, res) => {
    try {
      const xml = service.softwareUpdateToXml(req.params.account);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400).type('application/xml').send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  app.get('/marge/streaming/account/:account/full', (req, res) => {
    try {
      const xml = service.accountFullXml(req.params.account);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400).type('application/xml').send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  app.post('/marge/streaming/account/:account/device/:deviceId/recent', (req, res) => {
    try {
      const { deviceId } = req.params;
      const xmlData = req.body instanceof Buffer ? req.body.toString() : String(req.body);
      const xml = service.addRecentToAccount(deviceId, xmlData);
      res.type('application/xml').send(xml);
    } catch (error) {
      res.status(400).type('application/xml').send(`<?xml version="1.0"?><error>${error.message}</error>`);
    }
  });

  app.post('/marge/streaming/support/power_on', (req, res) => {
    try {
      const xmlData = req.body instanceof Buffer ? req.body.toString() : String(req.body);
      const ip = req.ip || req.socket.remoteAddress || '0.0.0.0';
      const cleanIp = ip.startsWith('::ffff:') ? ip.substring(7) : (ip === '::1' ? '127.0.0.1' : ip);
      service.powerOn(xmlData, cleanIp);
      res.status(200).end();
    } catch (error) {
      res.status(400)
        .type('application/xml')
        .send(`<?xml version="1.0"?><status><message>${error.message}</message><status-code>4012</status-code></status>`);
    }
  });

  app.get(['/bmx', '/bmx/'], (req, res) => {
    res.status(404).json({
      fault: {
        faultstring: "Unable to identify proxy for host: content and url: \\/bmx\\/",
        detail: {
          errorcode: "messaging.adaptors.http.flow.ApplicationNotFound"
        }
      }
    });
  });

  app.get(['/marge', '/marge/'], (req, res) => {
    res.status(404).type('application/xml').send('<?xml version="1.0"?><error>Not Found</error>');
  });

  app.post(['/v1/scmudc/:deviceid', '/v1/scmudc/:deviceid/', '/v1/stapp/:deviceid', '/v1/stapp/:deviceid/'], (req, res) => {
    try {
      let bodyData = req.bodyParsedJson || req.body;
      if (typeof bodyData === 'string') {
        try { bodyData = JSON.parse(bodyData); } catch (e) {}
      } else if (Buffer.isBuffer(bodyData)) {
        try { bodyData = JSON.parse(bodyData.toString('utf8')); } catch (e) {}
      }

      const rawIp = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress;
      const clientIp = rawIp ? (rawIp.startsWith('::ffff:') ? rawIp.substring(7) : (rawIp === '::1' ? '127.0.0.1' : rawIp)) : undefined;

      const urlDeviceId = req.params.deviceid;

      let info = {};
      if (bodyData && typeof bodyData === 'object') {
        if (bodyData.payload && bodyData.payload.deviceInfo) {
          info = bodyData.payload.deviceInfo;
        } else if (bodyData.deviceInfo) {
          info = bodyData.deviceInfo;
        } else if (bodyData.payload && typeof bodyData.payload === 'object') {
          info = bodyData.payload;
        } else {
          info = bodyData;
        }
      }

      const deviceId = (info && (info.deviceID || info.deviceId || info.mac)) || urlDeviceId;
      const rawBoseId = info && (info.boseID || info.boseId || info.accountId || info.accountID || info.userId || info.user_id);
      
      // accountId must contain ONLY digits. Fall back to undefined if missing or contains non-digits to avoid overwriting with dummy fallback.
      const isDigitsOnly = rawBoseId && /^\d+$/.test(String(rawBoseId));
      const effectiveBoseId = isDigitsOnly ? String(rawBoseId) : undefined;

      console.log(`\x1b[32m[scmudc] Telemetry received for device ${deviceId} | Extracted boseID: ${rawBoseId || 'none'} -> accountId: ${effectiveBoseId || 'none'} | IP: ${clientIp}\x1b[0m`);

      if (deviceId) {
        service.updateDeviceBoseId(deviceId, effectiveBoseId, info, clientIp);
      }
    } catch (err) {
      console.error('[scmudc] Error parsing telemetry:', err.message);
    }
    res.status(200).send('null');
  });

  // ==========================================
  // BOSE BMX API ENDPOINTS
  // ==========================================

  app.get('/bmx/registry/v1/services', (req, res) => {
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    try {
      const filePath = path.join(__dirname, 'resources', 'bmx-services.json');
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const jsonStr = raw.replace(/\{BASE_URL\}/g, baseUrl);
        return res.json(JSON.parse(jsonStr));
      }
    } catch (e) {
      console.error('[Routes] Error loading bmx-services.json:', e.message);
    }

    res.json({
      askAgainAfter: 864000000,
      bmx_services: []
    });
  });

  app.get('/core02/svc-bmx-adapter-orion/prod/orion', (req, res) => {
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    res.json({
      askAdapter: false,
      assets: {
        color: '#000000',
        description: 'Local Internet Radio Emulation Service',
        icons: {
          defaultAlbumArt: `${baseUrl}/media/tunein-default-album-art.png`,
          largeSvg: `${baseUrl}/media/orion-monochrome.svg`,
          monochromePng: `${baseUrl}/media/orion-monochrome_v2.png`,
          monochromeSvg: `${baseUrl}/media/orion-monochrome.svg`,
          smallSvg: `${baseUrl}/media/orion-monochrome.svg`
        },
        name: 'Local Internet Radio'
      },
      baseUrl: `${baseUrl}/core02/svc-bmx-adapter-orion/prod/orion`,
      streamTypes: ['liveRadio'],
      authenticationModel: {
        anonymousAccount: {
          autoCreate: true,
          enabled: true
        }
      },
      id: {
        name: 'LOCAL_INTERNET_RADIO',
        value: 11
      }
    });
  });

  app.all(['/core02/svc-bmx-adapter-orion/prod/orion/token', '/token', '/v1/token'], (req, res) => {
    res.json({
      token: 'anonymous_token_8053210',
      expiresIn: 86400,
      tokenType: 'Bearer'
    });
  });

  app.get(['/core02/svc-bmx-adapter-orion/prod/orion/v1/navigate', '/v1/navigate'], (req, res) => {
    res.json({
      items: [],
      total: 0
    });
  });

  app.get('/core02/svc-bmx-adapter-orion/prod/orion/station', (req, res) => {
    try {
      let streamUrl = req.query.url;
      let name = 'Local Stream';
      let imageUrl = 'https://raw.githubusercontent.com/hxmelab/soundcork/main/assets/icon.png';

      if (req.query.data) {
        try {
          const dataBuffer = Buffer.from(req.query.data, 'base64');
          const decoded = JSON.parse(dataBuffer.toString('utf8'));
          if (decoded.streamUrl) streamUrl = decoded.streamUrl;
          if (decoded.name) name = decoded.name;
          if (decoded.imageUrl) imageUrl = decoded.imageUrl;
        } catch (e) {
          console.error('[Orion Station] Failed to parse data query param:', e.message);
        }
      }

      if (!streamUrl) {
        return res.status(400).json({ error: 'Missing stream url or data query parameter' });
      }

      res.json({
        _links: {
          self: {
            href: `/station?url=${encodeURIComponent(streamUrl)}`
          }
        },
        audio: {
          hasPlaylist: true,
          isRealtime: true,
          maxTimeout: 60,
          streamUrl: streamUrl,
          streams: [
            {
              bufferingTimeout: 20,
              connectingTimeout: 10,
              hasPlaylist: true,
              isRealtime: true,
              streamUrl: streamUrl
            }
          ]
        },
        imageUrl: imageUrl,
        isFavorite: false,
        name: name,
        streamType: 'liveRadio'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/discover', async (req, res) => {
    try {
      const { discoverBoseDevices } = require('./discovery');
      const devices = await discoverBoseDevices(3000);
      res.json(devices);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // JSON API for Electron Emulation Manager
  app.get('/api/store', (req, res) => {
    try {
      const store = service.datastore;
      const data = {
        devices: {},
        presets: {},
        accounts: {}
      };
      for (const [deviceId, device] of store.devices.entries()) {
        data.devices[deviceId] = device;
        if (device.accountId) {
          data.accounts[deviceId] = {
            deviceId,
            accountId: device.accountId,
            systemSerialNumber: device.systemSerialNumber || '',
            ip: device.ipAddress || '',
            updatedOn: device.updatedOn
          };
        }
      }
      for (const [deviceId, devicePresets] of store.presets.entries()) {
        data.presets[deviceId] = devicePresets;
      }
      
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/devices', (req, res) => {
    try {
      const body = (req.bodyParsedJson || (typeof req.body === 'object' && req.body)) || {};
      const { deviceId, name, account, ipAddress, productCode, serialNumber, firmwareVersion, presets, server, accountId, systemSerialNumber } = body;
      if (!deviceId || !name) {
        return res.status(400).json({ error: 'Missing deviceId or name' });
      }
      
      let device = service.datastore.getDevice(deviceId) || {};
      const finalServer = server !== undefined && server !== null ? server : device.server;
      const finalSystemSerialNumber = systemSerialNumber || device.systemSerialNumber || '';
      
      device = {
        ...device,
        deviceId,
        name,
        account: deviceId,
        ipAddress: ipAddress || device.ipAddress || '0.0.0.0',
        productCode: productCode || device.productCode || 'SoundTouch',
        serialNumber: serialNumber || device.serialNumber || deviceId,
        systemSerialNumber: finalSystemSerialNumber,
        accountId: accountId !== undefined ? accountId : (device.accountId || ''),
        firmwareVersion: firmwareVersion || device.firmwareVersion || '1.0.0',
        server: finalServer,
        updatedOn: new Date().toISOString()
      };
      
      if (accountId) {
        service.datastore.saveAccountMapping(deviceId, accountId, finalSystemSerialNumber || '', ipAddress || '');
      }
      
      service.datastore.addDevice(deviceId, device);
      if (presets && Array.isArray(presets)) {
        service.datastore.savePresets(deviceId, presets);
      }
      res.json({ status: 'ok', device });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/devices/:deviceId', (req, res) => {
    try {
      const { deviceId } = req.params;
      service.datastore.removeDevice(deviceId);
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/devices/:deviceId/modify', (req, res) => {
    try {
      const { deviceId } = req.params;
      const body = (req.bodyParsedJson || (typeof req.body === 'object' && req.body)) || {};
      const { serverIp, name, type, accountId } = body;
      let device = service.datastore.getDevice(deviceId);
      if (!device) {
        device = {
          deviceId,
          name: name || 'Discovered Speaker',
          productCode: type || 'SoundTouch',
          serialNumber: deviceId,
          firmwareVersion: '1.0.0',
          ipAddress: '0.0.0.0',
          createdOn: new Date().toISOString()
        };
      }
      if (serverIp !== undefined) device.server = serverIp;
      if (name !== undefined) device.name = name;
      if (type !== undefined) device.productCode = type;
      if (accountId !== undefined) device.accountId = accountId;
      device.updatedOn = new Date().toISOString();
      service.datastore.addDevice(deviceId, device);
      res.json({ status: 'ok', device });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/presets', (req, res) => {
    try {
      const body = (req.bodyParsedJson || (typeof req.body === 'object' && req.body)) || {};
      const { deviceId, presetId, name, location, sourceId } = body;
      if (!deviceId || !presetId || !name || !location) {
        return res.status(400).json({ error: 'Missing required preset fields' });
      }
      service.datastore.addPreset(deviceId, presetId, {
        id: parseInt(presetId, 10),
        name,
        location,
        sourceId: sourceId || 'STORED_MUSIC',
        type: 'stationurl',
        createdOn: new Date().toISOString(),
        updatedOn: new Date().toISOString()
      });
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/presets/:deviceId/:presetId', (req, res) => {
    try {
      const { deviceId, presetId } = req.params;
      service.datastore.removePreset(deviceId, presetId);
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/media/:filename', (req, res) => {
    const filename = path.basename(req.params.filename || '');
    const mediaDir = path.join(__dirname, '..', 'media');
    const filePath = path.join(mediaDir, filename);

    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }

    const lowerName = filename.toLowerCase();
    if (lowerName.includes('albumart') || lowerName.includes('album-art')) {
      const altPath = path.join(mediaDir, 'tunein-default-album-art.png');
      if (fs.existsSync(altPath)) return res.sendFile(altPath);
    }
    if (lowerName.includes('monochrome') && lowerName.endsWith('.png')) {
      const altPath = path.join(mediaDir, 'orion-monochrome_v2.png');
      if (fs.existsSync(altPath)) return res.sendFile(altPath);
    }
    if (lowerName.includes('monochrome') && lowerName.endsWith('.svg')) {
      const altPath = path.join(mediaDir, 'orion-monochrome.svg');
      if (fs.existsSync(altPath)) return res.sendFile(altPath);
    }

    if (lowerName.endsWith('.png')) {
      const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSU5EUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
      return res.type('image/png').send(pngBuffer);
    } else {
      return res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#000"/><text x="10" y="50" fill="#fff">Bose</text></svg>');
    }
  });
}

module.exports = { setupRoutes };
