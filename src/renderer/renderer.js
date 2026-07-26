// State tracking
let currentDevices = [];
let devicesData = { devices: {} };
let activePresetNumber = 1;
let serverIps = [];
let serverHostname = '';
let hideOfflineActive = false;

// DOM Elements
const navItems = document.querySelectorAll('.nav-item');
const tabViews = document.querySelectorAll('.tab-view');

// ==========================================================================
// NAVIGATION CONTROLLER
// ==========================================================================
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const targetTab = item.getAttribute('data-tab');

    // Toggle active link
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');

    // Toggle active tab view
    tabViews.forEach(view => {
      view.classList.remove('active');
      if (view.id === `tab-${targetTab}`) {
        view.classList.add('active');
      }
    });

    // Run actions based on tab loaded
    if (targetTab === 'favorites') {
      loadFavoritesStore();
    }
  });
});

// ==========================================================================
// TAB 1: WELCOME & SERVER STATUS
// ==========================================================================
const serverPortEl = document.getElementById('server-port');
const primaryLinkEl = document.getElementById('primary-link');
const healthLinkEl = document.getElementById('health-link');
const interfaceIpsEl = document.getElementById('interface-ips');
const serverLogsEl = document.getElementById('server-logs');
const clearLogsBtn = document.getElementById('clear-logs');

// Load Server status from IPC
async function loadServerStatus() {
  try {
    const status = await window.api.getServerStatus();
    serverIps = status.localIps || [];
    serverHostname = status.hostname || '';

    if (serverPortEl) serverPortEl.textContent = status.port;
    if (primaryLinkEl) primaryLinkEl.textContent = `http://localhost:${status.port}`;
    if (healthLinkEl) healthLinkEl.textContent = `http://localhost:${status.port}/health`;

    // Clear list
    if (interfaceIpsEl) {
      interfaceIpsEl.innerHTML = '';
      if (status.localIps.length === 0) {
        interfaceIpsEl.innerHTML = '<li><i class="fa-solid fa-triangle-exclamation"></i> No active network interface found</li>';
      } else {
        status.localIps.forEach(ip => {
          const li = document.createElement('li');
          li.innerHTML = `<i class="fa-solid fa-circle-arrow-right"></i> ${ip}:${status.port}`;
          interfaceIpsEl.appendChild(li);
        });
      }
    }

    // Render sidebar status footer
    const sidebarEndpointsEl = document.getElementById('sidebar-endpoints');
    if (sidebarEndpointsEl) {
      sidebarEndpointsEl.innerHTML = '';
      if (status.results && status.results.length > 0) {
        status.results.forEach(res => {
          const div = document.createElement('div');
          div.className = 'endpoint-status';
          const dotClass = res.available ? 'green' : 'red';
          div.innerHTML = `<span class="status-dot ${dotClass}"></span>${res.name}`;
          sidebarEndpointsEl.appendChild(div);
        });
      }
    }

    // Render firewall status in sidebar status footer
    const sidebarFirewallEl = document.getElementById('sidebar-firewall');
    if (sidebarFirewallEl && status.firewall) {
      sidebarFirewallEl.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'endpoint-status';
      let dotClass = 'red';
      if (status.firewall.status === 'allowed') dotClass = 'green';
      else if (status.firewall.status === 'disabled') dotClass = 'green';
      else if (status.firewall.status === 'checking') dotClass = 'orange';

      div.innerHTML = `<span class="status-dot ${dotClass}"></span>${status.firewall.message}`;
      sidebarFirewallEl.appendChild(div);
    }

    // Populate Server Address Dropdown inside loadServerStatus
    const selectServerAddress = document.getElementById('select-server-address');
    if (selectServerAddress) {
      selectServerAddress.innerHTML = '';
      const serverOptions = [];
      if (status.hostname) {
        serverOptions.push(`${status.hostname.toLowerCase()}.local`);
        serverOptions.push(`${status.hostname.toLowerCase()}.fritz.box`);
      }
      if (status.localIps) {
        status.localIps.forEach(ip => {
          if (ip !== '127.0.0.1' && ip !== 'localhost') {
            serverOptions.push(ip);
          }
        });
      }
      const uniqueOptions = Array.from(new Set(serverOptions));
      uniqueOptions.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        selectServerAddress.appendChild(option);
      });
    }
  } catch (err) {
    console.error('Failed to load server status:', err);
  }
}

// Receive Real-time console logs from IPC
window.api.onServerLog((log) => {
  const line = document.createElement('div');
  line.className = 'log-line';

  // Apply specific styles depending on log type
  if (log.type === 'warn') {
    line.classList.add('warn');
    line.textContent = `⚠️ [WARN] ${log.text}`;
  } else if (log.type === 'error') {
    line.classList.add('error');
    line.textContent = `❌ [ERROR] ${log.text}`;
  } else {
    // Check if it's a request log to apply color coding
    const text = log.text;
    if (text.includes('📥 Request: GET')) {
      line.classList.add('request-get');
    } else if (text.includes('📥 Request: POST') || text.includes('📥 Request: PUT')) {
      line.classList.add('request-post');
    } else if (text.includes('📥 Request: DELETE')) {
      line.classList.add('request-delete');
    } else if (text.includes('🎵 SoundTouch Backend started') || text.includes('✅ Express Backend Server')) {
      line.classList.add('system');
    }
    line.textContent = text;
  }

  serverLogsEl.appendChild(line);

  // Auto-scroll to the bottom of the logs
  serverLogsEl.scrollTop = serverLogsEl.scrollHeight;
});

// Clear log output
clearLogsBtn.addEventListener('click', () => {
  serverLogsEl.innerHTML = '<div class="log-line system">💡 Listening for Express server events...</div>';
});

// ==========================================================================
// TAB 2: NETWORK SCANNER
// ==========================================================================
const btnScan = document.getElementById('btn-scan');
const scanLoader = document.getElementById('scan-loader');
const discoveredDevicesGrid = document.getElementById('discovered-devices');
const btnToggleOffline = document.getElementById('btn-toggle-offline');

