const express = require('express');
const os = require('os');
const DataStore = require('./datastore');
const SoundTouchService = require('./service');
const { setupRoutes } = require('./routes');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

// Monkey-patch console.error to output in red in the terminal
const originalConsoleError = console.error;
console.error = (...args) => {
  const text = args.map(a => typeof a === 'object' ? (a.stack || JSON.stringify(a)) : String(a)).join(' ');
  const coloredText = text.startsWith('\x1b[31m') ? text : `${colors.red}${text}${colors.reset}`;
  originalConsoleError(coloredText);
};

const PORT = process.env.PORT || 8053;

/**
 * Normalize IP address to IPv4 format if possible.
 * @param {string} ip
 * @returns {string}
 */
function normalizeIp(ip) {
  if (!ip) return 'unknown';
  if (ip === '::1') return '127.0.0.1';
  if (ip.startsWith('::ffff:')) return ip.substring(7);
  return ip;
}

/**
 * Create and configure Express server
 * @returns {Express} Express app instance
 */
function createServer() {
  const app = express();

  // Middleware: Normalize URL path (collapse multiple slashes e.g. //media/... -> /media/...)
  app.use((req, res, next) => {
    if (req.url && req.url.includes('//')) {
      req.url = req.url.replace(/\/+/g, '/');
    }
    next();
  });

  // Middleware: parse request bodies (XML, JSON, plain text, and any content type)
  app.use(express.text({ type: ['application/xml', 'text/xml', 'application/vnd.bose.streaming-v1.2+xml', '*/xml', 'text/plain', 'text/*', '*/*'] }));
  app.use(express.json({ type: ['application/json', 'text/json', 'application/*+json'] }));

  // Middleware: Auto-parse JSON string body if present
  app.use((req, res, next) => {
    if (typeof req.body === 'string') {
      const trimmed = req.body.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          req.bodyParsedJson = JSON.parse(trimmed);
        } catch (e) {}
      }
    }
    next();
  });

  // Request logging middleware
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const method = req.method;
    const url = req.url;
    const ip = normalizeIp(req.ip || req.connection.remoteAddress);

    // Extract deviceId and accountId from headers or URL parameter
    let deviceId = req.headers['x-screamer-deviceid'] || req.headers['x-bose-device-id'];
    let accountId = undefined;

    // Check if header contains accountId instead of deviceId
    if (deviceId && /^\d+$/.test(deviceId) && deviceId.length < 12) {
      accountId = deviceId;
      deviceId = undefined;
    }

    // Try to extract from URL path
    const urlClean = url.split('?')[0];

    const accountMatch = urlClean.match(/\/account\/(\d+)/i);
    if (accountMatch) {
      accountId = accountMatch[1];
    }

    const deviceMatch = urlClean.match(/\/(?:device|devices|scmudc|stapp)\/([A-Fa-f0-9]{12})/i) || urlClean.match(/\/scmudc\/([A-Fa-f0-9]+)/i);
    if (deviceMatch) {
      deviceId = deviceMatch[1];
    }

    if (!deviceId && !accountId) {
      const match = urlClean.match(/\/(?:scmudc|stapp|account|devices)\/([A-Fa-f0-9]+)/i);
      if (match) {
        const id = match[1];
        if (/^\d+$/.test(id) && id.length < 12) {
          accountId = id;
        } else {
          deviceId = id;
        }
      }
    }

    const screamerId = req.headers['x-screamer-deviceid'] || 'none';
    const boseIdHeader = req.headers['x-bose-device-id'] || 'none';

    let extraInfo = '';
    if (deviceId && accountId) {
      extraInfo = `DeviceId (extracted): ${deviceId} | AccountId (extracted): ${accountId}`;
    } else if (deviceId) {
      extraInfo = `DeviceId (extracted): ${deviceId}`;
    } else if (accountId) {
      extraInfo = `AccountId (extracted): ${accountId}`;
    } else {
      extraInfo = `DeviceId (extracted): none`;
    }

    const logMsg = `[${timestamp}] 📥 Request: ${method} ${url} | from IP: ${ip} | ${extraInfo} | Headers: x-screamer-deviceid=${screamerId}, x-bose-device-id=${boseIdHeader}`;
    if (method === 'POST' || method === 'GET' || method === 'PUT') {
      console.log(`${colors.green}${logMsg}${colors.reset}`);
    } else {
      console.log(logMsg);
    }

    if (req.body && (method === 'POST' || method === 'PUT')) {
      const bodyStr = typeof req.body === 'string' ? req.body.trim() : JSON.stringify(req.body);
      if (bodyStr.length > 0) {
        const bodyLog = `      Body (plain text): ${bodyStr.slice(0, 1000)}${bodyStr.length > 1000 ? '...' : ''}`;
        if (method === 'POST' || method === 'PUT') {
          console.log(`${colors.green}${bodyLog}${colors.reset}`);
        } else {
          console.log(bodyLog);
        }
      } else {
        const bodyLog = `      Body: (empty string)`;
        if (method === 'POST' || method === 'PUT') {
          console.log(`${colors.green}${bodyLog}${colors.reset}`);
        } else {
          console.log(bodyLog);
        }
      }
    } else if (method === 'POST' || method === 'PUT') {
      const bodyLog = `      Body: (null / undefined)`;
      if (method === 'POST' || method === 'PUT') {
        console.log(`${colors.green}${bodyLog}${colors.reset}`);
      } else {
        console.log(bodyLog);
      }
    }

    const originalSend = res.send;
    res.send = function (body) {
      console.log(`${colors.blue}[${timestamp}] 📤 Response: ${res.statusCode} for ${method} ${url}${colors.reset}`);
      return originalSend.apply(this, arguments);
    };

    next();
  });

  // Initialize datastore and service
  const datastore = new DataStore();
  const service = new SoundTouchService(datastore);

  // Setup all routes
  setupRoutes(app, service);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 404 handler for unknown routes
  app.use((req, res) => {
    const timestamp = new Date().toISOString();
    const method = req.method;
    const url = req.url;
    const ip = normalizeIp(req.ip || req.connection.remoteAddress);
    const bodyStr = typeof req.body === 'string' ? req.body.trim() : JSON.stringify(req.body || '');

    console.warn(`${colors.yellow}[${timestamp}] ⚠️ Unknown route requested: ${method} ${url} | IP: ${ip}${colors.reset}`);
    if (bodyStr) {
      console.warn(`${colors.yellow}      Body: ${bodyStr.slice(0, 500)}${colors.reset}`);
    }

    if (url.startsWith('/bmx')) {
      res.status(404).json({
        fault: {
          faultstring: `Unable to identify proxy for host: content and url: ${url}`,
          detail: {
            errorcode: "messaging.adaptors.http.flow.ApplicationNotFound"
          }
        }
      });
    } else {
      res.status(404)
        .type('application/xml')
        .send('<?xml version="1.0"?><error>Not found</error>');
    }
  });

  return app;
}

