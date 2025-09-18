const { app, BrowserWindow } = require('electron')
// Relax web security for demo speed; do not ship like this
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
app.commandLine.appendSwitch('disable-site-isolation-trials')
const path = require('node:path')

const isDev = process.env.ELECTRON_START_URL ? true : !app.isPackaged

async function createWindow(){
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0a0a12',
    fullscreen: true,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  if (isDev) {
    const devUrl = process.env.ELECTRON_START_URL || 'http://127.0.0.1:5173'
    await win.loadURL(devUrl)
    // Keep devtools closed by default; toggle manually if needed
  } else {
    const indexPath = path.join(__dirname, '../renderer/index.html')
    await win.loadFile(indexPath)
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })


