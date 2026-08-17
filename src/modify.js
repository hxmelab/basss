/**
 * BASSS SoundTouch Speaker Modifier
 * Automates the redirection of a Bose SoundTouch speaker to a local BASSS server, e.g. a Raspberry Pi.
 * 
 * Usage: node modify.js
 */

// ==========================================================================
// CONFIGURATION PARAMETERS
// ==========================================================================
const NAME = "BASSS";          // Name of the Bose SoundTouch speaker
const SPEAKER = "192.168.0.26";    // IP address of the Bose speaker
const SERVER = "raspi.fritz.box";     // IP/Hostname of your BASSS server
const PORT = 8053;                  // Port of your BASSS server
// ==========================================================================

const net = require('net');
const http = require('http');

// Generate a random 7-digit accountId
const accountId = String(Math.floor(1000000 + Math.random() * 9000000));

// Build configurations
const overrideXml = `<SoundTouchSdkPrivateCfg>
    <margeServerUrl>http://${SERVER}:${PORT}/marge</margeServerUrl>
    <statsServerUrl>http://${SERVER}:${PORT}</statsServerUrl>
    <swUpdateUrl>http://${SERVER}:${PORT}/updates/soundtouch</swUpdateUrl>
    <isZeroconfEnabled>true</isZeroconfEnabled>
    <usePandoraProductionServer>true</usePandoraProductionServer>
    <saveMargeCustomerReport>false</saveMargeCustomerReport>
    <bmxRegistryUrl>http://${SERVER}:${PORT}/bmx/registry/v1/services</bmxRegistryUrl>
</SoundTouchSdkPrivateCfg>
`;

const systemConfigXml = `<?xml version="1.0" encoding="UTF-8" ?>
<SystemConfiguration>
    <Password />
    <DeviceName>${NAME}</DeviceName>
    <AccountAssociatedEMail></AccountAssociatedEMail>
    <AccountUUID>${accountId}</AccountUUID>
    <Locale />
    <acctMode>global</acctMode>
    <isMultiDeviceAccount>false</isMultiDeviceAccount>
    <margeAuthServerToken />
    <powerSavingSettings powersaving_en="true" />
</SystemConfiguration>
`;

console.log('==================================================');
console.log('🔊 BASSS SoundTouch Speaker Modification Utility');
console.log('==================================================');
console.log(`Speaker IP:   ${SPEAKER}`);
console.log(`Speaker Name: ${NAME}`);
console.log(`BASSS Server: http://${SERVER}:${PORT}`);
console.log(`Account ID:   ${accountId} (dynamically generated)`);
console.log('--------------------------------------------------');

/**
 * Fetch speaker metadata (deviceID and type) from local API (port 8090)
 */
function fetchSpeakerInfo(ip) {
  return new Promise((resolve, reject) => {
    console.log(`🔍 Querying speaker info from http://${ip}:8090/info...`);
    const req = http.get(`http://${ip}:8090/info`, { timeout: 3000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Speaker returned HTTP status ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const deviceIdMatch = data.match(/deviceID="([^"]+)"/i);
        const deviceId = deviceIdMatch ? deviceIdMatch[1] : null;
        const typeMatch = data.match(/<type>(.*?)<\/type>/i);
        const deviceType = typeMatch ? typeMatch[1] : 'SoundTouch';

        if (!deviceId) {
          reject(new Error('Could not find deviceID in speaker info XML'));
          return;
        }
        resolve({ deviceId, deviceType });
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Speaker info request timed out'));
    });
  });
}

/**
 * Register the newly generated account mapping with the local BASSS server
 */
