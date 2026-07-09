export type NativeTrackerStatus =
  | 'not_started'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'exited'
  | 'error'
export type MotionBridgeStatus =
  | 'not_started'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'exited'
  | 'error'

export type NativePipelineCameraSource = 'dummy' | 'opencv'
export type NativePipelineFaceDetector = 'noop' | 'opencv'

// Distinct from nativeTrackerStatus/motionBridgeStatus: this represents a
// bounded "tracker and bridge started, but no MotionFrame arrived yet" signal,
// not a spawn failure, bridge failure, or tracker exit.
export type NativePipelineStartupWarning = 'none' | 'no_frame_timeout'

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

export interface NativeRuntimeCapabilities {
  opencvCameraSupport: boolean | null
  opencvFaceDetectorSupport: boolean | null
  supportedCameraSources: string[]
  supportedFaceDetectors: string[]
  cameraOpened: false
  motionFramesEmitted: false
  localOnly: true
  error?: string
  skipped?: boolean
}

export interface LvkRuntimeStatus {
  previewDummyUrl: string
  previewNativeUrl: string
  previewObsNativeUrl: string
  motionEndpoint: string
  nativeTrackerStatus: NativeTrackerStatus
  motionBridgeStatus: MotionBridgeStatus
  startupWarning: NativePipelineStartupWarning
  pipelineCameraSource?: NativePipelineCameraSource
  pipelineFaceDetector?: NativePipelineFaceDetector
  pipelineCameraIndex?: number
  pipelineCameraFps?: number
  pipelineCameraWidth?: number
  pipelineCameraHeight?: number
  faceCascadePathConfigured?: boolean
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
  getNativeRuntimeCapabilities: () => Promise<NativeRuntimeCapabilities>
}

export const LVK_IPC_CHANNELS = {
  getRuntimeStatus: 'lvk:get-runtime-status',
  getRuntimeSettings: 'lvk:get-runtime-settings',
  saveRuntimeSettings: 'lvk:save-runtime-settings',
  startNativePipeline: 'lvk:start-native-pipeline',
  stopNativePipeline: 'lvk:stop-native-pipeline',
  openExternalUrl: 'lvk:open-external-url',
  getNativeRuntimeCapabilities: 'lvk:get-native-runtime-capabilities'
} as const
