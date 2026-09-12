/**
 * AuditX — Electron main process (Windows desktop shell).
 *
 * Loads the SAME dashboard build the web/PWA platforms use (no duplicated
 * business logic): it serves `dashboard/dist` through the file protocol and
 * the app talks to the same Firebase backend, Gemini analysis and AuditX API.
 */

const { app, BrowserWindow, shell, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const IS_DEV = Boolean(process.env.ELECTRON_START_URL)

// Resolve the built dashboard. In dev we can point at the Vite dev server.
const DEV_URL = process.env.ELECTRON_START_URL || 'http://localhost:5173'
function resolveIndex() {
  const candidates = [
    path.join(__dirname, 'dist', 'index.html'),
    path.join(__dirname, '..', 'dashboard', 'dist', 'index.html'),
  ]
  for (const file of candidates) {
    if (fs.existsSync(file)) return file
  }
  return candidates[1]
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'AuditX — Legal Metrology Compliance Inspection',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#eff6ff',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  win.once('ready-to-show', () => win.show())

  // Desktop-friendly window chrome title (matches branding, not the HTML title).
  win.on('page-title-updated', (e) => e.preventDefault())

  if (IS_DEV) {
    void win.loadURL(DEV_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(resolveIndex())
  }
  return win
}

/** Never let the app browse away to arbitrary origins inside the shell. */
function lockNavigation() {
  app.whenReady().then(() => {
    const { webContents } = session.defaultSession

    webContents.on('will-navigate', (event, url) => {
      const allowed = IS_DEV ? url.startsWith(DEV_URL) : url.startsWith('file://')
      if (!allowed) {
        event.preventDefault()
        if (url.startsWith('http')) void shell.openExternal(url)
      }
    })

    // Open target=_blank / window.open links in the system browser instead.
    webContents.on('set-window-open-handler', (details, callback) => {
      if (details.url.startsWith('http')) void shell.openExternal(details.url)
      callback({ action: 'deny' })
    })

    webContents.on('will-navigate', (event, url) => {
      if (/^https?:/.test(url)) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })

    // Camera / microphone access for label scanning (getUserMedia in the shell).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      const allowed = permission === 'media'
      callback(allowed)
    })
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return permission === 'media'
    })
  })
}

// Single instance — launching AuditX again focuses the running window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows()
    const win = wins[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    lockNavigation()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Quit on all platforms (desktop app target).
    app.quit()
  })
}