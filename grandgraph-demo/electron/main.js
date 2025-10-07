const { app, BrowserWindow, ipcMain } = require('electron')
// Relax web security for demo speed; guard if app not ready
try { if (app && app.commandLine) {
  app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
  app.commandLine.appendSwitch('disable-site-isolation-trials')
} } catch {}
const path = require('node:path')

const isDev = !!process.env.ELECTRON_START_URL

async function createWindow(){
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0a0a12',
    fullscreen: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  const loadBuilt = async () => {
    const indexPath = path.join(__dirname, '../dist/renderer/index.html')
    await win.loadFile(indexPath)
  }

  if (isDev) {
    const devUrl = process.env.ELECTRON_START_URL || 'http://127.0.0.1:5174'
    try {
      await win.loadURL(devUrl)
    } catch (_err) {
      await loadBuilt()
    }
    // Keep devtools closed by default; toggle manually if needed
  } else {
    await loadBuilt()
  }

  // IPC: open DevTools on demand from renderer
  try {
    // avoid re-registering on hot reloads
    if (!(app).__openDevtoolsRegistered) {
      ipcMain.handle('open-devtools', () => {
        const focused = BrowserWindow.getFocusedWindow() || win
        try { focused?.webContents?.openDevTools({ mode: 'detach' }) } catch {}
        return true
      })
      ;(app).__openDevtoolsRegistered = true
    }
  } catch {}
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })


