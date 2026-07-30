const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const { exec } = require('child_process');

// Keep global references
let mainWindow = null;

const PORT = 8053;

// Monkey-patch console to redirect logs to Electron window
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function sendLogToWindow(type, text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-log', { type, text });
  }
}

function sendFirewallStatusToWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('firewall-status', firewallStatus);
  }
}

console.log = (...args) => {
  const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  originalLog.apply(console, args);
  sendLogToWindow('log', text);
};
console.warn = (...args) => {
  const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  originalWarn.apply(console, args);
  sendLogToWindow('warn', text);
};
console.error = (...args) => {
  const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  originalError.apply(console, args);
  sendLogToWindow('error', text);
};

// Start Express Server
const { startServer } = require('./src/server');

function createElectronWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 1024,
    title: "BASSS Desktop",
    icon: path.join(__dirname, 'media', 'basss-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    },
    darkTheme: true,
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

  // Open external links in default system browser
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      event.preventDefault();
      require('electron').shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

let firewallStatus = { status: 'checking', message: 'Checking...' };

function checkAndSetupFirewall(port, isRetry = false) {
  const platform = process.platform;

  if (platform === 'win32') {
    exec('netsh advfirewall firewall show rule name="DST"', (err, stdout) => {
      const dstRuleExists = !err && stdout && stdout.includes('DST');

      exec(`netsh advfirewall firewall show rule name=all | findstr ${port}`, (err2, stdout2) => {
        const portRuleExists = !err2 && stdout2 && stdout2.includes(String(port));

        if (dstRuleExists || portRuleExists) {
          firewallStatus = { status: 'allowed', message: `Port ${port}` };
          sendFirewallStatusToWindow();
          console.log(`[Firewall] Port ${port} is allowed by Windows Firewall rule.`);
        } else {
          if (isRetry) {
            console.log(`[Firewall] Port ${port} is still blocked after requesting permission.`);
            firewallStatus = { status: 'blocked', message: `Port ${port} (Blocked)` };
            sendFirewallStatusToWindow();
            return;
          }

          console.log(`[Firewall] Port ${port} is not explicitly allowed in Windows Firewall. Showing confirmation dialog...`);
          firewallStatus = { status: 'blocked', message: `Port ${port} (Blocked)` };
          sendFirewallStatusToWindow();

          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Firewall-Freigabe erforderlich',
            message: `Der Port ${port} ist in der Windows-Firewall nicht freigegeben.`,
            detail: `Im nächsten Schritt wird die Erlaubnis angefordert, um den Port ${port} für lokale Verbindungen freizugeben. Bitte bestätige den folgenden Windows-Systemdialog, damit deine SoundTouch mit dieser App kommunizieren darf.`,
            buttons: ['Verstanden', 'Abbrechen']
          }).then((result) => {
            if (result.response === 0) { // 'Verstanden'
              const psCommand = `Start-Process powershell -ArgumentList '-NoProfile -Command New-NetFirewallRule -DisplayName DST -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Profile Private,Domain' -Verb RunAs -Wait`;
              exec(`powershell -Command "${psCommand}"`, (err3) => {
                if (err3) {
                  console.error('[Firewall] Windows Firewall rule request failed or denied:', err3.message);
                }
                // Immediately check again after UAC prompt is closed
                checkAndSetupFirewall(port, true);
              });
            } else {
              console.log('[Firewall] User canceled Windows Firewall permission request.');
              firewallStatus = { status: 'blocked', message: `Port ${port} (Canceled)` };
              sendFirewallStatusToWindow();
            }
          });
        }
      });
    });
  } else if (platform === 'darwin') {
    exec('/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate', (err, stdout) => {
      if (err) {
        firewallStatus = { status: 'error', message: 'Error checking macOS FW' };
        sendFirewallStatusToWindow();
        return;
      }

      const enabled = stdout && stdout.toLowerCase().includes('enabled');
      if (!enabled) {
        firewallStatus = { status: 'disabled', message: `Port ${port}` };
        sendFirewallStatusToWindow();
        console.log('[Firewall] macOS Firewall is disabled.');
      } else {
        const appPath = process.execPath;
        exec(`/usr/libexec/ApplicationFirewall/socketfilterfw --getappblocked "${appPath}"`, (err2, stdout2) => {
          const isBlocked = !err2 && stdout2 && stdout2.toLowerCase().includes('is blocked');

          if (!isBlocked) {
            firewallStatus = { status: 'allowed', message: `Port ${port}` };
            sendFirewallStatusToWindow();
            console.log('[Firewall] Application is not blocked by macOS Firewall.');
          } else {
            if (isRetry) {
              console.log('[Firewall] Application is still blocked by macOS Firewall after unblock request.');
              firewallStatus = { status: 'blocked', message: `Port ${port} (Blocked)` };
              sendFirewallStatusToWindow();
              return;
            }

            console.log('[Firewall] Application is blocked by macOS Firewall. Showing confirmation dialog...');
            firewallStatus = { status: 'blocked', message: `Port ${port} (Blocked)` };
            sendFirewallStatusToWindow();

            dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: 'Firewall-Freigabe erforderlich',
              message: 'Die App ist in der macOS-Firewall blockiert.',
              detail: 'Im nächsten Schritt wird die Administrator-Freigabe angefordert, um eingehende Verbindungen für deine Bose-Box zuzulassen. Bitte bestätige den folgenden Systemdialog.',
              buttons: ['Verstanden', 'Abbrechen']
            }).then((result) => {
              if (result.response === 0) { // 'Verstanden'
                const macCommand = `osascript -e 'do shell script "/usr/libexec/ApplicationFirewall/socketfilterfw --add \\"${appPath}\\" && /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp \\"${appPath}\\"" with administrator privileges'`;
                exec(macCommand, (err3) => {
                  if (err3) {
                    console.error('[Firewall] Failed or denied macOS Firewall unblock request:', err3.message);
                  }
                  // Immediately check again after password prompt is closed
                  checkAndSetupFirewall(port, true);
                });
              } else {
                console.log('[Firewall] User canceled macOS Firewall unblock request.');
                firewallStatus = { status: 'blocked', message: `Port ${port} (Canceled)` };
                sendFirewallStatusToWindow();
              }
            });
          }
        });
      }
    });
  } else {
    firewallStatus = { status: 'disabled', message: `Port ${port}` };
    sendFirewallStatusToWindow();
  }
}