if (btnToggleOffline) {
  btnToggleOffline.addEventListener('click', () => {
    hideOfflineActive = !hideOfflineActive;

    if (hideOfflineActive) {
      btnToggleOffline.innerHTML = '<i class="fa-solid fa-eye"></i> Show Offline';
      btnToggleOffline.classList.remove('btn-secondary');
      btnToggleOffline.classList.add('btn-primary');
    } else {
      btnToggleOffline.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Hide Offline';
      btnToggleOffline.classList.remove('btn-primary');
      btnToggleOffline.classList.add('btn-secondary');
    }

    // Toggle card visibility based on data-online attribute
    const cards = document.querySelectorAll('.device-card');
    cards.forEach(card => {
      const isOnline = card.getAttribute('data-online') !== 'false';
      if (!isOnline && hideOfflineActive) {
        card.style.display = 'none';
      } else {
        card.style.display = '';
      }
    });
  });
}

// Renders the list of devices onto the grid
function renderDeviceCards(devicesList) {
  discoveredDevicesGrid.innerHTML = '';

  if (devicesList.length === 0) {
    discoveredDevicesGrid.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-wifi"></i>
        <h3>No Speakers Registered</h3>
        <p>No speakers found in database. Run a network scan to discover them.</p>
      </div>`;
    return;
  }

  devicesList.forEach(dev => {
    const ip = dev.ip || dev.ipAddress || '0.0.0.0';
    const type = dev.type || dev.productCode || 'SoundTouch';
    const telnetAvailable = dev.telnetAvailable !== undefined ? dev.telnetAvailable : false;

    const card = document.createElement('div');
    card.className = 'device-card card glass';
    card.id = `device-card-${dev.deviceId}`;
    card.setAttribute('data-device-id', dev.deviceId);

    const badgeClass = telnetAvailable ? 'open' : 'closed';
    const badgeIcon = telnetAvailable ? 'fa-lock-open' : 'fa-lock';
    const badgeText = telnetAvailable ? 'Telnet Open' : 'Telnet Closed';

    // Determine modification status text (prefer server URL from database)
    let modStatusText = 'unbekannt';
    const dbDevice = devicesData.devices[dev.deviceId];
    if (dbDevice) {
      if (dbDevice.server) {
        modStatusText = dbDevice.server;
      }
    }

    const modStatusColor = (modStatusText === 'unbekannt') ? 'var(--text-muted)' : 'var(--color-success)';

    const accountId = dbDevice?.accountId || (devicesData.accounts && devicesData.accounts[dev.deviceId] && devicesData.accounts[dev.deviceId].accountId) || 'unbekannt';

    card.innerHTML = `
      <div class="device-card-header">
        <div class="device-card-info">
          <h4>${dev.name}</h4>
          <span class="model">${type}</span>
        </div>
        <div class="device-card-badges" style="display: flex; gap: 8px; align-items: center;">
          <span class="telnet-icon ${badgeClass}" id="telnet-badge-${dev.deviceId}" data-ip="${ip}" data-device-id="${dev.deviceId}" title="${badgeText}" style="cursor: pointer;">
            <i class="fa-solid ${badgeIcon}"></i>
          </span>
          <span class="mute-btn" id="mute-btn-${dev.deviceId}" data-ip="${ip}" data-device-id="${dev.deviceId}" title="Mute/Unmute">
            <i class="fa-solid fa-volume-high"></i>
          </span>
          <span class="power-btn unknown" id="power-btn-${dev.deviceId}" data-ip="${ip}" data-device-id="${dev.deviceId}" title="Toggle Power">
            <i class="fa-solid fa-power-off"></i>
          </span>
        </div>
      </div>
      
      <!-- Sliders (Volume & Bass) -->
      <div class="device-sliders">
        <!-- Now Playing Display -->
        <div class="now-playing-container" id="now-playing-container-${dev.deviceId}">
          <div class="now-playing-label">Now Playing:</div>
          <div class="now-playing-value" id="now-playing-val-${dev.deviceId}">Loading...</div>
        </div>

        <!-- Volume Slider -->
        <div class="slider-control">
          <div class="slider-header">
            <span>Volume:</span>
            <span class="slider-value" id="vol-val-${dev.deviceId}">--</span>
          </div>
          <input type="range" min="0" max="100" value="30" class="volume-slider" data-ip="${ip}" data-device-id="${dev.deviceId}" id="vol-slider-${dev.deviceId}">
        </div>
        
        <!-- Bass Slider -->
        <div class="slider-control" id="bass-container-${dev.deviceId}">
          <div class="slider-header">
            <span>Bass:</span>
            <span class="slider-value" id="bass-val-${dev.deviceId}">0</span>
          </div>
          <input type="range" min="-9" max="0" value="0" class="bass-slider" data-ip="${ip}" data-device-id="${dev.deviceId}" id="bass-slider-${dev.deviceId}">
        </div>
      </div>

      <div class="card-presets-section">
        <h5>Presets (1-6):</h5>
        <div class="presets-row-grid" id="presets-grid-${dev.deviceId}">
          ${[1, 2, 3, 4, 5, 6].map(num => `
            <div class="preset-row">
              <button class="btn-preset-action" 
                      data-ip="${ip}" 
                      data-device-id="${dev.deviceId}" 
                      data-preset-id="${num}" 
                      id="preset-btn-${dev.deviceId}-${num}">
                <span class="preset-num">${num}</span>
                <span class="preset-label" id="preset-label-${dev.deviceId}-${num}"></span>
              </button>
              <button class="btn-preset-save" 
                      data-ip="${ip}" 
                      data-device-id="${dev.deviceId}" 
                      data-preset-id="${num}" 
                      id="preset-save-${dev.deviceId}-${num}" 
                      disabled>
                <i class="fa-solid fa-floppy-disk"></i>
              </button>
              <button class="btn-preset-play" 
                      data-ip="${ip}" 
                      data-device-id="${dev.deviceId}" 
                      data-preset-id="${num}" 
                      id="preset-play-${dev.deviceId}-${num}" 
                      title="Play Preset ${num}">
                <i class="fa-solid fa-play"></i>
              </button>
            </div>
          `).join('')}
        </div>
        
        <!-- Sources Section (Bluetooth / AUX) -->
        <div class="card-sources-section">
          <button class="btn-source-action btn-aux-source" 
                  data-ip="${ip}" 
                  data-device-id="${dev.deviceId}" 
                  title="Switch source (Bluetooth / AUX)">
            <i class="fa-brands fa-bluetooth"></i> Bluetooth / <i class="fa-solid fa-plug"></i> AUX
          </button>
        </div>
      </div>

      <div class="device-details">
        <div class="detail-item">
          <span class="label">IP Address:</span>
          <span class="value">${ip}</span>
        </div>
        <div class="detail-item">
          <span class="label">Device MAC/ID:</span>
          <span class="value">${dev.deviceId}</span>
        </div>
        <div class="detail-item">
          <span class="label">Account ID:</span>
          <span class="value" style="font-weight: 500; color: var(--color-primary, #00d2ff);">${accountId}</span>
        </div>
        <div class="detail-item btn-mod-badge-trigger" style="cursor: pointer;" title="Click to open Modify wizard">
          <span class="label">Server:</span>
          <span class="value" id="mod-val-${dev.deviceId}" style="color: ${modStatusColor}; font-weight: 500;">${modStatusText}</span>
        </div>
      </div>`;

    discoveredDevicesGrid.appendChild(card);

    // Bind click listener to open Modify wizard from card mod badge
    card.querySelector('.btn-mod-badge-trigger').addEventListener('click', () => {
      const modifyTabBtn = document.querySelector('.nav-item[data-tab="override"]');
      if (modifyTabBtn) {
        modifyTabBtn.click();
        const selectTargetSpeaker = document.getElementById('select-target-speaker');
        if (selectTargetSpeaker) {
          for (let option of selectTargetSpeaker.options) {
            try {
              const optVal = JSON.parse(option.value);
              if (optVal.deviceId === dev.deviceId) {
                selectTargetSpeaker.value = option.value;
                selectTargetSpeaker.dispatchEvent(new Event('change'));
                break;
              }
            } catch (err) { }
          }
        }
      }
    });

    loadSpeakerPresets(ip, dev.deviceId);
    loadSpeakerControlsState(ip, dev.deviceId);
    connectWebSocket(ip, dev.deviceId);
  });
}

btnScan.addEventListener('click', async () => {
  const hasCards = discoveredDevicesGrid.children.length > 0 && !discoveredDevicesGrid.querySelector('.empty-state');

  if (!hasCards) {
    scanLoader.style.display = 'flex';
    discoveredDevicesGrid.style.display = 'none';
    discoveredDevicesGrid.innerHTML = '';
  } else {
    btnScan.disabled = true;
    btnScan.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';
  }

  try {
    const devices = await window.api.scanNetwork();
    await loadDevicesStore();

    if (!hasCards) {
      scanLoader.style.display = 'none';
      discoveredDevicesGrid.style.display = 'grid';
    }

    // Populate Target Speaker Dropdown in Step 3 of Modify
    const selectTargetSpeaker = document.getElementById('select-target-speaker');
    const btnPerformModificationEl = document.getElementById('btn-perform-modification');
    if (selectTargetSpeaker) {
      selectTargetSpeaker.innerHTML = '';
      if (devices.length === 0) {
        selectTargetSpeaker.innerHTML = '<option value="">No speakers discovered. Run Dashboard scan first.</option>';
        if (btnPerformModificationEl) btnPerformModificationEl.disabled = true;
      } else {
        devices.forEach(d => {
          const option = document.createElement('option');
          option.value = JSON.stringify({ ip: d.ip, deviceId: d.deviceId, name: d.name, type: d.type });
          option.textContent = `${d.name} (${d.ip})`;
          selectTargetSpeaker.appendChild(option);
        });
        if (btnPerformModificationEl) btnPerformModificationEl.disabled = false;
      }
    }

    renderDeviceCards(Object.values(devicesData.devices));
  } catch (err) {
    if (!hasCards) {
      scanLoader.style.display = 'none';
      discoveredDevicesGrid.style.display = 'grid';
      discoveredDevicesGrid.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <h3>Scan Error</h3>
          <p>Discovery request failed: ${err.message}</p>
        </div>`;
    } else {
      alert(`Network scan failed: ${err.message}`);
    }
  } finally {
    btnScan.disabled = false;
    btnScan.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh';
  }
});

