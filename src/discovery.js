const dgram = require('dgram');
const http = require('http');
const net = require('net');
const os = require('os');
const { XMLParser } = require('fast-xml-parser');

/**
 * Get all active non-internal IPv4 interface addresses.
 * @returns {string[]} List of IPv4 addresses
 */
function getLocalIpv4s() {
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

/**
 * Sends SSDP M-SEARCH messages on all interfaces and collects responder IP addresses.
 * @param {number} timeoutMs 
 * @returns {Promise<string[]>} List of responder IP addresses
 */
function discoverIpsViaSsdp(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const localIps = getLocalIpv4s();
    const sockets = [];
    const ips = new Set();

    const ssdpQueries = [
      [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'MAN: "ssdp:discover"',
        'MX: 2',
        'ST: urn:schemas-bose-com:device:SoundTouch:1',
        '',
        ''
      ].join('\r\n'),
      [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'MAN: "ssdp:discover"',
        'MX: 2',
        'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
        '',
        ''
      ].join('\r\n'),
      [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'MAN: "ssdp:discover"',
        'MX: 2',
        'ST: ssdp:all',
        '',
        ''
      ].join('\r\n')
    ];

    for (const localIp of localIps) {
      try {
        const client = dgram.createSocket('udp4');
        sockets.push(client);

        client.on('message', (msg, rinfo) => {
          const response = msg.toString().toLowerCase();
          if (response.includes('bose') || response.includes('soundtouch') || response.includes('mediarenderer')) {
            ips.add(rinfo.address);
          }
        });

        client.on('error', () => {
          // Ignore socket errors
        });

        client.bind({ address: localIp, port: 0 }, () => {
          try {
            client.setMulticastInterface(localIp);
          } catch (e) {
            // Some interfaces do not support multicast routing settings
          }

          for (const query of ssdpQueries) {
            const message = Buffer.from(query);
            client.send(message, 0, message.length, 1900, '239.255.255.250', (err) => {
              // Ignore send errors
            });
          }
        });
      } catch (err) {
        // Ignore interface initialization errors
      }
    }

    setTimeout(() => {
      for (const socket of sockets) {
        try {
          socket.close();
        } catch (e) {}
      }
      resolve(Array.from(ips));
    }, timeoutMs);
  });
}

/**
 * Discovers IP addresses via mDNS queries on all interfaces.
 * @param {number} timeoutMs 
 * @returns {Promise<string[]>}
 */
function discoverIpsViaMdns(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const localIps = getLocalIpv4s();
    const sockets = [];
    const ips = new Set();
    let resolved = false;

    const queryBuf = Buffer.from([
      0x00, 0x00, // Transaction ID
      0x00, 0x00, // Flags
      0x00, 0x01, // Questions: 1
      0x00, 0x00, // Answer RRs: 0
      0x00, 0x00, // Authority RRs: 0
      0x00, 0x00, // Additional RRs: 0
      // Question Section
      0x0c, 0x5f, 0x73, 0x6f, 0x75, 0x6e, 0x64, 0x74, 0x6f, 0x75, 0x63, 0x68, // _soundtouch
      0x04, 0x5f, 0x74, 0x63, 0x70, // _tcp
      0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c, // local
      0x00, // terminator
      0x00, 0x0c, // QTYPE: PTR (12)
      0x00, 0x01  // QCLASS: IN (1)
    ]);

    for (const localIp of localIps) {
      try {
        const client = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        sockets.push(client);

        client.on('message', (msg, rinfo) => {
          const payload = msg.toString().toLowerCase();
          if (payload.includes('_soundtouch')) {
            ips.add(rinfo.address);
          }
        });

        client.on('error', () => {
          // If binding to 5353 fails, fallback to port 0 for this IP
          try { client.close(); } catch (e) {}
          if (resolved) return;

          try {
            const fallback = dgram.createSocket('udp4');
            sockets.push(fallback);
            fallback.on('message', (msg, rinfo) => {
              const payload = msg.toString().toLowerCase();
              if (payload.includes('_soundtouch')) {
                ips.add(rinfo.address);
              }
            });
            fallback.bind({ address: localIp, port: 0 }, () => {
              try {
                fallback.setMulticastInterface(localIp);
              } catch (e) {}
              fallback.send(queryBuf, 0, queryBuf.length, 5353, '224.0.0.251');
            });
          } catch (err2) {}
        });

        client.bind({ address: localIp, port: 5353 }, () => {
          try {
            client.addMembership('224.0.0.251', localIp);
          } catch (err) {
            // Join membership failed
          }
          try {
            client.setMulticastInterface(localIp);
          } catch (err) {}

          client.send(queryBuf, 0, queryBuf.length, 5353, '224.0.0.251', (err) => {
            // Ignore send errors
          });
        });
      } catch (err) {
        // Ignore initialization errors
      }
    }

    setTimeout(() => {
      resolved = true;
      for (const socket of sockets) {
        try {
          socket.close();
        } catch (e) {}
      }
      resolve(Array.from(ips));
    }, timeoutMs);
  });
}

/**
 * Checks if a specific port is open on a host.
 * @param {string} ip 
 * @param {number} port 
 * @param {number} timeout 
 * @returns {Promise<boolean>}
 */