app.whenReady().then(() => {
  // Start the Express server
  try {
    startServer();
    console.log('✅ Express Backend Server loaded successfully inside Electron Main Process.');
  } catch (err) {
    console.error('❌ Express server startup failed inside Electron:', err.message);
  }

  createElectronWindow();

  // Perform cross-platform firewall check and setup after window loads
  setTimeout(() => {
    checkAndSetupFirewall(PORT);
  }, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createElectronWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Get current server settings and active IPs
ipcMain.handle('get-server-status', async () => {
  const { getLocalIpv4s } = require('./src/discovery');
  const localIps = getLocalIpv4s();
  const hostname = os.hostname();

  const endpoints = [];
  if (hostname) {
    endpoints.push({ name: `${hostname.toLowerCase()}.local`, url: `http://${hostname.toLowerCase()}.local:${PORT}/health` });
    endpoints.push({ name: `${hostname.toLowerCase()}.fritz.box`, url: `http://${hostname.toLowerCase()}.fritz.box:${PORT}/health` });
  }
  localIps.forEach(ip => {
    endpoints.push({ name: ip, url: `http://${ip}:${PORT}/health` });
  });

  const dns = require('dns').promises;
  const net = require('net');

  const checks = endpoints.map(async (ep) => {
    const isIp = net.isIP(ep.name);
    let nameResolves = true;

    if (!isIp) {
      try {
        await dns.resolve4(ep.name);
      } catch (err) {
        nameResolves = false;
      }
    }

    let available = false;
    if (nameResolves) {
      const status = await checkHealthLocal(ep.url, 200);
      available = status.success;
    }

    return {
      name: ep.name,
      available
    };
  });

  const results = await Promise.all(checks);

  return {
    running: true,
    port: PORT,
    localIps,
    hostname,
    results,
    firewall: firewallStatus
  };
});

// Read statsServerUrl from device via telnet if available and copy persistence
function readStatsServerFromTelnet(ip) {
  return new Promise((resolve) => {
    const net = require('net');
    const client = new net.Socket();
    let sessionData = '';
    let step = 0;
    let statsServerUrl = null;

    let timer = setTimeout(() => {
      client.destroy();
      resolve({ statsServerUrl });
    }, 10000); // 10 seconds timeout for extra reliability

    client.connect(23, ip, () => {
      // TCP connection established
    });

    client.on('data', (data) => {
      const chunk = data.toString();
      sessionData += chunk;

      if (step === 0 && (sessionData.toLowerCase().includes('login:') || sessionData.toLowerCase().includes('username:'))) {
        client.write('root\r\n');
        sessionData = '';
        step = 1;
      }
      else if (step === 1 && sessionData.includes('#')) {
        client.write('cat /mnt/nv/OverrideSdkPrivateCfg.xml\r\n');
        sessionData = '';
        step = 2;
      }
      else if (step === 2 && sessionData.includes('#')) {
        // Parse statsServerUrl from XML file output
        const match = sessionData.match(/<statsServerUrl>(.*?)<\/statsServerUrl>/i);
        if (match && match[1]) {
          statsServerUrl = match[1].trim();
        }

        // Copy SystemConfigurationDB.xml to SystemConfiguration.xml (WITHOUT .bak, no sync)
        client.write('cp /mnt/nv/BoseApp-Persistence/1/SystemConfigurationDB.xml /mnt/nv/SystemConfigurationDB.xml\r\n');
        sessionData = '';
        step = 3;
      }
      else if (step === 3 && sessionData.includes('#')) {
        client.destroy();
        clearTimeout(timer);
        resolve({ statsServerUrl });
      }
    });

    client.on('error', () => {
      clearTimeout(timer);
      client.destroy();
      resolve({ statsServerUrl });
    });

    client.on('close', () => {
      clearTimeout(timer);
      resolve({ statsServerUrl });
    });
  });
}

// Scan network
ipcMain.handle('scan-network', async () => {
  const { discoverBoseDevices } = require('./src/discovery');
  try {
    const devices = await discoverBoseDevices(3000);

    // Auto-save discovered devices to devices.json via routes API
    const http = require('http');
    for (const dev of devices) {
      // Fetch presets for this device from the physical speaker
      let presets = [];
      try {
        presets = await new Promise((resolve) => {
          const req = http.get(`http://${dev.ip}:8090/presets`, { timeout: 1500 }, (res) => {
            if (res.statusCode !== 200) {
              resolve([]);
              return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const { XMLParser } = require('fast-xml-parser');
                const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
                const parsed = parser.parse(data);
                const list = [];
                if (parsed && parsed.presets && parsed.presets.preset) {
                  let items = parsed.presets.preset;
                  if (!Array.isArray(items)) {
                    items = [items];
                  }
                  items.forEach(item => {
                    const id = item['@_id'];
                    if (id) {
                      const itemName = item.ContentItem ? item.ContentItem.itemName : null;
                      const location = item.ContentItem ? item.ContentItem['@_location'] : null;
                      const source = item.ContentItem ? item.ContentItem['@_source'] : null;
                      list.push({
                        id: String(id),
                        name: itemName || '',
                        type: 'stationurl',
                        url: location || ''
                      });
                    }
                  });
                }
                resolve(list);
              } catch (e) {
                resolve([]);
              }
            });
          });
          req.on('error', () => resolve([]));
          req.on('timeout', () => { req.destroy(); resolve([]); });
        });
      } catch (err) {
        console.warn(`Failed to fetch presets for ${dev.deviceId} during scan:`, err.message);
      }

      // Try to read server url via telnet if open
      let serverUrl = dev.margeUrl || undefined;
      let accountId = dev.accountId;
      if (dev.telnetAvailable) {
        try {
          const telnetInfo = await readStatsServerFromTelnet(dev.ip);
          if (telnetInfo && telnetInfo.statsServerUrl) {
            serverUrl = telnetInfo.statsServerUrl;
          }
        } catch (err) {
          console.warn(`Failed to read statsServerUrl via telnet for ${dev.deviceId}:`, err.message);
        }
      }

      await new Promise((resolve) => {
        const payload = JSON.stringify({
          deviceId: dev.deviceId,
          name: dev.name,
          ipAddress: dev.ip,
          productCode: dev.type,
          serialNumber: dev.serialNumber,
          systemSerialNumber: dev.systemSerialNumber || '',
          firmwareVersion: dev.firmwareVersion,
          presets,
          server: serverUrl,
          accountId: accountId
        });

        const req = http.request({
          hostname: 'localhost',
          port: PORT,
          path: '/api/devices',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (res) => {
          res.resume();
          resolve();
        });

        req.on('error', () => resolve());
        req.write(payload);
        req.end();
      });
    }

    return devices;
  } catch (err) {
    console.error('Network scan failed:', err.message);
    throw err;
  }
});

// Get emulation data (accounts, devices, presets)
ipcMain.handle('get-emulation-data', async () => {
  return new Promise((resolve, reject) => {
    const http = require('http');
    http.get(`http://localhost:${PORT}/api/store`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', err => reject(err));
  });
});


// Generate Override Config XML File
ipcMain.handle('generate-override-file', async (event, { targetHost }) => {
  const port = PORT; // Use running backend server port automatically!
  const templatePath = path.join(__dirname, 'src/resources/OverrideSdkPrivateCfg.xml');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found at ${templatePath}`);
  }
  let xmlContent = fs.readFileSync(templatePath, 'utf8');
  xmlContent = xmlContent.replace(/\{server\}/g, `http://${targetHost}:${port}`);

  const filePath = path.join(__dirname, 'OverrideSdkPrivateCfg.xml');
  fs.writeFileSync(filePath, xmlContent, 'utf8');
  return { filePath, xmlContent, host: targetHost };
});

// Deploy Override XML via Telnet
ipcMain.handle('deploy-override', async (event, { targetIp, deviceId, name, type }) => {
  const overridePath = path.join(__dirname, 'OverrideSdkPrivateCfg.xml');
  const sysConfigTemplatePath = path.join(__dirname, 'src/resources/SystemConfiguration.xml');

  if (!fs.existsSync(overridePath)) {
    throw new Error("Override configuration file not found. Please generate it first.");
  }
  if (!fs.existsSync(sysConfigTemplatePath)) {
    throw new Error(`SystemConfiguration.xml template not found at ${sysConfigTemplatePath}`);
  }

  // Generate random 7-digit accountId
  const accountId = String(Math.floor(1000000 + Math.random() * 9000000));

  // Load and populate SystemConfiguration.xml template
  let sysConfigXml = fs.readFileSync(sysConfigTemplatePath, 'utf8');
  sysConfigXml = sysConfigXml
    .replace(/\{name\}/g, name)
    .replace(/\{accountId\}/g, accountId);

  // Write SystemConfiguration.xml to the main directory
  const sysConfigPath = path.join(__dirname, 'SystemConfiguration.xml');
  fs.writeFileSync(sysConfigPath, sysConfigXml, 'utf8');

  const overrideXml = fs.readFileSync(overridePath, 'utf8');

  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let sessionData = '';
    let step = 0;

    const sendProgress = (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deploy-progress', msg);
      }
    };

    sendProgress(`🔌 Connecting to speaker on ${targetIp}:23...`);

    client.connect(23, targetIp, () => {
      sendProgress('✅ Connected! Waiting for login prompt...');
    });

    client.on('data', (data) => {
      const chunk = data.toString();
      sessionData += chunk;

      // Step 0: Login
      if (step === 0 && (sessionData.toLowerCase().includes('login:') || sessionData.toLowerCase().includes('username:'))) {
        sendProgress('👤 Logging in as root...');
        client.write('root\r\n');
        sessionData = '';
        step = 1;
      }
      // Step 1: Backup original SystemConfigurationDB.xml on speaker
      else if (step === 1 && sessionData.includes('#')) {
        sendProgress('📂 Backing up original SystemConfigurationDB.xml on speaker to /mnt/nv/SystemConfiguration.xml...');
        client.write('cp /mnt/nv/BoseApp-Persistence/1/SystemConfigurationDB.xml /mnt/nv/SystemConfiguration.xml\r\n');
        sessionData = '';
        step = 2;
      }
      // Step 2: Write OverrideSdkPrivateCfg.xml
      else if (step === 2 && sessionData.includes('#')) {
        sendProgress('📝 Writing OverrideSdkPrivateCfg.xml to speaker (/mnt/nv/)...');
        client.write("cat << 'EOF' > /mnt/nv/OverrideSdkPrivateCfg.xml\r\n");
        client.write(overrideXml);
        client.write('\r\nEOF\r\n');
        sessionData = '';
        step = 3;
      }
      // Step 3: Write populated SystemConfigurationDB.xml
      else if (step === 3 && sessionData.includes('#')) {
        sendProgress('📝 Writing new SystemConfigurationDB.xml to speaker (/mnt/nv/BoseApp-Persistence/1/)...');
        client.write("cat << 'EOF' > /mnt/nv/BoseApp-Persistence/1/SystemConfigurationDB.xml\r\n");
        client.write(sysConfigXml);
        client.write('\r\nEOF\r\n');
        sessionData = '';
        step = 4;
      }
      // Step 4: Reboot
      else if (step === 4 && sessionData.includes('#')) {
        sendProgress('🔄 Files written successfully! Sending reboot command to speaker...');
        client.write('reboot\r\n');
        step = 5;

        setTimeout(() => {
          sendProgress('🔌 Connection closed. The speaker is now rebooting!');
          client.destroy();

          // Save server IP and newly generated accountId to devices.json
          const http = require('http');

          let serverHost = '127.0.0.1';
          const hostMatch = overrideXml.match(/<statsServerUrl>http:\/\/([^:]+):/);
          if (hostMatch && hostMatch[1]) {
            serverHost = hostMatch[1];
          }

          const postData = JSON.stringify({
            serverIp: serverHost,
            name,
            type,
            accountId
          });

          const req = http.request({
            hostname: 'localhost',
            port: PORT,
            path: `/api/devices/${deviceId}/modify`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          }, (res) => {
            resolve({ status: 'ok' });
          });
          req.on('error', (e) => {
            console.error('Failed to update devices mapping:', e.message);
            resolve({ status: 'ok' }); // still resolve ok, as telnet completed
          });
          req.write(postData);
          req.end();
        }, 1500);
      }
    });

    client.on('error', (err) => {
      sendProgress(`❌ Connection error: ${err.message}`);
      client.destroy();
      reject(err);
    });

    client.on('close', () => {
      if (step < 5) {
        sendProgress('🔌 Connection closed prematurely.');
        reject(new Error('Connection closed prematurely'));
      }
    });
  });
});

