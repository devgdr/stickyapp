# StickyVault

A modern, cross-platform sticky notes app with **Dropbox sync** and a beautiful glassmorphism UI.

![Build Status](https://github.com/stickyvault/stickyapp/actions/workflows/build-release.yml/badge.svg)

## 🚀 Features

- **Cross-Platform** — Android, Linux, Windows, macOS
- **Dropbox Sync** — Real-time cloud synchronization
- **Markdown Support** — Write notes in Markdown with live preview
- **Glassmorphism UI** — Modern, sleek design with blur effects
- **Offline First** — Works without internet, syncs when connected

## 📦 Project Structure

```
stickyapp/
├── core/           # Shared TypeScript library (note operations)
├── sticky/         # Desktop app (Electron + Vite + React)
├── stickyNote/     # Mobile app (React Native + Expo)
└── .github/        # CI/CD workflows
```

## 🛠️ Development

### Prerequisites

- Node.js 20+
- npm or yarn
- Android Studio (for mobile)

### Desktop App

```bash
cd sticky
npm install
npm run dev          # Development mode
npm run build        # Build for production
```

### Mobile App

```bash
cd stickyNote
npm install
npm start            # Expo dev server
npm run android      # Run on Android
```

### Core Library

```bash
cd core
npm install
npm run build        # Build TypeScript
npm test             # Run tests
```

## 📱 Downloads

Pre-built releases are available on the [Releases](https://github.com/stickyvault/stickyapp/releases) page:

- **Android** — `.apk`
- **Linux** — `.AppImage`, `.deb`
- **Windows** — `.exe`
- **macOS** — `.dmg`

## 🔐 Dropbox Setup

1. Create a Dropbox app at [Dropbox Developers](https://www.dropbox.com/developers/apps)
2. Set redirect URI to `stickyvault://oauth/callback`
3. Add your app key to the environment

## 📄 License

MIT