// ==========================================================================
// DEVICES DATASTORE LOADER
// ==========================================================================

async function loadDevicesStore() {
  try {
    const data = await window.api.getEmulationData();
    devicesData = data || { devices: {} };
  } catch (err) {
    console.error('Failed to load devices datastore:', err);
  }
}


// ==========================================================================
// TAB 4: MODIFY WIZARD
// ==========================================================================
const btnCreateUsb = document.getElementById('btn-create-usb');
const usbModal = document.getElementById('usb-modal');
const btnCloseUsbModal = document.getElementById('btn-close-usb-modal');
const btnCancelUsb = document.getElementById('btn-cancel-usb');
const btnConfirmUsb = document.getElementById('btn-confirm-usb');
const selectedUsbPathEl = document.getElementById('selected-usb-path');
const usbStatusSpan = document.getElementById('usb-status');
const btnPerformModification = document.getElementById('btn-perform-modification');

let chosenUsbDirectory = null;

if (btnCreateUsb) {
  btnCreateUsb.addEventListener('click', async () => {
    const folderPath = await window.api.selectUsbDirectory();
    if (folderPath) {
      chosenUsbDirectory = folderPath;
      selectedUsbPathEl.textContent = folderPath;
      btnConfirmUsb.disabled = false;
      usbModal.style.display = 'flex';
    }
  });
}