function checkHealthLocal(url, timeoutMs = 200) {
  const http = require('http');
  return new Promise((resolve) => {
    let resolved = false;
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      resolved = true;
      if (res.statusCode === 200) {
        resolve({ success: true });
      } else {
        resolve({ success: false });
      }
    });

    req.on('error', () => {
      if (!resolved) {
        resolved = true;
        resolve({ success: false });
      }
    });

    req.on('timeout', () => {
      req.destroy();
      if (!resolved) {
        resolved = true;
        resolve({ success: false });
      }
    });
  });
}

// IPC Handlers for Radio Browser Favorites

async function getRadioBrowserServers() {
  const dns = require('dns').promises;
  const fallbackServers = [
    'de1.api.radio-browser.info',
    'at1.api.radio-browser.info',
    'nl1.api.radio-browser.info',
    'fr1.api.radio-browser.info'
  ];

  try {
    const addresses = await dns.resolveSrv('_api._tcp.radio-browser.info');
    if (addresses && addresses.length > 0) {
      return addresses
        .map(a => a.name)
        .sort(() => Math.random() - 0.5);
    }
  } catch (err) {
    // DNS SRV resolution is optional; silence warning to keep logs clean
  }

  return fallbackServers.sort(() => Math.random() - 0.5);
}

function fetchJson(url, options = {}) {
  const https = require('https');
  const { URL } = require('url');
  
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'BASSS-Desktop/1.1.0 (https://github.com/hxmelab/basss)',
        'Accept': 'application/json',
        ...(options.headers || {})
      },
      timeout: options.timeout || 4000
    };

    const req = https.get(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.trim().substring(0, 100)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON Parse Error: ${e.message} (Raw: ${data.trim().substring(0, 100)})`));
        }
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

function getFavoritesPath() {
  const isPackaged = app.isPackaged;
  const dataDir = isPackaged 
    ? path.join(app.getPath('userData'), 'data') 
    : path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, 'favorites.json');
}

ipcMain.handle('add-favorite-by-uuid', async (event, uuid) => {
  const path = `/soundtouch/stations/byuuid/${uuid}`;
  
  let servers;
  try {
    servers = await getRadioBrowserServers();
  } catch (e) {
    servers = ['de1.api.radio-browser.info', 'at1.api.radio-browser.info'];
  }

  let stationData = null;
  let lastError = null;

  for (const server of servers) {
    const url = `https://${server}${path}`;
    try {
      stationData = await fetchJson(url);
      if (stationData) {
        console.log(`[RadioBrowser] Successfully fetched favorite from ${server}`);
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!stationData) {
    throw new Error(`Failed to retrieve station details from all available servers. Last error: ${lastError ? lastError.message : 'Unknown'}`);
  }

  try {
    let station = stationData;
    if (Array.isArray(stationData)) {
      station = stationData[0];
    }

    if (!station || !station.name) {
      throw new Error("Invalid station data returned from API");
    }

    const favoritesPath = getFavoritesPath();
    let favorites = {};
    if (fs.existsSync(favoritesPath)) {
      try {
        favorites = JSON.parse(fs.readFileSync(favoritesPath, 'utf8'));
      } catch (e) {
        favorites = {};
      }
    }

    favorites[uuid] = {
      uuid,
      name: station.name,
      streamType: station.streamType || 'liveRadio',
      audio: station.audio || {}
    };

    fs.writeFileSync(favoritesPath, JSON.stringify(favorites, null, 2), 'utf8');
    return { success: true, station: favorites[uuid] };
  } catch (err) {
    console.error('Failed to add favorite:', err.message);
    throw err;
  }
});

