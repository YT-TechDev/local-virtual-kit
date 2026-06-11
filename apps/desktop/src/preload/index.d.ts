import type { LvkDesktopApi } from './api'

declare global {
  interface Window {
    lvk?: LvkDesktopApi
  }
}
