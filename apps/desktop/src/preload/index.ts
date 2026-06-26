import { contextBridge, ipcRenderer } from 'electron'
import {
  LVK_IPC_CHANNELS,
  type DesktopRuntimeSettings,
  type LvkDesktopApi,
  type LvkRuntimeStatus,
  type NativeRuntimeCapabilities,
  type NativePipelineStartOptions
} from './api'

const api: LvkDesktopApi = {
  async getRuntimeStatus(): Promise<LvkRuntimeStatus> {
    return (await ipcRenderer.invoke(LVK_IPC_CHANNELS.getRuntimeStatus)) as LvkRuntimeStatus
  },
  async getRuntimeSettings(): Promise<DesktopRuntimeSettings> {
    return (await ipcRenderer.invoke(LVK_IPC_CHANNELS.getRuntimeSettings)) as DesktopRuntimeSettings
  },
  async saveRuntimeSettings(settings: DesktopRuntimeSettings): Promise<DesktopRuntimeSettings> {
    return (await ipcRenderer.invoke(
      LVK_IPC_CHANNELS.saveRuntimeSettings,
      settings
    )) as DesktopRuntimeSettings
  },
  async startNativePipeline(options?: NativePipelineStartOptions): Promise<LvkRuntimeStatus> {
    return (await ipcRenderer.invoke(
      LVK_IPC_CHANNELS.startNativePipeline,
      options
    )) as LvkRuntimeStatus
  },
  async stopNativePipeline(): Promise<LvkRuntimeStatus> {
    return (await ipcRenderer.invoke(LVK_IPC_CHANNELS.stopNativePipeline)) as LvkRuntimeStatus
  },
  async openExternalUrl(url: string): Promise<void> {
    await ipcRenderer.invoke(LVK_IPC_CHANNELS.openExternalUrl, url)
  },
  async getNativeRuntimeCapabilities(): Promise<NativeRuntimeCapabilities> {
    return (await ipcRenderer.invoke(
      LVK_IPC_CHANNELS.getNativeRuntimeCapabilities
    )) as NativeRuntimeCapabilities
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('lvk', api)
} else {
  console.error('LVK preload API was not exposed because context isolation is disabled.')
}
