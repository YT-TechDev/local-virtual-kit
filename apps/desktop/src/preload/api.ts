export type NativeTrackerStatus = 'not_started'
export type MotionBridgeStatus = 'manual_dev_tool'

export interface LvkRuntimeStatus {
  previewDummyUrl: string
  previewNativeUrl: string
  motionEndpoint: string
  nativeTrackerStatus: NativeTrackerStatus
  motionBridgeStatus: MotionBridgeStatus
}

export interface LvkDesktopApi {
  getRuntimeStatus: () => Promise<LvkRuntimeStatus>
  openExternalUrl: (url: string) => Promise<void>
}

export const LVK_IPC_CHANNELS = {
  getRuntimeStatus: 'lvk:get-runtime-status',
  openExternalUrl: 'lvk:open-external-url'
} as const
