export type NativeTrackerStatus =
  | 'not_started'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'exited'
  | 'error'
export type MotionBridgeStatus =
  | 'manual_dev_tool'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'exited'
  | 'error'

export interface LvkRuntimeStatus {
  previewDummyUrl: string
  previewNativeUrl: string
  motionEndpoint: string
  nativeTrackerStatus: NativeTrackerStatus
  motionBridgeStatus: MotionBridgeStatus
  lastError?: string
  lastMessage?: string
}

export interface LvkDesktopApi {
  getRuntimeStatus: () => Promise<LvkRuntimeStatus>
  startNativePipeline: () => Promise<LvkRuntimeStatus>
  stopNativePipeline: () => Promise<LvkRuntimeStatus>
  openExternalUrl: (url: string) => Promise<void>
}

export const LVK_IPC_CHANNELS = {
  getRuntimeStatus: 'lvk:get-runtime-status',
  startNativePipeline: 'lvk:start-native-pipeline',
  stopNativePipeline: 'lvk:stop-native-pipeline',
  openExternalUrl: 'lvk:open-external-url'
} as const
