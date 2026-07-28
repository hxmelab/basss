/**
 * BASSS SoundTouch Speaker Modifier
 * Automates the redirection of a Bose SoundTouch speaker to a local BASSS server, e.g. a Raspberry Pi.
 * 
 * Usage: node modify.js
 */

// ==========================================================================
// CONFIGURATION PARAMETERS
// ==========================================================================
const NAME = "SoundTouch";          // Name of the Bose speaker
const SPEAKER = "192.168.0.53";    // IP address of the Bose speaker
const SERVER = "raspi.fritz.box";     // IP/Hostname of your BASSS server
const PORT = 8053;                  // Port of your BASSS server
// ==========================================================================

const net = require('net');

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

    setTimeout(() => {
      console.log('\n🎉 Speaker modification completed successfully!');
      console.log('🔌 Connection closed. The speaker is now rebooting.');
      client.destroy();
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