ipcMain.handle('get-favorites', async () => {
  const favoritesPath = getFavoritesPath();
  if (!fs.existsSync(favoritesPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(favoritesPath, 'utf8'));
  } catch (e) {
    return {};
  }
});

ipcMain.handle('delete-favorite', async (event, uuid) => {
  const favoritesPath = getFavoritesPath();
  if (!fs.existsSync(favoritesPath)) {
    return { success: true };
  }
  try {
    let favorites = JSON.parse(fs.readFileSync(favoritesPath, 'utf8'));
    if (favorites[uuid]) {
      delete favorites[uuid];
      fs.writeFileSync(favoritesPath, JSON.stringify(favorites, null, 2), 'utf8');
    }
    return { success: true };
  } catch (e) {
    throw e;
  }
});

// Helper to format IPv4 or IPv6 target host for HTTP requests
function formatTargetHost(ip) {
  if (!ip || typeof ip !== 'string' || ip === 'none' || ip === '0.0.0.0' || ip.trim() === '') {
    return null;
  }
  let clean = ip.trim().replace(/^["']|["']$/g, '');
  if (clean.includes(':')) {
    if (clean.startsWith('[') && clean.endsWith(']')) {
      return clean;
    }
    const safeIp = clean.replace(/%/g, '%25');
    return `[${safeIp}]`;
  }
  return clean;
}

// IPC Handlers for speaker preset reads/writes

ipcMain.handle('get-speaker-presets', async (event, targetIp) => {
  return new Promise((resolve) => {
    try {
      const host = formatTargetHost(targetIp);
      if (!host) {
        return resolve({ success: false, error: 'Invalid or missing IP address' });
      }
      const http = require('http');
      const req = http.get(`http://${host}:8090/presets`, { timeout: 1500 }, (res) => {
        if (res.statusCode !== 200) {
          resolve({ success: false, error: `Status ${res.statusCode}` });
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const { XMLParser } = require('fast-xml-parser');
            const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
            const parsed = parser.parse(data);
            const presetsList = {};
            if (parsed && parsed.presets && parsed.presets.preset) {
              let items = parsed.presets.preset;
              if (!Array.isArray(items)) {
                items = [items];
              }
              items.forEach(item => {
                const id = item['@_id'];
                if (id) {
                  const itemName = item.ContentItem ? item.ContentItem.itemName : null;
                  const location = item.ContentItem ? item.ContentItem['@_location'] : null;
                  const source = item.ContentItem ? item.ContentItem['@_source'] : null;
                  presetsList[id] = {
                    id,
                    name: itemName || 'Configured Preset',
                    location,
                    source
                  };
                }
              });
            }
            resolve({ success: true, presets: presetsList });
          } catch (e) {
            resolve({ success: false, error: `Parse error: ${e.message}` });
          }
        });
      });

      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Timeout' });
      });
    } catch (err) {
      resolve({ success: false, error: `Invalid URL: ${err.message}` });
    }
  });
});