function checkPort(ip, port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isOpen = false;

    socket.setTimeout(timeout);
    socket.connect(port, ip, () => {
      isOpen = true;
      socket.end();
    });

    socket.on('timeout', () => {
      socket.destroy();
    });

    socket.on('error', () => {
      socket.destroy();
    });

    socket.on('close', () => {
      resolve(isOpen);
    });
  });
}

/**
 * Scan a list of IP addresses for an open port with a concurrency limit.
 * @param {string[]} ips 
 * @param {number} port 
 * @param {number} concurrency 
 * @param {number} timeout 
 * @returns {Promise<string[]>} List of IPs where the port is open
 */
async function scanIpsForPort(ips, port, concurrency = 100, timeout = 1000) {
  const openIps = [];
  let index = 0;

  async function worker() {
    while (index < ips.length) {
      const ip = ips[index++];
      if (!ip) continue;
      const isOpen = await checkPort(ip, port, timeout);
      if (isOpen) {
        openIps.push(ip);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, ips.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return openIps;
}

/**
 * Generates all candidate IP addresses for the subnets of active local interfaces.
 * @returns {string[]}
 */
function getSubnetCandidates() {
  const localIps = getLocalIpv4s();
  const candidates = [];
  for (const ip of localIps) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      const subnetPrefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
      if (subnetPrefix === '127.0.0') continue;
      for (let i = 1; i <= 254; i++) {
        candidates.push(`${subnetPrefix}.${i}`);
      }
    }
  }
  return candidates;
}

/**
 * Scans local subnets for port 8090.
 * @param {number} timeoutMs 
 * @returns {Promise<string[]>} List of responder IP addresses
 */
async function discoverIpsViaSubnetScan(timeoutMs = 2500) {
  const candidates = getSubnetCandidates();
  // Concurrently scan port 8090 on all subnets
  return await scanIpsForPort(candidates, 8090, 100, 1000);
}

/**
 * Fetches the XML /info payload from a Bose device.
 * @param {string} ip 
 * @param {number} timeout 
 * @returns {Promise<string|null>}
 */
function fetchBoseInfo(ip, timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.get(`http://${ip}:8090/info`, { timeout }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data);
      });
    });

    req.on('error', () => {
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Discovers Bose SoundTouch devices on the local network.
 * @param {number} timeoutMs network listening time in ms
 * @returns {Promise<Object[]>} List of discovered Bose devices
 */
async function discoverBoseDevices(timeoutMs = 3000) {
  const [ssdpIps, mdnsIps, subnetIps] = await Promise.all([
    discoverIpsViaSsdp(timeoutMs),
    discoverIpsViaMdns(timeoutMs),
    discoverIpsViaSubnetScan()
  ]);
  const uniqueIps = Array.from(new Set([...ssdpIps, ...mdnsIps, ...subnetIps]));
  const devices = [];

  const promises = uniqueIps.map(async (ip) => {
    const xml = await fetchBoseInfo(ip);
    if (!xml) return;

    let deviceId = '';
    let name = 'Unknown';
    let type = 'Unknown';
    let serialNumber = '';
    let systemSerialNumber = '';
    let firmwareVersion = '1.0.0';
    let margeUrl = '';
    let accountId = '';

    try {
      const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
      const parsed = parser.parse(xml);
      if (parsed && parsed.info) {
        deviceId = parsed.info['@_deviceID'] || '';
        name = parsed.info.name || 'Unknown';
        type = parsed.info.type || 'Unknown';
        accountId = parsed.info.margeAccountUUID || '';
        
        let rawMarge = parsed.info.margeURL || '';
        if (rawMarge) {
          margeUrl = rawMarge.trim().replace(/\/marge\/?$/i, '');
        }
        
        // Safely parse serial number and firmware from components
        if (parsed.info.components && parsed.info.components.component) {
          const comp = parsed.info.components.component;
          if (Array.isArray(comp)) {
            const scm = comp.find(c => c.componentCategory === 'SCM');
            if (scm) {
              serialNumber = scm.serialNumber || '';
              firmwareVersion = scm.softwareVersion || '1.0.0';
            }
            const prod = comp.find(c => c.componentCategory === 'PackagedProduct');
            if (prod) {
              systemSerialNumber = prod.serialNumber || '';
            }
            // Fallback for serialNumber if SCM category is missing
            if (!serialNumber && comp[0]) {
              serialNumber = comp[0].serialNumber || '';
              firmwareVersion = comp[0].softwareVersion || '1.0.0';
            }
          } else {
            serialNumber = comp.serialNumber || '';
            firmwareVersion = comp.softwareVersion || '1.0.0';
            if (comp.componentCategory === 'PackagedProduct') {
              systemSerialNumber = comp.serialNumber || '';
            }
          }
        }
      }
    } catch (err) {
      // XML parse error
    }

    const telnetAvailable = await checkPort(ip, 23);

    devices.push({
      ip,
      deviceId,
      name,
      type,
      telnetAvailable,
      serialNumber: serialNumber || deviceId,
      systemSerialNumber: systemSerialNumber || serialNumber || '',
      accountId: accountId && accountId !== '0' ? String(accountId) : '',
      margeUrl: margeUrl || '',
      firmwareVersion
    });
  });

  await Promise.all(promises);
  return devices;
}

module.exports = {
  discoverBoseDevices,
  discoverIpsViaSsdp,
  discoverIpsViaMdns,
  discoverIpsViaSubnetScan,
  checkPort,
  fetchBoseInfo,
  getLocalIpv4s
};