/**
 * Get local IPv4 addresses (non-internal/non-loopback)
 * @returns {string[]} Array of local IPv4 addresses
 */
function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function startServer() {
  const app = createServer();

  const server = app.listen(PORT, () => {
    console.log('🎵 SoundTouch Backend started');
    console.log(`   Server on http://localhost:${PORT}`);
    const os = require('os');
    const hostname = os.hostname();
    if (hostname) {
      console.log(`   Hostname on http://${hostname.toLowerCase()}.local:${PORT}`);
      console.log(`   Hostname on http://${hostname.toLowerCase()}.fritz.box:${PORT}`);
    }
    const localIps = getLocalIps();
    for (const ip of localIps) {
      console.log(`   Network on http://${ip}:${PORT}`);
      console.log(`   Health check: http://${ip}:${PORT}/health`);
    }
    console.log('');

    // Perform check of endpoints availability
    setTimeout(async () => {
      const urlsToCheck = [];
      if (hostname) {
        urlsToCheck.push(`http://${hostname.toLowerCase()}.local:${PORT}/health`);
        urlsToCheck.push(`http://${hostname.toLowerCase()}.fritz.box:${PORT}/health`);
      }
      for (const ip of localIps) {
        urlsToCheck.push(`http://${ip}:${PORT}/health`);
      }

      const dns = require('dns').promises;
      const net = require('net');

      console.log('🔍 Checking endpoint availability (200ms timeout):');
      for (const url of urlsToCheck) {
        const hostnameToCheck = new URL(url).hostname;
        const isIp = net.isIP(hostnameToCheck);
        let nameResolves = true;

        if (!isIp) {
          try {
            await dns.resolve4(hostnameToCheck);
          } catch (err) {
            nameResolves = false;
          }
        }

        let result;
        if (nameResolves) {
          result = await checkHealth(url, 200);
        } else {
          result = { success: false, error: 'ENOTFOUND' };
        }

        if (result.success) {
          console.log(`   ✅ ${url} is available`);
        } else {
          console.log(`   ❌ ${url} is NOT available (${result.error})`);
        }
      }
      console.log('');
    }, 100);
  });

  server.on('error', (error) => {
    if (error.code === 'EACCES') {
      console.error(`\n❌ [ERROR] Port ${PORT} requires administrator privileges.`);
    } else if (error.code === 'EADDRINUSE') {
      console.error(`\n❌ [ERROR] Port ${PORT} is already in use by another process.`);
    } else {
      console.error('Server error:', error);
    }
  });
}

function checkHealth(url, timeoutMs = 200) {
  const http = require('http');
  return new Promise((resolve) => {
    let resolved = false;
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      resolved = true;
      if (res.statusCode === 200) {
        resolve({ url, success: true });
      } else {
        resolve({ url, success: false, error: `Status ${res.statusCode}` });
      }
    });

    req.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        resolve({ url, success: false, error: err.code || err.message });
      }
    });

    req.on('timeout', () => {
      req.destroy();
      if (!resolved) {
        resolved = true;
        resolve({ url, success: false, error: 'Timeout (200ms)' });
      }
    });
  });
}

// Export for testing
module.exports = { createServer, startServer };

// Run if executed directly
if (require.main === module) {
  startServer();
}