if (btnCloseUsbModal) {
  btnCloseUsbModal.addEventListener('click', () => {
    usbModal.style.display = 'none';
  });
}

if (btnCancelUsb) {
  btnCancelUsb.addEventListener('click', () => {
    usbModal.style.display = 'none';
  });
}

if (btnConfirmUsb) {
  btnConfirmUsb.addEventListener('click', async () => {
    if (!chosenUsbDirectory) return;
    try {
      await window.api.createUsbFile(chosenUsbDirectory);
      usbModal.style.display = 'none';
      usbStatusSpan.textContent = `✅ remote_services file created!`;
      usbStatusSpan.style.color = 'var(--color-success)';
    } catch (err) {
      alert(`Failed to write file: ${err.message}`);
    }
  });
}

if (btnPerformModification) {
  btnPerformModification.addEventListener('click', async () => {
    const selectServerAddress = document.getElementById('select-server-address');
    const selectTargetSpeaker = document.getElementById('select-target-speaker');

    if (!selectServerAddress || !selectTargetSpeaker) return;

    const targetHost = selectServerAddress.value;
    const speakerDataStr = selectTargetSpeaker.value;
    if (!targetHost || !speakerDataStr) {
      alert('Please select both a server address and a target speaker.');
      return;
    }

    let speaker;
    try {
      speaker = JSON.parse(speakerDataStr);
    } catch (e) {
      alert('Invalid speaker target data.');
      return;
    }

    try {
      await window.api.generateOverrideFile({ targetHost });
      triggerTelnetDeployment({
        targetIp: speaker.ip,
        deviceId: speaker.deviceId,
        name: speaker.name,
        type: speaker.type
      });
    } catch (err) {
      alert(`Failed to generate config or start modification: ${err.message}`);
    }
  });
}

// ==========================================================================
// MODAL: TELNET DEPLOYMENT LOGS
// ==========================================================================
const deployModal = document.getElementById('deploy-modal');
const deployTerminal = document.getElementById('deploy-terminal');
const btnCloseDeploy = document.getElementById('btn-close-deploy');

// Render deployment status logs step by step
function triggerTelnetDeployment(options) {
  // Clear modal console and show modal
  deployTerminal.innerHTML = '';
  deployModal.style.display = 'flex';
  btnCloseDeploy.disabled = true;

  // Trigger deploy IPC call
  window.api.deployOverride(options)
    .then(async () => {
      btnCloseDeploy.disabled = false;
      // Refresh devices store and automatically refresh network scan view to update the badge!
      await loadDevicesStore();
      btnScan.click();
    })
    .catch((err) => {
      // IPC log error is already captured in log progression stream, enable close button
      btnCloseDeploy.disabled = false;
    });
}

// Receive progress updates from IPC
window.api.onDeployProgress((msg) => {
  const line = document.createElement('div');
  line.className = 'deploy-line';
  line.textContent = `> ${msg}`;
  deployTerminal.appendChild(line);
  deployTerminal.scrollTop = deployTerminal.scrollHeight;
});

btnCloseDeploy.addEventListener('click', () => {
  deployModal.style.display = 'none';
});

// Initial startup load
loadServerStatus();

// Listen for push firewall status updates from Main Process
if (window.api.onFirewallStatus) {
  window.api.onFirewallStatus((firewallStatus) => {
    const sidebarFirewallEl = document.getElementById('sidebar-firewall');
    if (sidebarFirewallEl) {
      sidebarFirewallEl.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'endpoint-status';
      let dotClass = 'red';
      if (firewallStatus.status === 'allowed') dotClass = 'green';
      else if (firewallStatus.status === 'disabled') dotClass = 'green';
      else if (firewallStatus.status === 'checking') dotClass = 'orange';

      div.innerHTML = `<span class="status-dot ${dotClass}"></span>${firewallStatus.message}`;
      sidebarFirewallEl.appendChild(div);
    }
  });
}

// Load and set app version
if (window.api.getAppVersion) {
  window.api.getAppVersion().then(version => {
    const versionEl = document.querySelector('.sidebar-footer .version');
    if (versionEl) {
      versionEl.textContent = `v${version}`;
    }
  });
}

loadDevicesStore().then(() => {
  renderDeviceCards(Object.values(devicesData.devices));
  btnScan.click(); // Trigger initial network scan on startup
});

// ==========================================================================
// RADIO BROWSER & FAVORITES CONTROLLERS
// ==========================================================================

const webview = document.getElementById('radio-browser-webview');
const btnFavoriteBrowser = document.getElementById('btn-favorite-browser');
const favoritesListContainer = document.getElementById('favorites-list-container');
const btnResetRadio = document.getElementById('btn-reset-radio');
let activeStationUuid = null;

if (btnResetRadio && webview) {
  btnResetRadio.addEventListener('click', () => {
    webview.src = "https://www.radio-browser.info/";
  });
}

function checkRadioBrowserUrl(url) {
  const regex = /https:\/\/www\.radio-browser\.info\/history\/([a-f0-9\-]{36})/i;
  const match = url.match(regex);
  if (match && match[1]) {
    activeStationUuid = match[1];
    btnFavoriteBrowser.disabled = false;
    btnFavoriteBrowser.classList.add('btn-favorite-active');
    btnFavoriteBrowser.innerHTML = '<i class="fa-solid fa-star"></i> Add to Favorites';
  } else {
    activeStationUuid = null;
    btnFavoriteBrowser.disabled = true;
    btnFavoriteBrowser.classList.remove('btn-favorite-active');
    btnFavoriteBrowser.innerHTML = '<i class="fa-regular fa-star"></i> Favorite';
  }
}

