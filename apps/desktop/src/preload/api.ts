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

export type NativePipelineCameraSource = 'dummy' | 'opencv'

export interface NativePipelineStartOptions {
  cameraSource: NativePipelineCameraSource
}

export interface LvkRuntimeStatus {
  previewDummyUrl: string
  previewNativeUrl: string
  motionEndpoint: string
  nativeTrackerStatus: NativeTrackerStatus
  motionBridgeStatus: MotionBridgeStatus
  pipelineCameraSource?: NativePipelineCameraSource
  lastError?: string
  lastMessage?: string
}

export interface LvkDesktopApi {
  getRuntimeStatus: () => Promise<LvkRuntimeStatus>
  startNativePipeline: (options?: NativePipelineStartOptions) => Promise<LvkRuntimeStatus>
  stopNativePipeline: () => Promise<LvkRuntimeStatus>
  openExternalUrl: (url: string) => Promise<void>
}

export const LVK_IPC_CHANNELS = {
  getRuntimeStatus: 'lvk:get-runtime-status',
  startNativePipeline: 'lvk:start-native-pipeline',
  stopNativePipeline: 'lvk:stop-native-pipeline',
  openExternalUrl: 'lvk:open-external-url'
} as const
