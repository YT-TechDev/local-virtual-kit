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
export type NativePipelineFaceDetector = 'noop' | 'opencv'

export interface NativePipelineStartOptions {
  cameraSource?: NativePipelineCameraSource
  faceDetector?: NativePipelineFaceDetector
  cameraIndex?: number
  cameraFps?: number
  cameraWidth?: number
  cameraHeight?: number
}

export interface DesktopRuntimeSettings {
  cameraSource: NativePipelineCameraSource
  faceDetector: NativePipelineFaceDetector
  cameraIndex: number
  cameraFps: number
  cameraWidth: number
  cameraHeight: number
}

export interface LvkRuntimeStatus {
  previewDummyUrl: string
  previewNativeUrl: string
  previewObsNativeUrl: string
  motionEndpoint: string
  nativeTrackerStatus: NativeTrackerStatus
  motionBridgeStatus: MotionBridgeStatus
  pipelineCameraSource?: NativePipelineCameraSource
  pipelineFaceDetector?: NativePipelineFaceDetector
  pipelineCameraIndex?: number
  pipelineCameraFps?: number
  pipelineCameraWidth?: number
  pipelineCameraHeight?: number
  lastError?: string
  lastMessage?: string
}

export interface LvkDesktopApi {
  getRuntimeStatus: () => Promise<LvkRuntimeStatus>
  getRuntimeSettings: () => Promise<DesktopRuntimeSettings>
  saveRuntimeSettings: (settings: DesktopRuntimeSettings) => Promise<DesktopRuntimeSettings>
  startNativePipeline: (options?: NativePipelineStartOptions) => Promise<LvkRuntimeStatus>
  stopNativePipeline: () => Promise<LvkRuntimeStatus>
  openExternalUrl: (url: string) => Promise<void>
}

export const LVK_IPC_CHANNELS = {
  getRuntimeStatus: 'lvk:get-runtime-status',
  getRuntimeSettings: 'lvk:get-runtime-settings',
  saveRuntimeSettings: 'lvk:save-runtime-settings',
  startNativePipeline: 'lvk:start-native-pipeline',
  stopNativePipeline: 'lvk:stop-native-pipeline',
  openExternalUrl: 'lvk:open-external-url'
} as const
