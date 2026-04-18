const {app, shell, BrowserWindow, ipcMain, dialog, clipboard } = require('electron')
const path = require("path")
const BreadboardServer = require('./server')
const packagejson = require('./package.json')
const is_mac = process.platform.startsWith("darwin")

// Set userData to local appdata directory for portability
const appDataPath = path.join(__dirname, '..', 'appdata')
app.setPath('userData', appDataPath)
app.setPath('sessionData', path.join(appDataPath, 'sessions'))
app.setPath('cache', path.join(appDataPath, 'cache'))
app.setPath('logs', path.join(appDataPath, 'logs'))

// Initialize context menu after app is ready (ES module compatibility)
let contextMenuInitialized = false;

var mainWindow;
var root_url;
var wins = {}
var pinned = {}
var theme = "default";
const titleBarOverlay = (theme) => {
  if (is_mac) {
    return false
  } else {
    if (theme === "dark") {
      return {
        color: "#111",
        symbolColor: "white"
      }
    } else if (theme === "default") {
      return {
        color: "white",
        symbolColor: "black"
      }
    }
    return {
      color: "white",
      symbolColor: "black"
    }
  }
}
function createWindow (port) {
  mainWindow = new BrowserWindow({
		titleBarStyle : "hidden",
		titleBarOverlay : titleBarOverlay(),
    minWidth: 190,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    },
  })
  root_url = `http://localhost:${port}`
  mainWindow.loadURL(root_url)
  mainWindow.maximize();
}
class Socket {
  push(msg) {
    console.log("msg", msg)
  }
}
const breadboard = new BreadboardServer();

// Disable disk cache to avoid cache errors
app.commandLine.appendSwitch('disable-http-cache');

app.whenReady().then(async () => {
  // Initialize context menu with dynamic import for ES module compatibility
  if (!contextMenuInitialized) {
    try {
      const contextMenu = await import('electron-context-menu');
      contextMenu.default({ showSaveImageAs: true });
      contextMenuInitialized = true;
    } catch (error) {
      console.log('Error loading context menu:', error);
    }
  }

  await breadboard.init({
    theme,
    config: path.resolve(__dirname, "breadboard.yaml"),
    socket: new Socket(),
    version: packagejson.version,
    onconnect: (session) => {
      // Request handlers for api.js
      breadboard.ipc[session].handle("theme", (_session, _theme) => {
        // set the theme for ALL windows
        breadboard.ipc[_session].theme = _theme
        let all = BrowserWindow.getAllWindows()
        for(win of all) {
          if (win.setTitleBarOverlay) {
            const overlay = titleBarOverlay(breadboard.ipc[_session].theme)
            win.setTitleBarOverlay(overlay)
          }
        }
      })
      breadboard.ipc[session].handle('debug', (_session) => {
        // open debug console for only the current window
        let win = wins[_session]
        if (win) {
          win.openDevTools()
        }
      })
      breadboard.ipc[session].handle('select', async (_session) => {
        // only open one dialog
        let res = await dialog.showOpenDialog({ properties: ['openDirectory', 'showHiddenFiles'] })
        if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
          return res.filePaths
        }
      })
      breadboard.ipc[session].handle('open', async (_session, file_path) => {
        // only one
        await shell.showItemInFolder(file_path)
      })
      breadboard.ipc[session].handle('pinned', (_session) => {
        let win = wins[_session]
        let ontop = win.isAlwaysOnTop()
        if (win) {
          return { pinned: ontop }
        } else {
          return { pinned: false }
        }
      })
      breadboard.ipc[session].handle('pin', (_session) => {
        // pin the current window ONLY
        let win = wins[_session]
        if (win) {
          let pinned = win.isAlwaysOnTop()
          if (pinned) {
            win.setAlwaysOnTop(false)
          } else {
            win.setAlwaysOnTop(true, 'pop-up-menu');
          }
        }
      })
    }
  })


  // Request handlers for preload.js
  ipcMain.handle("ondragstart", (event, filePaths) => {
    if (event && event.sender) {
      event.sender.startDrag({
        files: filePaths,
        icon: filePaths[0]
      })
    }
  })
  app.on('web-contents-created', (event, webContents) => {
    let wc = webContents
    // override the user-agent header to the current breadboard tab
    webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      let connection = `breadboard connection ${details.webContents.id}`
      let win = details.webContents.getOwnerBrowserWindow()
      wins[connection] = win
      details.requestHeaders['User-Agent'] = connection
      callback({ requestHeaders: details.requestHeaders })
    })
    webContents.setWindowOpenHandler((config) => {
      let url = config.url
      let features = config.features
      let params = new URLSearchParams(features.split(",").join("&"))
      let win = wc.getOwnerBrowserWindow()
      let [width, height] = win.getSize()
      let [x,y] = win.getPosition()
      if (features && features.startsWith("popup")) {
        // Check if this is a viewer popup (larger, resizable, with title bar)
        const isViewer = url.includes('/viewer?')
        const windowOptions = {
          action: 'allow',
          outlivesOpener: true,
          overrideBrowserWindowOptions: {
            width: isViewer ? Math.floor(width * 0.6) : (params.get("width") ? parseInt(params.get("width")) : width),
            height: isViewer ? Math.floor(height * 0.8) : (params.get("height") ? parseInt(params.get("height")) : height),
            x: x + 30,
            y: y + 30,
            parent: null,
            resizable: true,
            movable: true,
            minimizable: true,
            maximizable: true,
            autoHideMenuBar: isViewer ? true : false,
            webPreferences: {
              preload: path.join(__dirname, 'preload.js')
            },
          }
        }
        
        // Only use hidden title bar for non-viewer popups
        if (!isViewer) {
          windowOptions.overrideBrowserWindowOptions.titleBarStyle = "hidden"
          windowOptions.overrideBrowserWindowOptions.titleBarOverlay = titleBarOverlay()
        }
        
        return windowOptions
      } else {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });
  })

  createWindow(breadboard.port)
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(breadboard.port)
  })
  app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit()
  })

})
