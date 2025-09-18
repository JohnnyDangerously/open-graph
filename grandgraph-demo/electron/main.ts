import { app, BrowserWindow } from "electron";
import path from "node:path";

const isDev = process.env.ELECTRON_START_URL ? true : !app.isPackaged;

async function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    backgroundColor: "#0a0a12",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  if (isDev) {
    const devUrl = process.env.ELECTRON_START_URL || "http://127.0.0.1:5173";
    await win.loadURL(devUrl);
    // Keep devtools closed by default; toggle manually if needed
  } else {
    const indexPath = path.join(__dirname, "../renderer/index.html");
    await win.loadFile(indexPath);
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });


