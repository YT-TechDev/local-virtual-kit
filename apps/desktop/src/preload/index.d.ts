import { ElectronAPI } from '@electron-toolkit/preload'
import type { LvkDesktopApi } from './api'

declare global {
  interface Window {
    electron: ElectronAPI
    lvk: LvkDesktopApi
  }
}
