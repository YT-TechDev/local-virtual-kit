import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { NativePipelineManager } from './nativePipeline'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  LVK_IPC_CHANNELS,
  type NativePipelineCameraSource,
  type NativePipelineFaceDetector,
  type NativePipelineStartOptions
} from '../preload/api'

const nativePipeline = new NativePipelineManager()

const allowedPreviewUrls = new Set([
  'http://localhost:5173/?source=dummy',
  'http://localhost:5173/?source=native',
  'http://localhost:5173/?mode=obs&source=native',
  'http://127.0.0.1:5173/?source=dummy',
  'http://127.0.0.1:5173/?source=native',
  'http://127.0.0.1:5173/?mode=obs&source=native'
])

function isSafeLocalPreviewUrl(url: string): boolean {
  try {
    return allowedPreviewUrls.has(new URL(url).href)
  } catch {
    return false
  }
}

function parseNativePipelineStartOptions(options: unknown): NativePipelineStartOptions {
  if (options === undefined) {
    return {}
  }

  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new Error('Native pipeline start options must be an object when provided.')
  }

  const { cameraSource, faceDetector, cameraIndex, cameraFps } = options as {
    cameraSource?: unknown
    faceDetector?: unknown
    cameraIndex?: unknown
    cameraFps?: unknown
  }
  const parsedOptions: NativePipelineStartOptions = {}

  if (cameraSource !== undefined) {
    if (cameraSource !== 'dummy' && cameraSource !== 'opencv') {
      throw new Error('Native pipeline camera source must be either dummy or opencv.')
    }

    parsedOptions.cameraSource = cameraSource satisfies NativePipelineCameraSource
  }

  if (faceDetector !== undefined) {
    if (faceDetector !== 'noop' && faceDetector !== 'opencv') {
      throw new Error('Native pipeline face detector must be either noop or opencv.')
    }

    parsedOptions.faceDetector = faceDetector satisfies NativePipelineFaceDetector
  }

  if (cameraIndex !== undefined) {
    if (
      typeof cameraIndex !== 'number' ||
      !Number.isFinite(cameraIndex) ||
      !Number.isInteger(cameraIndex)
    ) {
      throw new Error('Native pipeline camera index must be a finite integer.')
    }

    if (cameraIndex < 0 || cameraIndex > 16) {
      throw new Error('Native pipeline camera index must be between 0 and 16.')
    }

    parsedOptions.cameraIndex = cameraIndex
  }

  if (cameraFps !== undefined) {
    if (typeof cameraFps !== 'number' || !Number.isFinite(cameraFps)) {
      throw new Error('Native pipeline camera FPS must be a finite number.')
    }

    if (cameraFps < 1 || cameraFps > 240) {
      throw new Error('Native pipeline camera FPS must be between 1 and 240.')
    }

    parsedOptions.cameraFps = cameraFps
  }

  return parsedOptions
}

function registerLvkIpcHandlers(): void {
  ipcMain.handle(LVK_IPC_CHANNELS.getRuntimeStatus, () => nativePipeline.getStatus())
  ipcMain.handle(LVK_IPC_CHANNELS.startNativePipeline, (_event, options: unknown) =>
    nativePipeline.start(parseNativePipelineStartOptions(options))
  )
  ipcMain.handle(LVK_IPC_CHANNELS.stopNativePipeline, () => nativePipeline.stop())
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
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

app.on('before-quit', () => {
  nativePipeline.cleanupOnQuit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