ipcMain.handle('save-speaker-preset', async (event, { targetIp, presetId, name, location }) => {
  return new Promise((resolve, reject) => {
    try {
      const host = formatTargetHost(targetIp);
      if (!host) {
        return reject(new Error('Invalid or missing IP address'));
      }
      const http = require('http');

      const xmlPayload = `<preset id="${presetId}">
  <ContentItem source="LOCAL_INTERNET_RADIO" type="stationurl" location="${location}">
    <itemName>${name}</itemName>
  </ContentItem>
</preset>`;

      const req = http.request({
        hostname: host.startsWith('[') ? host.slice(1, -1) : host,
        port: 8090,
        path: '/storePreset',
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': Buffer.byteLength(xmlPayload)
        }
      }, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, status: res.statusCode, data: responseData });
          } else {
            reject(new Error(`Speaker returned status ${res.statusCode}: ${responseData}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(xmlPayload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
});

// USB Stick Folder Selection and File Writer
ipcMain.handle('select-usb-directory', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select USB Drive Root Directory',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('create-usb-file', async (event, folderPath) => {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(folderPath, 'remote_services');
  fs.writeFileSync(filePath, '', 'utf8');
  return filePath;
});

// IPC Handlers for speaker power, key trigger, volume, and bass control

ipcMain.handle('trigger-speaker-key', async (event, { targetIp, key }) => {
  return new Promise((resolve, reject) => {
    try {
      const host = formatTargetHost(targetIp);
      if (!host) {
        return reject(new Error('Invalid or missing IP address'));
      }
      const http = require('http');
      const state = (key === 'POWER' || key === 'MUTE') ? 'press' : 'release';
      const xml = `<key state="${state}" sender="Gabbo">${key}</key>`;

      const req = http.request({
        hostname: host.startsWith('[') ? host.slice(1, -1) : host,
        port: 8090,
        path: '/key',
        method: 'POST',
        timeout: 1500,
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': Buffer.byteLength(xml)
        }
      }, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`Speaker key returned status ${response.statusCode}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timed out'));
      });
      req.on('error', reject);
      req.write(xml);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
});

ipcMain.handle('get-speaker-state', async (event, targetIp) => {
  const host = formatTargetHost(targetIp);
  if (!host) {
    return { success: false, error: 'Invalid or missing IP address' };
  }
  const http = require('http');
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });

  const fetchEndpoint = (path) => {
    return new Promise((resolve) => {
      try {
        const req = http.get(`http://${host}:8090${path}`, { timeout: 1000 }, (res) => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      } catch {
        resolve(null);
      }
    });
  };

  try {
    const [nowPlayingXml, volumeXml, bassXml] = await Promise.all([
      fetchEndpoint('/now_playing'),
      fetchEndpoint('/volume'),
      fetchEndpoint('/bass')
    ]);

    if (!nowPlayingXml && !volumeXml && !bassXml) {
      return { success: false, error: 'Speaker unreachable (offline)' };
    }

    const state = {
      powerOn: false,
      volume: 30,
      bass: 0,
      muteEnabled: false
    };

    if (nowPlayingXml) {
      const parsed = parser.parse(nowPlayingXml);
      if (parsed && parsed.nowPlaying) {
        const np = parsed.nowPlaying;
        const source = np['@_source'] || '';
        state.powerOn = (source !== 'STANDBY');
        state.nowPlaying = {
          source,
          track: np.track || '',
          artist: np.artist || '',
          album: np.album || '',
          stationName: np.stationName || (np.ContentItem ? np.ContentItem.itemName : ''),
          playStatus: np.playStatus || ''
        };
      }
    }

    if (volumeXml) {
      const parsed = parser.parse(volumeXml);
      if (parsed && parsed.volume) {
        state.volume = parseInt(parsed.volume.actualvolume || parsed.volume.targetvolume || 30, 10);
        state.muteEnabled = (parsed.volume.muteenabled === 'true' || parsed.volume.muteenabled === true);
      }
    }

    if (bassXml) {
      const parsed = parser.parse(bassXml);
      if (parsed && parsed.bass) {
        state.bass = parseInt(parsed.bass.actualbass || parsed.bass.targetbass || 0, 10);
      }
    }

    return { success: true, state };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-speaker-volume', async (event, { targetIp, volume }) => {
  return new Promise((resolve, reject) => {
    try {
      const host = formatTargetHost(targetIp);
      if (!host) {
        return reject(new Error('Invalid or missing IP address'));
      }
      const http = require('http');
      const xml = `<volume>${volume}</volume>`;
      const req = http.request({
        hostname: host.startsWith('[') ? host.slice(1, -1) : host,
        port: 8090,
        path: '/volume',
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': Buffer.byteLength(xml)
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true });
          } else {
            reject(new Error(`Speaker volume status code ${res.statusCode}`));
          }
        });
      });
      req.on('error', reject);
      req.write(xml);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
});

ipcMain.handle('set-speaker-bass', async (event, { targetIp, bass }) => {
  return new Promise((resolve, reject) => {
    try {
      const host = formatTargetHost(targetIp);
      if (!host) {
        return reject(new Error('Invalid or missing IP address'));
      }
      const http = require('http');
      const xml = `<bass>${bass}</bass>`;
      const req = http.request({
        hostname: host.startsWith('[') ? host.slice(1, -1) : host,
        port: 8090,
        path: '/bass',
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': Buffer.byteLength(xml)
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true });
          } else {
            reject(new Error(`Speaker bass status code ${res.statusCode}`));
          }
        });
      });
      req.on('error', reject);
      req.write(xml);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
});

ipcMain.handle('check-telnet', async (event, ip) => {
  const { checkPort } = require('./src/discovery');
  try {
    const telnetAvailable = await checkPort(ip, 23);
    return { success: true, telnetAvailable };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