if (webview) {
  webview.addEventListener('did-navigate', (event) => {
    checkRadioBrowserUrl(event.url);
  });
  webview.addEventListener('did-navigate-in-page', (event) => {
    checkRadioBrowserUrl(event.url);
  });
}

if (btnFavoriteBrowser) {
  btnFavoriteBrowser.addEventListener('click', async () => {
    if (!activeStationUuid) return;
    btnFavoriteBrowser.disabled = true;
    btnFavoriteBrowser.classList.remove('btn-favorite-active');
    btnFavoriteBrowser.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    try {
      await window.api.addFavoriteByUuid(activeStationUuid);
      btnFavoriteBrowser.innerHTML = '<i class="fa-solid fa-circle-check"></i> Saved!';
      setTimeout(() => {
        if (activeStationUuid) {
          btnFavoriteBrowser.disabled = false;
          btnFavoriteBrowser.classList.add('btn-favorite-active');
          btnFavoriteBrowser.innerHTML = '<i class="fa-solid fa-star"></i> Add to Favorites';
        }
      }, 2000);
    } catch (err) {
      alert(`Failed to save favorite: ${err.message}`);
      btnFavoriteBrowser.disabled = false;
      btnFavoriteBrowser.classList.add('btn-favorite-active');
      btnFavoriteBrowser.innerHTML = '<i class="fa-solid fa-star"></i> Add to Favorites';
    }
  });
}

async function loadFavoritesStore() {
  if (!favoritesListContainer) return;
  favoritesListContainer.innerHTML = '<div class="scan-loader"><div class="spinner"></div><p>Loading favorites...</p></div>';

  try {
    const favorites = await window.api.getFavorites();
    favoritesListContainer.innerHTML = '';
    const favList = Object.values(favorites);

    if (favList.length === 0) {
      favoritesListContainer.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-star"></i>
          <h3>No Favorites Yet</h3>
          <p>Go to the Radio Browser tab, navigate to a station detail page, and add it to your favorites!</p>
        </div>`;
      return;
    }

    favList.forEach(fav => {
      const item = document.createElement('div');
      item.className = 'favorite-item';

      const streamUrl = (fav.audio && fav.audio.streamUrl) || 'No Stream URL';

      item.innerHTML = `
        <div class="favorite-info">
          <h4>${fav.name}</h4>
          <span>Stream URL: ${streamUrl}</span>
        </div>
        <div class="favorite-actions">
          <button class="btn btn-danger btn-delete-favorite" data-uuid="${fav.uuid}">
            <i class="fa-solid fa-trash-can"></i> Delete
          </button>
        </div>`;

      favoritesListContainer.appendChild(item);
    });

    document.querySelectorAll('.btn-delete-favorite').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uuid = btn.getAttribute('data-uuid');
        if (confirm('Are you sure you want to delete this radio station from your favorites?')) {
          await window.api.deleteFavorite(uuid);
          loadFavoritesStore();
        }
      });
    });

  } catch (err) {
    favoritesListContainer.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Error Loading Favorites</h3>
        <p>${err.message}</p>
      </div>`;
  }
}

// ==========================================================================
// PHYSICAL SPEAKER PRESETS MANAGEMENT
// ==========================================================================

async function loadSpeakerPresets(ip, deviceId) {
  try {
    const res = await window.api.getSpeakerPresets(ip);
    if (res.success && res.presets) {
      Object.keys(res.presets).forEach(id => {
        const preset = res.presets[id];
        const labelEl = document.getElementById(`preset-label-${deviceId}-${id}`);
        if (labelEl && preset.name) {
          labelEl.textContent = preset.name;

          const btnEl = document.getElementById(`preset-btn-${deviceId}-${id}`);
          if (btnEl) {
            btnEl.setAttribute('data-current-name', preset.name);
            btnEl.setAttribute('data-current-location', preset.location || '');
          }
        }
      });
    }
  } catch (e) {
    console.warn(`Failed to fetch presets for speaker ${deviceId} (${ip}):`, e.message);
  }
}

// Preset Selection Modal Elements
const presetSelectModal = document.getElementById('preset-select-modal');
const btnClosePresetModal = document.getElementById('btn-close-preset-modal');
const modalFavoritesList = document.getElementById('modal-favorites-list');

let activePresetTarget = null; // will hold { ip, deviceId, presetId }

// Bind clicks on preset buttons (.btn-preset-action)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-preset-action');
  if (!btn) return;

  const ip = btn.getAttribute('data-ip');
  const deviceId = btn.getAttribute('data-device-id');
  const presetId = btn.getAttribute('data-preset-id');

  activePresetTarget = { ip, deviceId, presetId };
  openPresetSelectorModal();
});

// Bind clicks on save preset buttons (.btn-preset-save)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-preset-save');
  if (!btn) return;
  if (btn.disabled) return;

  const ip = btn.getAttribute('data-ip');
  const deviceId = btn.getAttribute('data-device-id');
  const presetId = btn.getAttribute('data-preset-id');

  const actionBtn = document.getElementById(`preset-btn-${deviceId}-${presetId}`);
  if (!actionBtn) return;

  const name = actionBtn.getAttribute('data-new-name');
  const location = actionBtn.getAttribute('data-new-location');

  if (!name || !location) return;

  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    await window.api.saveSpeakerPreset({ targetIp: ip, presetId, name, location });
    btn.innerHTML = '<i class="fa-solid fa-circle-check" style="color: var(--color-success);"></i>';
    console.log(`[Preset Save] Saved preset ${presetId} ("${name}") to ${ip}`);

    // Update local preset attributes to reflect state on speaker
    actionBtn.setAttribute('data-current-name', name);
    actionBtn.setAttribute('data-current-location', location);
    actionBtn.removeAttribute('data-new-name');
    actionBtn.removeAttribute('data-new-location');

    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.disabled = true;
    }, 2000);
  } catch (err) {
    alert(`Failed to save preset: ${err.message}`);
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
});