function registerAccountOnServer(deviceId, deviceType) {
  return new Promise((resolve) => {
    console.log(`📡 Registering account mapping with BASSS server at http://${SERVER}:${PORT}...`);
    const postData = JSON.stringify({
      serverIp: SERVER,
      name: NAME,
      type: deviceType,
      accountId: accountId
    });

    const req = http.request({
      hostname: SERVER,
      port: PORT,
      path: `/api/devices/${deviceId}/modify`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 3000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✅ Successfully registered new accountId (${accountId}) on BASSS server!`);
        } else {
          console.warn(`⚠️ BASSS server returned error code ${res.statusCode}: ${data}`);
        }
        resolve();
      });
    });

    req.on('error', (err) => {
      console.warn(`⚠️ Failed to register account mapping on BASSS server: ${err.message}`);
      resolve(); // resolve anyway so we don't block modifier completion
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn('⚠️ BASSS server registration timed out.');
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Main Telnet execution flow
 */
function startTelnetFlow(deviceId, deviceType) {
  const client = new net.Socket();
  let sessionData = '';
  let step = 0;

  console.log(`🔌 Connecting to speaker on ${SPEAKER}:23...`);

  client.connect(23, SPEAKER, () => {
    console.log('✅ Connected! Waiting for login prompt...');
  });

  client.on('data', (data) => {
    const chunk = data.toString();
    sessionData += chunk;

    // Step 0: Login
    if (step === 0 && (sessionData.toLowerCase().includes('login:') || sessionData.toLowerCase().includes('username:'))) {
      console.log('👤 Logging in as root...');
      client.write('root\r\n');
      sessionData = '';
      step = 1;
    }
    // Step 1: Backup original SystemConfigurationDB.xml on speaker
    else if (step === 1 && sessionData.includes('#')) {
      console.log('📂 Backing up original SystemConfigurationDB.xml on speaker...');
      client.write('cp /mnt/nv/BoseApp-Persistence/1/SystemConfigurationDB.xml /mnt/nv/SystemConfiguration.bak\r\n');
      sessionData = '';
      step = 2;
    }
    // Step 2: Write OverrideSdkPrivateCfg.xml
    else if (step === 2 && sessionData.includes('#')) {
      console.log('📝 Writing OverrideSdkPrivateCfg.xml to speaker (/mnt/nv/)...');
      client.write("cat << 'EOF' > /mnt/nv/OverrideSdkPrivateCfg.xml\r\n");
      client.write(overrideXml);
      client.write('\r\nEOF\r\n');
      sessionData = '';
      step = 3;
    }
    // Step 3: Write populated SystemConfigurationDB.xml
    else if (step === 3 && sessionData.includes('#')) {
      console.log('📝 Writing new SystemConfigurationDB.xml to speaker (/mnt/nv/BoseApp-Persistence/1/)...');
      client.write("cat << 'EOF' > /mnt/nv/BoseApp-Persistence/1/SystemConfigurationDB.xml\r\n");
      client.write(systemConfigXml);
      client.write('\r\nEOF\r\n');
      sessionData = '';
      step = 4;
    }
    // Step 4: Reboot
    else if (step === 4 && sessionData.includes('#')) {
      console.log('🔄 Rebooting the speaker to apply changes...');
      client.write('reboot\r\n');
      step = 5;

      setTimeout(async () => {
        console.log('🔌 Connection closed.');
        client.destroy();

        // Register the new account ID with the server
        await registerAccountOnServer(deviceId, deviceType);

        console.log('\n🎉 Speaker modification completed successfully!');
        process.exit(0);
      }, 1500);
    }
  });

  client.on('error', (err) => {
    console.error(`\n❌ Error: ${err.message}`);
    client.destroy();
    process.exit(1);
  });

  client.on('close', () => {
    if (step < 5) {
      console.error('\n❌ Connection closed prematurely.');
      process.exit(1);
    }
  });
}

/**
 * Check if the BASSS server is up and healthy
 */
function checkServerHealth() {
  return new Promise((resolve, reject) => {
    console.log(`🔍 Checking BASSS server health at http://${SERVER}:${PORT}/health...`);
    const req = http.get(`http://${SERVER}:${PORT}/health`, { timeout: 3000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Server returned status code ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json.status === 'ok') {
            resolve();
          } else {
            reject(new Error('Server status is not "ok"'));
          }
        } catch (e) {
          reject(new Error('Invalid JSON response from server'));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Server is unreachable (${err.message})`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Server request timed out'));
    });
  });
}

// Start flow by checking server health first
checkServerHealth()
  .then(() => {
    console.log('✅ BASSS server is online and healthy.');
    return fetchSpeakerInfo(SPEAKER);
  })
  .then(({ deviceId, deviceType }) => {
    console.log(`ℹ️ Speaker details retrieved: DeviceId=${deviceId}, Model=${deviceType}`);
    startTelnetFlow(deviceId, deviceType);
  })
  .catch((err) => {
    if (err.message.includes('Server') || err.message.includes('server')) {
      console.error(`\n❌ Server health check failed: ${err.message}`);
      console.error(`Please start the BASSS server first (http://${SERVER}:${PORT}), otherwise issues may occur.`);
    } else {
      console.error(`\n❌ Failed to retrieve speaker details: ${err.message}`);
      console.error('Please make sure the speaker is powered on and connected to the same network.');
    }
    process.exit(1);
  });
