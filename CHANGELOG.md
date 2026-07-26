# Changelog

All notable changes to the **BASSS** project will be documented in this file.

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