// Close modal when X is clicked
if (btnClosePresetModal) {
  btnClosePresetModal.addEventListener('click', () => {
    presetSelectModal.style.display = 'none';
  });
}

// Close modal when clicking outside
window.addEventListener('click', (e) => {
  if (e.target === presetSelectModal) {
    presetSelectModal.style.display = 'none';
  }
});

async function openPresetSelectorModal() {
  if (!presetSelectModal || !modalFavoritesList) return;

  modalFavoritesList.innerHTML = '<div class="scan-loader"><div class="spinner"></div><p>Loading favorites...</p></div>';
  presetSelectModal.style.display = 'flex';

  try {
    const favorites = await window.api.getFavorites();
    modalFavoritesList.innerHTML = '';
    const favList = Object.values(favorites);

    if (favList.length === 0) {
      modalFavoritesList.innerHTML = `
        <div class="empty-state" style="padding: 24px 0;">
          <i class="fa-solid fa-star"></i>
          <h3>No Favorites Found</h3>
          <p>Please save some radio stations in the "Radio Browser" tab first.</p>
        </div>`;
      return;
    }

    favList.forEach(fav => {
      const item = document.createElement('div');
      item.className = 'modal-fav-item';

      const streamUrl = (fav.audio && fav.audio.streamUrl) || 'No Stream URL';

      item.innerHTML = `
        <div class="modal-fav-info">
          <h4>${fav.name}</h4>
          <span>${streamUrl}</span>
        </div>
        <button class="btn btn-secondary select-modal-fav" style="padding: 6px 12px; font-size: 0.75rem;">Select</button>`;

      item.addEventListener('click', () => {
        selectFavoriteForTarget(fav);
      });

      modalFavoritesList.appendChild(item);
    });
  } catch (err) {
    modalFavoritesList.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
}

function selectFavoriteForTarget(favorite) {
  if (!activePresetTarget) return;
  const { deviceId, presetId } = activePresetTarget;

  const labelEl = document.getElementById(`preset-label-${deviceId}-${presetId}`);
  const btnEl = document.getElementById(`preset-btn-${deviceId}-${presetId}`);
  const saveBtnEl = document.getElementById(`preset-save-${deviceId}-${presetId}`);

  const location = favorite.uuid ? `https://all.api.radio-browser.info/soundtouch/stations/byuuid/${favorite.uuid}` : (favorite.audio?.streamUrl || '');

  if (labelEl && btnEl && saveBtnEl) {
    labelEl.textContent = favorite.name;
    btnEl.setAttribute('data-new-name', favorite.name);
    btnEl.setAttribute('data-new-location', location);

    const currentName = btnEl.getAttribute('data-current-name');
    const currentLocation = btnEl.getAttribute('data-current-location');

    if (currentName !== favorite.name || currentLocation !== location) {
      saveBtnEl.disabled = false;
    } else {
      saveBtnEl.disabled = true;
    }
  }

  presetSelectModal.style.display = 'none';
}

// Bind clicks on modification badges to open 'override' tab
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('.btn-mod-badge-trigger');
  if (trigger) {
    const overrideTabBtn = document.querySelector('.nav-item[data-tab="override"]');
    if (overrideTabBtn) {
      overrideTabBtn.click();
    }
  }
});

// ==========================================================================
// DETAILED SPEAKER STATE, VOLUME & BASS RANGE CONTROLS
// ==========================================================================

async function loadSpeakerControlsState(ip, deviceId) {
  const card = document.getElementById(`device-card-${deviceId}`);
  try {
    const res = await window.api.getSpeakerState(ip);
    if (res.success && res.state) {
      const state = res.state;

      const powerBtn = document.getElementById(`power-btn-${deviceId}`);
      if (powerBtn) {
        powerBtn.className = `power-btn ${state.powerOn ? 'on' : 'off'}`;
        powerBtn.title = `Turn ${state.powerOn ? 'Off' : 'On'} (Current: ${state.powerOn ? 'ON' : 'STANDBY'})`;
      }

      if (card) {
        card.setAttribute('data-online', 'true');
        card.style.display = '';
      }

      const muteBtn = document.getElementById(`mute-btn-${deviceId}`);
      if (muteBtn) {
        if (state.muteEnabled) {
          muteBtn.className = 'mute-btn muted';
          muteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
          muteBtn.title = 'Unmute Speaker';
        } else {
          muteBtn.className = 'mute-btn';
          muteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
          muteBtn.title = 'Mute Speaker';
        }
      }

      const volSlider = document.getElementById(`vol-slider-${deviceId}`);
      const volVal = document.getElementById(`vol-val-${deviceId}`);
      if (volSlider && volVal) {
        volSlider.value = state.volume;
        volVal.textContent = `${state.volume}%`;
      }

      const bassSlider = document.getElementById(`bass-slider-${deviceId}`);
      const bassVal = document.getElementById(`bass-val-${deviceId}`);
      if (bassSlider && bassVal) {
        bassSlider.value = state.bass;
        bassVal.textContent = state.bass;
      }

      const npVal = document.getElementById(`now-playing-val-${deviceId}`);
      if (npVal) {
        if (state.nowPlaying) {
          const np = state.nowPlaying;
          if (np.source === 'STANDBY' || !state.powerOn) {
            npVal.textContent = 'Standby';
            npVal.style.color = 'var(--text-muted)';
          } else {
            let text = '';
            if (np.artist && np.track) {
              text = `${np.artist} - ${np.track}`;
            } else if (np.stationName) {
              text = np.stationName;
              if (np.track) text += ` (${np.track})`;
            } else if (np.track) {
              text = np.track;
            } else {
              text = `Playing (${np.source})`;
            }
            npVal.textContent = text;
            npVal.style.color = 'var(--color-primary)';
          }
        } else {
          npVal.textContent = state.powerOn ? 'Playing' : 'Standby';
          npVal.style.color = state.powerOn ? 'var(--color-primary)' : 'var(--text-muted)';
        }
      }
    } else {
      const powerBtn = document.getElementById(`power-btn-${deviceId}`);
      if (powerBtn) {
        powerBtn.className = 'power-btn offline';
        powerBtn.title = 'Current: offline';
      }
      if (card) {
        card.setAttribute('data-online', 'false');
        if (hideOfflineActive) {
          card.style.display = 'none';
        }
      }
    }
  } catch (e) {
    console.warn(`Failed to load control states for speaker ${deviceId}:`, e.message);
    const powerBtn = document.getElementById(`power-btn-${deviceId}`);
    if (powerBtn) {
      powerBtn.className = 'power-btn offline';
      powerBtn.title = 'Current: offline';
    }
    if (card) {
      card.setAttribute('data-online', 'false');
      if (hideOfflineActive) {
        card.style.display = 'none';
      }
    }
  }
}

