# BASSS (Broadcast App and Server for SoundTouch Speakers)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/hxmelab/basss/blob/master/LICENSE)
[![GitHub Release](https://img.shields.io/github/release/hxmelab/basss.svg)](https://github.com/hxmelab/basss/releases/latest)
[![GitHub Downloads](https://img.shields.io/github/downloads/hxmelab/basss/total.svg)](https://github.com/hxmelab/basss/releases)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/O4O4NNOCL)

BASSS is a lightweight, easy-to-use, local, and private alternative designed to rescue Bose SoundTouch speakers from the official cloud server shutdown. 

By bypassing the deprecated official cloud server and running entirely on your local home network, BASSS combines a local Node.js/Express server (listening on port `8053`) with an elegant Electron desktop frontend to keep your speakers fully operational. 

Unlike other smart home servers, **BASSS does not need to run 24/7**. Once configured, the speakers stream radio stations directly from the web. The app is only needed if a speaker is completely disconnected from power to sync settings on startup, or to change presets and browse radio stations.

---

## Screenshots

### 1. Dashboard View
![BASSS Dashboard](media/screenshot-dashboard.png)

### 2. Radio Browser & Favorites
![Radio Browser 1](media/screenshot-radio-1.png)
![Radio Browser 2](media/screenshot-radio-2.png)
![Radio Browser 3](media/screenshot-radio-3.png)
![Radio Browser 4](media/screenshot-radio-4.png)

### 3. Modification Wizard
![Modification Wizard](media/screenshot-modify.png)

---

## Key Features

* **No Account Required**: No need to create an account or log in to use BASSS. Simply open the app and it will automatically discover your speakers.
* **Device-Specific Presets**: Presets are bound directly to your speakers instead of a shared global user account. Hence, every speaker can have its own presets. 
* **Radio Browser Integration**: Search over thousands of global radio streams powered by the free community-driven `radio-browser.info` directory and assign them directly to speaker presets.
* **Autonomy**: Speakers connect directly to the audio stream URLs. You can safely close the BASSS app once configured. No need to run BASSS 24/7.
* **Boot Recovery**: Only, if a speaker gets unplugged from power, simply open BASSS for a moment while the speaker is booting, let it sync its configuration, and it will be autonomous again. You can close BASSS afterwards. All your presets stay available on the speaker. 
* **Local Emulation Server**: Built-in Express server listening on a local port on your computer to intercept and serve speaker registration and preset requests locally.
* **Modification Wizard**: A step-by-step assistant that helps you to reconfigure the speakers. Super easy and safe!
* **Real-Time Synchronisation**: Uses the speaker's native protocol to synchronize volume, bass, presets, standby, and now-playing metadata instantly.
* **No Ads**: This app is ad-free.

---

## Download & Installation 

### On Windows
Just download and run `BASSS-<version>.exe` on Windows. Windows will warn you that it's an unknown publisher. Due to this open source project being unsigned, you will have to click on "More info" and then "Run anyway". After that a confirmation dialog will appear asking you to allow access to run the local server on port 8053.

* [Download BASSS for Windows 64-bit](https://github.com/hxmelab/basss/releases)

### On macOS
Download `BASSS-<version>-arm64.dmg` for macOS. Since this is an open-source project and is not signed with a paid Apple Developer account, macOS Gatekeeper will block it by default. When you try to run it after dragging it to the Applications folder, macOS will show a warning saying **"BASSS is damaged and can't be opened"** (or *"BASSS ist beschädigt und kann nicht geöffnet werden"*).

To resolve this and run the app:
1. Open the downloaded `.dmg` file and drag **BASSS** to your **Applications** folder.
2. Open the **Terminal** app.
3. Run the following command to remove the macOS quarantine flag:
   ```bash
   xattr -cr /Applications/BASSS.app
   ```
4. You can now open BASSS normally from your Applications folder or Spotlight.

* [Download BASSS for macOS](https://github.com/hxmelab/basss/releases)

## Developer Guide

### Prerequisites
*   [Node.js](https://nodejs.org/) (v16 or higher recommended)
*   [npm](https://www.npmjs.com/) (bundled with Node.js)

### Development Setup
1.  Clone this repository or extract the project files.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the application in development mode (launches the Express server and Electron window):
    ```bash
    npm run electron
    ```

### Production Packaging
BASSS uses `electron-builder` to package standalone executable packages.

*   **For Windows** (creates an installer `.exe` and a portable executable inside `dist/`):
    ```bash
    npm run build:win
    ```
*   **For macOS** (creates `.dmg` and `.zip` archives inside `dist/` - *requires a macOS host*):
    ```bash
    npm run build:mac
    ```
*   **For the local platform**:
    ```bash
    npm run build
    ```

---

## Server & Command Line Modification

BASSS can also run purely as a server via the command line, for example on a Raspberry Pi. Likewise, it is possible to modify the SoundTouch speakers using the terminal.

### 1. Running the Server with PM2 (Headless Linux)

If you want to host BASSS on a Linux server (e.g., Debian or Raspberry Pi OS) without the desktop interface, you can run only the Express backend.

Make sure Node.js (v16+) and npm are installed on your Linux machine. 

If your Linux system has a firewall active, you must open port `8053` (note that on a default Debian/Raspberry Pi OS installation, no firewall is active by default, so ports are already open and you can skip this):

* If you are using **UFW** (install with `sudo apt install ufw` if missing):
  ```bash
  sudo ufw allow 8053/tcp
  ```
* If you are using **iptables** (install with `sudo apt install iptables` if missing):
  ```bash
  sudo iptables -A INPUT -p tcp --dport 8053 -j ACCEPT
  ```
* If you are using **nftables** (default on modern Debian):
  ```bash
  sudo nft add rule inet filter input tcp dport 8053 accept
  ```

#### Setup and Start
1. Clone the repository and install only the production dependencies (omitting Electron):
   ```bash
   npm install --production
   ```
2. To keep the server running 24/7 in the background, I recommend using **PM2**:
   ```bash
   # Install PM2 globally
   sudo npm install -g pm2

   # Start the BASSS backend server
   pm2 start src/server.js --name "basss-server"

   # Ensure PM2 starts automatically on system boot
   pm2 startup
   pm2 save
   ```

### 2. Modifying SoundTouch Speakers via CLI

You can perform the speaker redirection wizard directly from the command line using the helper script located in `src/modify.js`.

#### Script Configuration
Before running the script, open [src/modify.js](file:///c:/Code/github/basss/src/modify.js) in a text editor and adjust the parameters at the top of the file to match your network setup:

```javascript
// ==========================================================================
// CONFIGURATION PARAMETERS
// ==========================================================================
const NAME = "SoundTouch";          // Name of the Bose speaker
const SPEAKER = "192.168.0.53";    // IP address of the Bose speaker
const SERVER = "raspi.fritz.box";   // IP/Hostname of your BASSS server
const PORT = 8053;                  // Port of your BASSS server
// ==========================================================================
```

#### Running the Script
Execute the script using Node.js:
```bash
node src/modify.js
```
The script will dynamically generate a random 7-digit Account UUID, connect to the speaker via Telnet (port 23), back up the original `SystemConfigurationDB.xml` to `SystemConfiguration.bak`, write the redirect files to the speaker, and trigger a reboot to apply the changes.

---

## Technical Details & Architecture

```
BASSS/
├── data/                  # Local datastores (dev mode only)
│   ├── devices.json       # Configured speakers, presets & settings
│   └── favorites.json     # Saved favorite radio stations
├── media/                 # Assets (App icons, screenshots)
├── src/
│   ├── renderer/          # Frontend assets (HTML, CSS, JS)
│   │   ├── index.html     # Main UI window structure
│   │   ├── index.css      # Custom styling, dark theme, transitions
│   │   └── renderer.js    # UI event handlers and IPC client
│   ├── resources/         # XML configuration templates for Bose speakers
│   ├── datastore.js       # Persistent file-based JSON storage controller
│   ├── discovery.js       # SSDP & mDNS speaker scanner
│   ├── routes.js          # REST endpoints emulating the Bose Marge API
│   ├── modify.js          # CLI script to automate speaker redirection
│   ├── server.js          # Express backend server with startup health-checks
│   └── service.js         # SoundTouch business logic and XML builders
├── main.js                # Electron main process (system window, IPC router, DNS checks)
├── preload.js             # Electron bridge API (contextBridge)
├── package.json           # Scripts, dependencies, and builder config
└── LICENSE                # MIT license file
```

### Data Storage
To support read-only directory packaging, BASSS uses dynamic persistent storage:
*   **Development Mode**: Saves locally under `./data/devices.json` and `./data/favorites.json`.
*   **Packaged Mode (Production)**: Saves in your operating system's user profile data directory to prevent write errors:
    *   **Windows**: `C:\Users\<username>\AppData\Roaming\basss\data\`
    *   **macOS**: `~/Library/Application Support/basss/data/`

### How the Speaker Redirection Works
By default, SoundTouch speakers try to contact Bose's cloud servers. BASSS works by deploying a configuration file to the speaker's internal storage. 

This config override redirects registration, statistics, and sync requests to your computer instead of the official Bose cloud. This is safe, risk-free, and can be undone at any time. 

---

## Support & Donation

If BASSS rescued your Bose speakers and saved you the cost of buying new ones, please consider supporting the development. Your donation keeps active development and community support alive!

You can support my work directly on [Ko-fi](https://ko-fi.com/homelab).

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

*Disclaimer: This application is an independent, open-source project. Bose and SoundTouch are trademarks of Bose Corporation. This application is concluded between the developer and the end-user only. Bose Corporation does not in any way endorse, approve of, or sponsor this application.*
