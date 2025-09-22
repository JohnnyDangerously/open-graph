const { app, BrowserWindow } = require('electron')
// Relax web security for demo speed; guard if app not ready
try { if (app && app.commandLine) {
  app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
  app.commandLine.appendSwitch('disable-site-isolation-trials')
} } catch {}
const path = require('node:path')

const isDev = process.env.ELECTRON_START_URL ? true : !app.isPackaged

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

  if (isDev) {
    const devUrl = process.env.ELECTRON_START_URL || 'http://127.0.0.1:5174'
    await win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    const indexPath = path.join(__dirname, '../renderer/index.html')
    await win.loadFile(indexPath)
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// Add F12 shortcut to toggle dev tools
app.on('web-contents-created', (event, contents) => {
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      const win = contents.getOwnerBrowserWindow()
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools()
      } else {
        win.webContents.openDevTools()
      }
    }
  })
})