// Telnet Availability Check Listener (on click)
const handleTelnetCheck = async (badge) => {
  if (badge.classList.contains('checking')) return;
  badge.classList.add('checking');

  const ip = badge.getAttribute('data-ip');

  badge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const res = await window.api.checkTelnet(ip);
    if (res && res.telnetAvailable) {
      badge.className = 'telnet-icon open';
      badge.innerHTML = '<i class="fa-solid fa-lock-open"></i>';
      badge.title = 'Telnet Open';
    } else {
      badge.className = 'telnet-icon closed';
      badge.innerHTML = '<i class="fa-solid fa-lock"></i>';
      badge.title = 'Telnet Closed';
    }
  } catch (err) {
    console.error('Telnet check failed:', err.message);
    badge.className = 'telnet-icon closed';
    badge.innerHTML = '<i class="fa-solid fa-lock"></i>';
    badge.title = 'Telnet Closed (Check Error)';
  } finally {
    badge.classList.remove('checking');
  }
};

document.addEventListener('click', (e) => {
  const badge = e.target.closest('.telnet-icon');
  if (badge) {
    e.preventDefault();
    handleTelnetCheck(badge);
  }
});

// Mute Toggle Listener
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.mute-btn');
  if (!btn) return;

  const ip = btn.getAttribute('data-ip');
  const deviceId = btn.getAttribute('data-device-id');

  btn.className = 'mute-btn muted';
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    await window.api.triggerSpeakerKey(ip, 'MUTE');
    setTimeout(() => {
      loadSpeakerControlsState(ip, deviceId);
    }, 1200);
  } catch (err) {
    alert(`Failed to toggle mute: ${err.message}`);
    loadSpeakerControlsState(ip, deviceId);
  }
});

// Power Toggle Listener
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.power-btn');
  if (!btn) return;

  if (btn.classList.contains('offline')) {
    return;
  }

  const ip = btn.getAttribute('data-ip');
  const deviceId = btn.getAttribute('data-device-id');

  btn.className = 'power-btn unknown';

  try {
    await window.api.triggerSpeakerKey(ip, 'POWER');
    setTimeout(() => {
      loadSpeakerControlsState(ip, deviceId);
    }, 1200);
  } catch (err) {
    console.warn(`Failed to toggle power for speaker ${deviceId}:`, err.message);
    btn.className = 'power-btn offline';
    btn.title = 'Current: offline';
  }
});

// Preset Play Trigger Listener
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-preset-play');
  if (!btn) return;

  const ip = btn.getAttribute('data-ip');
  const num = btn.getAttribute('data-preset-id');

  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    await window.api.triggerSpeakerKey(ip, `PRESET_${num}`);
    btn.innerHTML = '<i class="fa-solid fa-circle-check" style="color: var(--color-success);"></i>';
    setTimeout(() => {
      btn.innerHTML = originalHtml;
    }, 1500);
  } catch (err) {
    alert(`Failed to trigger preset: ${err.message}`);
    btn.innerHTML = originalHtml;
  }
});

// AUX / Bluetooth Source Trigger Listener
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-aux-source');
  if (!btn) return;

  const ip = btn.getAttribute('data-ip');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';

  try {
    await window.api.triggerSpeakerKey(ip, 'AUX_INPUT');
  } catch (err) {
    console.error('Failed to set source to Bluetooth/AUX:', err.message);
  } finally {
    btn.innerHTML = originalHtml;
  }
});

// Slider Input Listeners (for real-time value label rendering)
document.addEventListener('input', (e) => {
  if (e.target.classList.contains('volume-slider')) {
    const deviceId = e.target.getAttribute('data-device-id');
    const valEl = document.getElementById(`vol-val-${deviceId}`);
    if (valEl) {
      valEl.textContent = `${e.target.value}%`;
    }
  }
  if (e.target.classList.contains('bass-slider')) {
    const deviceId = e.target.getAttribute('data-device-id');
    const valEl = document.getElementById(`bass-val-${deviceId}`);
    if (valEl) {
      valEl.textContent = e.target.value;
    }
  }
});

// Slider Change Listeners (fired upon slide release to avoid redundant API request spamming)
document.addEventListener('change', async (e) => {
  if (e.target.classList.contains('volume-slider')) {
    const ip = e.target.getAttribute('data-ip');
    const volume = parseInt(e.target.value, 10);
    try {
      await window.api.setSpeakerVolume(ip, volume);
    } catch (err) {
      console.error('Failed to set speaker volume:', err.message);
    }
  }
  if (e.target.classList.contains('bass-slider')) {
    const ip = e.target.getAttribute('data-ip');
    const bass = parseInt(e.target.value, 10);
    try {
      await window.api.setSpeakerBass(ip, bass);
    } catch (err) {
      console.error('Failed to set speaker bass:', err.message);
    }
  }
});

// ==========================================================================
// REAL-TIME WEBSOCKET CONTROLLER
// ==========================================================================
const wsConnections = new Map(); // Key: deviceId, Value: { ws, ip }

