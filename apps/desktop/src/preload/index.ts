import { contextBridge, ipcRenderer } from 'electron'
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
  contextBridge.exposeInMainWorld('lvk', api)
} else {
  console.error('LVK preload API was not exposed because context isolation is disabled.')
}
