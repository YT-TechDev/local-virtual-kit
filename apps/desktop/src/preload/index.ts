import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { LVK_IPC_CHANNELS, type LvkDesktopApi, type LvkRuntimeStatus } from './api'

const api: LvkDesktopApi = {
  async getRuntimeStatus(): Promise<LvkRuntimeStatus> {
    return (await ipcRenderer.invoke(LVK_IPC_CHANNELS.getRuntimeStatus)) as LvkRuntimeStatus
  },
  async openExternalUrl(url: string): Promise<void> {
    await ipcRenderer.invoke(LVK_IPC_CHANNELS.openExternalUrl, url)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('lvk', api)
} else {
  const unsafeWindow = window as Window &
    typeof globalThis & {
      electron: typeof electronAPI
      lvk: LvkDesktopApi
    }

  unsafeWindow.electron = electronAPI
  unsafeWindow.lvk = api
}