function connectWebSocket(ip, deviceId) {
  // Ensure only one WebSocket connection per box is active
  if (wsConnections.has(deviceId)) {
    const existing = wsConnections.get(deviceId);
    if (existing.ip === ip && (existing.ws.readyState === WebSocket.CONNECTING || existing.ws.readyState === WebSocket.OPEN)) {
      return; // Connection already active or in progress for this IP
    }
    // Clean up old / stale connection
    try {
      existing.ws.close();
    } catch (e) { }
    wsConnections.delete(deviceId);
  }

  console.log(`[WebSocket] Connecting to speaker ${deviceId} at ws://${ip}:8080/ with protocol 'gabbo'`);
  let ws;
  try {
    ws = new WebSocket(`ws://${ip}:8080/`, 'gabbo');
  } catch (err) {
    console.error(`[WebSocket] Failed to initialize WebSocket for speaker ${deviceId}:`, err.message);
    // Retry connection after delay
    setTimeout(() => connectWebSocket(ip, deviceId), 10000);
    return;
  }

  wsConnections.set(deviceId, { ws, ip });

  ws.onopen = () => {
    console.log(`[WebSocket] Connected to speaker ${deviceId} (${ip})`);
    // Fetch initial state once connection is established to ensure synchronization
    loadSpeakerControlsState(ip, deviceId);
  };

  ws.onmessage = (event) => {
    handleWebSocketMessage(event.data, ip, deviceId);
  };

  ws.onerror = (error) => {
    console.warn(`[WebSocket] Error for speaker ${deviceId} (${ip}):`, error);
  };

  ws.onclose = (event) => {
    console.log(`[WebSocket] Connection closed for speaker ${deviceId} (${ip}). Code: ${event.code}`);
    wsConnections.delete(deviceId);
    // Automatic reconnection attempt after 10 seconds
    setTimeout(() => {
      connectWebSocket(ip, deviceId);
    }, 10000);
  };
}

function handleWebSocketMessage(xmlText, ip, deviceId) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const updates = doc.querySelector('updates');
    if (!updates) return;

    // 1. Volume Change
    const volumeNode = updates.querySelector('volume');
    if (volumeNode) {
      const targetVol = volumeNode.querySelector('targetvolume') || volumeNode.querySelector('actualvolume');
      const muteNode = volumeNode.querySelector('muteenabled');
      if (targetVol) {
        const val = parseInt(targetVol.textContent, 10);
        const volSlider = document.getElementById(`vol-slider-${deviceId}`);
        const volVal = document.getElementById(`vol-val-${deviceId}`);
        if (volSlider) volSlider.value = val;
        if (volVal) volVal.textContent = `${val}%`;
      }
      if (muteNode) {
        const isMuted = muteNode.textContent === 'true';
        const muteBtn = document.getElementById(`mute-btn-${deviceId}`);
        if (muteBtn) {
          if (isMuted) {
            muteBtn.className = 'mute-btn muted';
            muteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
            muteBtn.title = 'Unmute Speaker';
          } else {
            muteBtn.className = 'mute-btn';
            muteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
            muteBtn.title = 'Mute Speaker';
          }
        }
      }
    }

    // 2. Bass Change
    const bassNode = updates.querySelector('bass');
    if (bassNode) {
      const targetBass = bassNode.querySelector('targetbass') || bassNode.querySelector('actualbass');
      if (targetBass) {
        const val = parseInt(targetBass.textContent, 10);
        const bassSlider = document.getElementById(`bass-slider-${deviceId}`);
        const bassVal = document.getElementById(`bass-val-${deviceId}`);
        if (bassSlider) bassSlider.value = val;
        if (bassVal) bassVal.textContent = val;
      }
    }

    // 3. Now Playing Change
    const nowPlayingNode = updates.querySelector('nowPlaying');
    if (nowPlayingNode) {
      const source = nowPlayingNode.getAttribute('source') || '';
      const powerOn = (source !== 'STANDBY');
      const powerBtn = document.getElementById(`power-btn-${deviceId}`);
      if (powerBtn) {
        powerBtn.className = `power-btn ${powerOn ? 'on' : 'off'}`;
        powerBtn.title = `Turn ${powerOn ? 'Off' : 'On'} (Current: ${powerOn ? 'ON' : 'STANDBY'})`;
      }

      const npVal = document.getElementById(`now-playing-val-${deviceId}`);
      if (npVal) {
        if (!powerOn) {
          npVal.textContent = 'Standby';
          npVal.style.color = 'var(--text-muted)';
        } else {
          const artistNode = nowPlayingNode.querySelector('artist');
          const trackNode = nowPlayingNode.querySelector('track');
          const stationNameNode = nowPlayingNode.querySelector('stationName');
          const contentItemNode = nowPlayingNode.querySelector('ContentItem');

          const artist = artistNode ? artistNode.textContent.trim() : '';
          const track = trackNode ? trackNode.textContent.trim() : '';
          let stationName = stationNameNode ? stationNameNode.textContent.trim() : '';
          if (!stationName && contentItemNode) {
            stationName = contentItemNode.getAttribute('itemName') || '';
          }

          let text = '';
          if (artist && track) {
            text = `${artist} - ${track}`;
          } else if (stationName) {
            text = stationName;
            if (track) text += ` (${track})`;
          } else if (track) {
            text = track;
          } else {
            text = `Playing (${source})`;
          }
          npVal.textContent = text;
          npVal.style.color = 'var(--color-primary)';
        }
      }
    }

    // 4. Presets Change
    const presetsChangedNode = updates.querySelector('presetsChangedNotifyUI');
    if (presetsChangedNode) {
      console.log(`[WebSocket] Presets changed for speaker ${deviceId}. Reloading presets...`);
      loadSpeakerPresets(ip, deviceId);
    }
  } catch (e) {
    console.error('Error handling WebSocket message XML:', e);
  }
}

