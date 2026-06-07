import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { LVK_IPC_CHANNELS, type LvkRuntimeStatus } from '../preload/api'

const runtimeStatus: LvkRuntimeStatus = {
  previewDummyUrl: 'http://localhost:5173/?source=dummy',
  previewNativeUrl: 'http://localhost:5173/?source=native',
  motionEndpoint: 'ws://127.0.0.1:45731/motion',
  nativeTrackerStatus: 'not_started',
  motionBridgeStatus: 'manual_dev_tool'
}

const allowedPreviewOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

function isSafeLocalPreviewUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return allowedPreviewOrigins.has(parsedUrl.origin) && parsedUrl.pathname === '/'
  } catch {
    return false
  }
}

function registerLvkIpcHandlers(): void {
  ipcMain.handle(LVK_IPC_CHANNELS.getRuntimeStatus, () => runtimeStatus)
  ipcMain.handle(LVK_IPC_CHANNELS.openExternalUrl, async (_event, url: unknown) => {
    if (typeof url !== 'string' || !isSafeLocalPreviewUrl(url)) {
      throw new Error('Only local LVK preview URLs can be opened from the desktop shell.')
    }

    await shell.openExternal(url)
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeLocalPreviewUrl(details.url)) {
      shell.openExternal(details.url)
    }

    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('dev.localvirtualkit.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerLvkIpcHandlers()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
