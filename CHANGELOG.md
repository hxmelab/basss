# Changelog

All notable changes to the **BASSS** project will be documented in this file.

## [1.0.4] - 2026-08-10

- Upgrade GitHub Actions `actions/checkout` (to `v6`) and `actions/setup-node` (to `v7`) in `release.yml` to resolve Node.js 20 deprecation warnings on the runners.
- Fix a bug in the `modify.js` CLI script where newly configured speakers would lose their account configuration upon reboot by automatically querying the speaker's MAC address and registering the new account mapping on the BASSS server.
- Add custom color coding for server logs (both in the terminal and in the Electron app log viewer): Blue for responses, Green for GET/POST/PUT requests and request bodies, Yellow for unknown route requests (404), and Red for error outputs.

## [1.0.3] - 2026-08-05

- Add a **Play Favorite** feature to the dashboard allowing users to play a saved favorite station directly on a specific speaker without assigning it to a preset.
- Add a delete (trash can) button to dashboard device cards to delete speaker configuration from `devices.json` and remove the card from the dashboard view.

## [1.0.2] - 2026-08-02

- Fix file write failures (ENOENT) in compiled standalone builds on Windows, macOS, and Linux by storing generated speaker configuration files (`OverrideSdkPrivateCfg.xml` and `SystemConfiguration.xml`) in the writable user data directory instead of the read-only ASAR package.

## [1.0.1] - 2026-07-30

- Increase the BMX Registry `askAgainAfter` polling interval to `864000000` milliseconds (10 days) to avoid frequent registry requests.
- Prevent `GUEST_VIEW_MANAGER_CALL` (`ERR_ABORTED`) error on startup by loading the Radio Browser webview programmatically in `renderer.js` instead of using the inline HTML `src` attribute.
- Silence verbose warning and retry logs from the Radio Browser API server fallback pool to keep the console output clean.

## [1.0.0] - 2026-07-24

Initial release of **BASSS (Broadcast App and Server for SoundTouch Speakers)** – a lightweight, easy to use, local, and private alternative designed to rescue Bose SoundTouch speakers from the cloud server shutdown.

### Added

#### Core & Backend (Node.js/Express)
- **Local Emulation Server**: Built-in Express server listening on a configurable local port (default `8053`) to intercept and serve SoundTouch requests locally.
- **Device-Specific Presets**: Replaced the traditional global preset architecture. Presets are now bound directly to unique Device IDs (configured via `presets.json`).
- **Cold Boot Recovery**: Restores configuration settings automatically to speakers when they boot after power loss.
- **Standalone Autonomy**: Once configured, the speakers stream directly from raw audio URLs. BASSS does not need to run 24/7.
- **DNS Resolution Checks**: Proactive check using `dns.resolve4()` to verify hostname accessibility (e.g. marking `.local` hostnames as unavailable/red to reflect that speakers cannot resolve them via unicast DNS).

#### WebSocket Connection & Real-Time Sync
- **Gabbo WebSocket Client**: Implemented a native WebSocket connection on port `8080` using the `gabbo` protocol.
- **Real-Time Synchronisation**: Changes to volume, presets, or now playing metadata are pushed instantly from the speakers to the desktop UI.

#### Desktop Frontend (Electron)
- **Interactive Dashboard**: Modern dark-themed dashboard built with HTML5, vanilla CSS, and JavaScript.
- **Structured Layout**: Structured card layout placing Volume on top, followed by Bass, Presets 1-6, and Device Details at the bottom.
- **Dynamic Power Status Indicator**: Displays a green dot for active playback, red for `STANDBY`, and grey for offline.
- **Now Playing Component**: Displays active source, and streaming metadata.
- **Combined Source Button**: Unified Bluetooth & AUX source button that triggers key commands.
- **Radio-Browser Integration**: Seamless search and directory access using the free `radio-browser.info` API. Save radio stations directly to Favorites and map them to presets.
- **Guided Modification**: Step by step guided for easy modification.
