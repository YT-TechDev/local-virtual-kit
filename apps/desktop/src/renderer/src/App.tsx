import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DesktopRuntimeSettings,
  LvkRuntimeStatus,
  MotionBridgeStatus,
  NativeRuntimeCapabilities,
  NativePipelineCameraSource,
  NativePipelineFaceDetector,
  NativePipelineTrackingBackend,
  NativeTrackerStatus
} from '../../preload/api'

type RuntimeStatus = LvkRuntimeStatus
type StatusTone = 'neutral' | 'warning' | 'success' | 'danger'
type PipelineActionPending = null | 'start' | 'start-and-open' | 'stop'
type RuntimeStatusRefreshMessage = {
  diagnostics: string
  message: string
  tone: 'success' | 'danger'
}
type CopyDiagnosticsMessage = {
  diagnostics: string
  message: string
}
type CopyCapabilitiesMessage = {
  message: string
  summary: string
}
type SettingsErrorMessage = {
  detail: string
  summary: string
}
type SettingsSaveFeedback = {
  message: string
  settingsKey: string
}
type StopFeedback = {
  message: string
  nativeTrackerStatus: NativeTrackerStatus
}
type StartFeedback = {
  message: string
  nativeTrackerStatus: NativeTrackerStatus
}
type PreviewOpenFeedback = {
  message: string
  nativeTrackerStatus: NativeTrackerStatus
}
type ObsPreviewSource = 'dummy' | 'native'
type ObsPreviewAction = 'copy' | 'open'
type ObsPreviewActionContext = {
  source: ObsPreviewSource
  action: ObsPreviewAction
  url: string
}
type ObsPreviewActionPending = ObsPreviewActionContext | null
type ObsPreviewActionFeedback = ObsPreviewActionContext & {
  message: string
  tone: 'success' | 'danger'
  nativeTrackerStatus?: NativeTrackerStatus
  motionBridgeStatus?: MotionBridgeStatus
}

const RUNTIME_STATUS_POLL_INTERVAL_MS = 1500
const MIN_CAMERA_INDEX = 0
const MAX_CAMERA_INDEX = 16
const DEFAULT_CAMERA_FPS = 60
const MIN_CAMERA_FPS = 1
const MAX_CAMERA_FPS = 240
const DEFAULT_CAMERA_WIDTH = 640
const DEFAULT_CAMERA_HEIGHT = 480

const DEFAULT_RUNTIME_SETTINGS: DesktopRuntimeSettings = {
  cameraSource: 'dummy',
  faceDetector: 'noop',
  cameraIndex: MIN_CAMERA_INDEX,
  cameraFps: DEFAULT_CAMERA_FPS,
  cameraWidth: DEFAULT_CAMERA_WIDTH,
  cameraHeight: DEFAULT_CAMERA_HEIGHT,
  trackingBackend: 'face-pipeline'
}
const MIN_CAMERA_WIDTH = 1
const MAX_CAMERA_WIDTH = 7680
const MIN_CAMERA_HEIGHT = 1
const MAX_CAMERA_HEIGHT = 4320

const developmentCommands = [
  'pnpm dev:web',
  'cmake -S native/tracker-core -B native/tracker-core/build',
  'cmake --build native/tracker-core/build',
  './native/tracker-core/build/lvk-tracker-core --camera-source dummy --face-detector noop --continuous --realtime --camera-fps 60 --camera-width 640 --camera-height 480 --log-pipeline-status --pipeline-status-interval 60 | node tools/motion-ws-bridge.mjs',
  './native/tracker-core/build/lvk-tracker-core --camera-source opencv --face-detector noop --camera-index 0 --continuous --realtime --camera-fps 60 --camera-width 640 --camera-height 480 --log-pipeline-status --pipeline-status-interval 60 --log-camera-status --camera-status-interval 60 | node tools/motion-ws-bridge.mjs',
  'LVK_FACE_CASCADE_PATH=/path/to/haarcascade.xml ./native/tracker-core/build/lvk-tracker-core --camera-source opencv --face-detector opencv --face-cascade /path/to/haarcascade.xml --frames 3 --camera-fps 60 --camera-width 640 --camera-height 480 --log-face-status'
]

const cameraSourceLabels: Record<NativePipelineCameraSource, string> = {
  dummy: 'Dummy source',
  opencv: 'OpenCV camera'
}

const coerceCameraIndex = (value: unknown): number => {
  const numericValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numericValue)) {
    return MIN_CAMERA_INDEX
  }

  return Math.min(MAX_CAMERA_INDEX, Math.max(MIN_CAMERA_INDEX, Math.trunc(numericValue)))
}

const coerceCameraFps = (value: unknown): number => {
  const numericValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_CAMERA_FPS
  }

  return Math.min(MAX_CAMERA_FPS, Math.max(MIN_CAMERA_FPS, numericValue))
}

const coerceCameraWidth = (value: unknown): number => {
  const numericValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_CAMERA_WIDTH
  }

  return Math.min(MAX_CAMERA_WIDTH, Math.max(MIN_CAMERA_WIDTH, Math.trunc(numericValue)))
}

const coerceCameraHeight = (value: unknown): number => {
  const numericValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_CAMERA_HEIGHT
  }

  return Math.min(MAX_CAMERA_HEIGHT, Math.max(MIN_CAMERA_HEIGHT, Math.trunc(numericValue)))
}

const isNativePipelineCameraSource = (value: string | null): value is NativePipelineCameraSource =>
  value === 'dummy' || value === 'opencv'

const isNativePipelineFaceDetector = (value: string | null): value is NativePipelineFaceDetector =>
  value === 'noop' || value === 'opencv'

const isNativePipelineTrackingBackend = (
  value: string | null
): value is NativePipelineTrackingBackend =>
  value === 'face-pipeline' || value === 'mediapipe-face-landmarker'

const normalizeRuntimeSettings = (settings: DesktopRuntimeSettings): DesktopRuntimeSettings => ({
  cameraSource: settings.cameraSource,
  faceDetector: settings.faceDetector,
  cameraIndex: coerceCameraIndex(settings.cameraIndex),
  cameraFps: coerceCameraFps(settings.cameraFps),
  cameraWidth: coerceCameraWidth(settings.cameraWidth),
  cameraHeight: coerceCameraHeight(settings.cameraHeight),
  trackingBackend: settings.trackingBackend
})

const getRuntimeSettingsKey = (settings: DesktopRuntimeSettings): string =>
  JSON.stringify(normalizeRuntimeSettings(settings))

const faceDetectorLabels: Record<NativePipelineFaceDetector, string> = {
  noop: 'Noop face detector',
  opencv: 'OpenCV face detection'
}

const trackingBackendLabels: Record<NativePipelineTrackingBackend, string> = {
  'face-pipeline': 'Face pipeline',
  'mediapipe-face-landmarker': 'MediaPipe Face Landmarker (development)'
}

const statusLabels: Record<RuntimeStatus['nativeTrackerStatus'], string> = {
  not_started: 'Not started',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  exited: 'Exited',
  error: 'Error'
}

const bridgeLabels: Record<RuntimeStatus['motionBridgeStatus'], string> = {
  not_started: 'Not started',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  exited: 'Exited',
  error: 'Error'
}

const pipelineActionPendingMessages: Record<Exclude<PipelineActionPending, null>, string> = {
  start: 'Starting native pipeline...',
  'start-and-open': 'Starting native pipeline and opening preview...',
  stop: 'Stopping native pipeline...'
}

const buildObsPendingMessage = (context: ObsPreviewActionContext): string => {
  if (context.action === 'open') {
    return context.source === 'dummy'
      ? 'Opening OBS dummy preview...'
      : 'Opening OBS native preview...'
  }

  return context.source === 'dummy' ? 'Copying OBS dummy URL...' : 'Copying OBS native URL...'
}

const resolveObsSourceFeedback = (
  feedback: ObsPreviewActionFeedback | null,
  source: ObsPreviewSource,
  url: string,
  status: RuntimeStatus
): ObsPreviewActionFeedback | null => {
  if (!feedback || feedback.source !== source || feedback.url !== url) {
    return null
  }

  if (
    source === 'native' &&
    (feedback.nativeTrackerStatus !== status.nativeTrackerStatus ||
      feedback.motionBridgeStatus !== status.motionBridgeStatus)
  ) {
    return null
  }

  return feedback
}

const isNativePipelineRunning = (status: RuntimeStatus): boolean =>
  status.nativeTrackerStatus === 'running' && status.motionBridgeStatus === 'running'

const buildNativeRuntimeDiagnostics = (
  status: RuntimeStatus,
  pipelineError: string | null
): string =>
  [
    `Native tracker status: ${statusLabels[status.nativeTrackerStatus]}`,
    `Motion bridge status: ${bridgeLabels[status.motionBridgeStatus]}`,
    status.startupWarning === 'no_frame_timeout'
      ? 'Startup warning: no MotionFrame received within the startup window.'
      : null,
    status.lastMessage ? `Latest status: ${status.lastMessage}` : null,
    status.lastError ? `Latest error: ${status.lastError}` : null,
    pipelineError ? `Pipeline error: ${pipelineError}` : null
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')

const formatCapabilitySupport = (support: boolean | null): string => {
  if (support === true) {
    return 'enabled'
  }

  if (support === false) {
    return 'disabled'
  }

  return 'unknown'
}

const formatCapabilityList = (values: string[]): string =>
  values.length > 0 ? values.join(', ') : 'none'

const formatNativeCapabilitiesCheckedAtLabel = (checkedAt: Date): string =>
  checkedAt.toLocaleString()

const getCapabilitiesResultState = (capabilities: NativeRuntimeCapabilities): string => {
  if (capabilities.skipped === true) {
    return 'skipped'
  }

  if (capabilities.error !== undefined) {
    return 'error'
  }

  return 'available'
}

const sanitizeCapabilityErrorMessage = (message: string): string =>
  message
    .replace(/[A-Za-z]:\\[^\s]+/gu, '[local path]')
    .replace(/(?:\/[^\s]+)+/gu, '[local path]')
    .replace(
      /\b(?:stdout|stderr|executable path|binary path|local path|command dump|screenshot|log|raw frame)s?\b/giu,
      '[redacted]'
    )

const buildNativeCapabilitiesCopySummary = (
  capabilities: NativeRuntimeCapabilities,
  checkedAt: Date | null
): string => {
  const lines = [
    `OpenCV camera support: ${formatCapabilitySupport(capabilities.opencvCameraSupport)}`,
    `OpenCV face detector support: ${formatCapabilitySupport(
      capabilities.opencvFaceDetectorSupport
    )}`,
    `Supported camera sources: ${formatCapabilityList(capabilities.supportedCameraSources)}`,
    `Supported face detectors: ${formatCapabilityList(capabilities.supportedFaceDetectors)}`,
    'Camera opened: no',
    'MotionFrames emitted: no',
    'Local only: yes',
    `Result state: ${getCapabilitiesResultState(capabilities)}`
  ]

  if (checkedAt !== null) {
    lines.push(`Last checked: ${checkedAt.toISOString()}`)
  }

  if (capabilities.error !== undefined) {
    lines.push(`Sanitized error message: ${sanitizeCapabilityErrorMessage(capabilities.error)}`)
  }

  return lines.join('\n')
}

type OpenCvSelectionState =
  | 'not-selected'
  | 'unchecked'
  | 'unavailable'
  | 'unsupported'
  | 'supported'

const getOpenCvSelectionState = (
  isOpenCvSelected: boolean,
  capabilitiesChecked: boolean,
  hasSuccessfulNativeCapabilities: boolean,
  supportFlag: boolean | null
): OpenCvSelectionState => {
  if (!isOpenCvSelected) {
    return 'not-selected'
  }
  if (!capabilitiesChecked) {
    return 'unchecked'
  }
  if (!hasSuccessfulNativeCapabilities) {
    return 'unavailable'
  }
  return supportFlag === false ? 'unsupported' : 'supported'
}

const openCvSelectionStateLabels: Record<OpenCvSelectionState, string> = {
  'not-selected': 'no OpenCV preflight required',
  unchecked: 'unchecked — run Check capabilities',
  unavailable: 'unavailable — latest capabilities preflight did not succeed',
  unsupported: 'unsupported by the latest capabilities preflight',
  supported: 'supported by the latest capabilities preflight'
}

type ReadinessTone = 'ready' | 'caution'

interface NativeRuntimeReadinessSummary {
  tone: ReadinessTone
  headline: string
  points: string[]
}

const buildNativeRuntimeReadinessSummary = ({
  status,
  canStart,
  selectedCameraSource,
  selectedFaceDetector,
  cameraSourceOpenCvState,
  faceDetectorOpenCvState,
  capabilitiesChecked
}: {
  status: RuntimeStatus
  canStart: boolean
  selectedCameraSource: NativePipelineCameraSource
  selectedFaceDetector: NativePipelineFaceDetector
  cameraSourceOpenCvState: OpenCvSelectionState
  faceDetectorOpenCvState: OpenCvSelectionState
  capabilitiesChecked: boolean
}): NativeRuntimeReadinessSummary => {
  const hasOpenCvConcern = [cameraSourceOpenCvState, faceDetectorOpenCvState].some(
    (state) => state === 'unchecked' || state === 'unavailable' || state === 'unsupported'
  )

  const tone: ReadinessTone = canStart && !hasOpenCvConcern ? 'ready' : 'caution'
  const headline = !canStart
    ? 'Not ready to attempt a local native pipeline start yet.'
    : hasOpenCvConcern
      ? 'Ready to attempt a local native pipeline start, with OpenCV selections to review.'
      : 'Ready to attempt a local native pipeline start.'

  return {
    tone,
    headline,
    points: [
      `Native tracker: ${statusLabels[status.nativeTrackerStatus]}`,
      `Motion bridge: ${bridgeLabels[status.motionBridgeStatus]}`,
      `Camera source: ${cameraSourceLabels[selectedCameraSource]} (${openCvSelectionStateLabels[cameraSourceOpenCvState]})`,
      `Face detector: ${faceDetectorLabels[selectedFaceDetector]} (${openCvSelectionStateLabels[faceDetectorOpenCvState]})`,
      `Native capabilities checked: ${capabilitiesChecked ? 'yes' : 'no'}`,
      'Capabilities preflight is advisory only; it does not block starting the native pipeline.'
    ]
  }
}

const getStatusTone = (status: NativeTrackerStatus | MotionBridgeStatus): StatusTone => {
  if (status === 'running') {
    return 'success'
  }

  if (status === 'starting' || status === 'stopping') {
    return 'warning'
  }

  if (status === 'error') {
    return 'danger'
  }

  return 'neutral'
}

function StatusPill({
  label,
  tone = 'neutral'
}: {
  label: string
  tone?: StatusTone
}): React.JSX.Element {
  return <span className={`status-pill status-pill--${tone}`}>{label}</span>
}

function App(): React.JSX.Element {
  const desktopApi = window.lvk
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const [lastRuntimeStatusRefreshAt, setLastRuntimeStatusRefreshAt] = useState<Date | null>(null)
  const [selectedCameraSource, setSelectedCameraSource] = useState<NativePipelineCameraSource>(
    DEFAULT_RUNTIME_SETTINGS.cameraSource
  )
  const [selectedFaceDetector, setSelectedFaceDetector] = useState<NativePipelineFaceDetector>(
    DEFAULT_RUNTIME_SETTINGS.faceDetector
  )
  const [selectedCameraIndex, setSelectedCameraIndex] = useState<number>(
    DEFAULT_RUNTIME_SETTINGS.cameraIndex
  )
  const [selectedCameraFps, setSelectedCameraFps] = useState<number>(
    DEFAULT_RUNTIME_SETTINGS.cameraFps
  )
  const [selectedCameraWidth, setSelectedCameraWidth] = useState<number>(
    DEFAULT_RUNTIME_SETTINGS.cameraWidth
  )
  const [selectedCameraHeight, setSelectedCameraHeight] = useState<number>(
    DEFAULT_RUNTIME_SETTINGS.cameraHeight
  )
  const [selectedTrackingBackend, setSelectedTrackingBackend] =
    useState<NativePipelineTrackingBackend>(DEFAULT_RUNTIME_SETTINGS.trackingBackend)
  const isMediaPipeCameraIncompatible =
    selectedTrackingBackend === 'mediapipe-face-landmarker' && selectedCameraSource !== 'opencv'
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<SettingsErrorMessage | null>(null)
  const [settingsSaveFeedback, setSettingsSaveFeedback] = useState<SettingsSaveFeedback | null>(
    null
  )
  const [stopFeedback, setStopFeedback] = useState<StopFeedback | null>(null)
  const [startFeedback, setStartFeedback] = useState<StartFeedback | null>(null)
  const [previewOpenFeedback, setPreviewOpenFeedback] = useState<PreviewOpenFeedback | null>(null)
  const [obsActionPending, setObsActionPending] = useState<ObsPreviewActionPending>(null)
  const [obsActionFeedback, setObsActionFeedback] = useState<ObsPreviewActionFeedback | null>(null)
  const [pipelineActionPending, setPipelineActionPending] = useState<PipelineActionPending>(null)
  const [isPreviewOpenPending, setIsPreviewOpenPending] = useState(false)
  const [isRuntimeStatusRefreshPending, setIsRuntimeStatusRefreshPending] = useState(false)
  const [runtimeStatusRefreshMessage, setRuntimeStatusRefreshMessage] =
    useState<RuntimeStatusRefreshMessage | null>(null)
  const [copyDiagnosticsMessage, setCopyDiagnosticsMessage] =
    useState<CopyDiagnosticsMessage | null>(null)
  const [copyCapabilitiesMessage, setCopyCapabilitiesMessage] =
    useState<CopyCapabilitiesMessage | null>(null)
  const [endpointCopyFeedback, setEndpointCopyFeedback] = useState<string | null>(null)
  const [nativeCapabilities, setNativeCapabilities] = useState<NativeRuntimeCapabilities | null>(
    null
  )
  const [lastNativeCapabilitiesCheckedAt, setLastNativeCapabilitiesCheckedAt] =
    useState<Date | null>(null)
  const [isCapabilitiesLoading, setIsCapabilitiesLoading] = useState(false)

  const isMountedRef = useRef(false)
  const isRuntimeStatusRequestInFlightRef = useRef(false)

  const loadRuntimeStatus = useCallback(async (): Promise<RuntimeStatus | null> => {
    if (!desktopApi) {
      return null
    }

    if (isRuntimeStatusRequestInFlightRef.current) {
      return null
    }

    isRuntimeStatusRequestInFlightRef.current = true
    if (isMountedRef.current) {
      setIsRuntimeStatusRefreshPending(true)
    }

    try {
      const status = await desktopApi.getRuntimeStatus()

      if (isMountedRef.current) {
        setRuntimeStatus(status)
        setLastRuntimeStatusRefreshAt(new Date())
        setLoadError(null)
      }
      return status
    } catch (error) {
      if (isMountedRef.current) {
        setLoadError(error instanceof Error ? error.message : 'Failed to load runtime status.')
      }
      return null
    } finally {
      isRuntimeStatusRequestInFlightRef.current = false
      if (isMountedRef.current) {
        setIsRuntimeStatusRefreshPending(false)
      }
    }
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) {
      return
    }

    let isSettingsLoadActive = true

    const loadRuntimeSettings = async (): Promise<void> => {
      try {
        const settings = normalizeRuntimeSettings(await desktopApi.getRuntimeSettings())

        if (!isSettingsLoadActive) {
          return
        }

        setSelectedCameraSource(settings.cameraSource)
        setSelectedFaceDetector(settings.faceDetector)
        setSelectedCameraIndex(settings.cameraIndex)
        setSelectedCameraFps(settings.cameraFps)
        setSelectedCameraWidth(settings.cameraWidth)
        setSelectedCameraHeight(settings.cameraHeight)
        setSelectedTrackingBackend(settings.trackingBackend)
        setSettingsError(null)
        setSettingsSaveFeedback(null)
      } catch (error) {
        if (isSettingsLoadActive) {
          setSettingsError({
            detail: error instanceof Error ? error.message : 'Failed to load runtime settings.',
            summary: 'Failed to load runtime settings.'
          })
        }
      }
    }

    void loadRuntimeSettings()

    return () => {
      isSettingsLoadActive = false
    }
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) {
      return
    }

    isMountedRef.current = true
    const initialStatusLoadTimeoutId = window.setTimeout(() => {
      void loadRuntimeStatus()
    }, 0)

    const statusPollIntervalId = window.setInterval(() => {
      void loadRuntimeStatus()
    }, RUNTIME_STATUS_POLL_INTERVAL_MS)

    return () => {
      isMountedRef.current = false
      window.clearTimeout(initialStatusLoadTimeoutId)
      window.clearInterval(statusPollIntervalId)
    }
  }, [desktopApi, loadRuntimeStatus])

  const motionEndpoint = runtimeStatus?.motionEndpoint ?? null

  useEffect(() => {
    const clearEndpointCopyFeedbackTimeoutId = window.setTimeout(() => {
      setEndpointCopyFeedback(null)
    }, 0)
    return () => {
      window.clearTimeout(clearEndpointCopyFeedbackTimeoutId)
    }
  }, [motionEndpoint])

  useEffect(() => {
    if (endpointCopyFeedback === null) {
      return undefined
    }
    const timer = window.setTimeout(() => {
      setEndpointCopyFeedback(null)
    }, 2000)
    return () => {
      window.clearTimeout(timer)
    }
  }, [endpointCopyFeedback])

  const refreshRuntimeStatus = async (): Promise<void> => {
    if (isRuntimeStatusRefreshPending) {
      return
    }

    setRuntimeStatusRefreshMessage(null)
    setCopyDiagnosticsMessage(null)
    setEndpointCopyFeedback(null)
    setIsRuntimeStatusRefreshPending(true)

    try {
      const refreshedRuntimeStatus = await loadRuntimeStatus()
      const didRefreshRuntimeStatus = refreshedRuntimeStatus !== null
      const refreshedRuntimeDiagnostics = refreshedRuntimeStatus
        ? buildNativeRuntimeDiagnostics(refreshedRuntimeStatus, pipelineError)
        : nativeRuntimeDiagnostics

      setRuntimeStatusRefreshMessage({
        diagnostics: refreshedRuntimeDiagnostics,
        message: didRefreshRuntimeStatus ? 'Status refreshed.' : 'Failed to refresh status.',
        tone: didRefreshRuntimeStatus ? 'success' : 'danger'
      })
    } finally {
      setIsRuntimeStatusRefreshPending(false)
    }
  }

  const openPreviewUrl = async (url: string): Promise<void> => {
    if (!desktopApi || isPreviewOpenPending) {
      return
    }

    setOpenError(null)
    setPreviewOpenFeedback(null)
    setIsPreviewOpenPending(true)

    try {
      await desktopApi.openExternalUrl(url)
      setPreviewOpenFeedback({
        message: 'Native preview opened.',
        nativeTrackerStatus: runtimeStatus?.nativeTrackerStatus ?? 'not_started'
      })
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : 'Failed to open preview URL.')
    } finally {
      setIsPreviewOpenPending(false)
    }
  }

  const copyObsPreviewUrl = async (source: ObsPreviewSource, url: string): Promise<void> => {
    if (obsActionPending) {
      return
    }

    setObsActionFeedback(null)
    setObsActionPending({ source, action: 'copy', url })

    const nativeStatusContext =
      source === 'native'
        ? {
            nativeTrackerStatus: runtimeStatus?.nativeTrackerStatus,
            motionBridgeStatus: runtimeStatus?.motionBridgeStatus
          }
        : {}

    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard unavailable')
      }

      await navigator.clipboard.writeText(url)
      setObsActionFeedback({
        source,
        action: 'copy',
        url,
        message: source === 'dummy' ? 'OBS dummy URL copied.' : 'OBS native URL copied.',
        tone: 'success',
        ...nativeStatusContext
      })
    } catch {
      setObsActionFeedback({
        source,
        action: 'copy',
        url,
        message:
          source === 'dummy' ? 'Failed to copy OBS dummy URL.' : 'Failed to copy OBS native URL.',
        tone: 'danger',
        ...nativeStatusContext
      })
    } finally {
      setObsActionPending(null)
    }
  }

  const openObsPreviewUrl = async (source: ObsPreviewSource, url: string): Promise<void> => {
    if (!desktopApi || obsActionPending) {
      return
    }

    setObsActionFeedback(null)
    setObsActionPending({ source, action: 'open', url })

    const nativeStatusContext =
      source === 'native'
        ? {
            nativeTrackerStatus: runtimeStatus?.nativeTrackerStatus,
            motionBridgeStatus: runtimeStatus?.motionBridgeStatus
          }
        : {}

    try {
      await desktopApi.openExternalUrl(url)
      setObsActionFeedback({
        source,
        action: 'open',
        url,
        message: source === 'dummy' ? 'OBS dummy preview opened.' : 'OBS native preview opened.',
        tone: 'success',
        ...nativeStatusContext
      })
    } catch {
      setObsActionFeedback({
        source,
        action: 'open',
        url,
        message:
          source === 'dummy'
            ? 'Failed to open OBS dummy preview.'
            : 'Failed to open OBS native preview.',
        tone: 'danger',
        ...nativeStatusContext
      })
    } finally {
      setObsActionPending(null)
    }
  }

  const startNativePipeline = async (): Promise<void> => {
    if (!desktopApi || pipelineActionPending || isMediaPipeCameraIncompatible) {
      return
    }

    setStopFeedback(null)
    setPreviewOpenFeedback(null)
    setOpenError(null)
    setPipelineError(null)
    setPipelineActionPending('start')

    try {
      const startedStatus = await desktopApi.startNativePipeline({
        cameraSource: selectedCameraSource,
        faceDetector: selectedFaceDetector,
        cameraIndex: coerceCameraIndex(selectedCameraIndex),
        cameraFps: coerceCameraFps(selectedCameraFps),
        cameraWidth: coerceCameraWidth(selectedCameraWidth),
        cameraHeight: coerceCameraHeight(selectedCameraHeight),
        trackingBackend: selectedTrackingBackend
      })
      setRuntimeStatus(startedStatus)
      setStartFeedback({
        message: 'Native runtime started.',
        nativeTrackerStatus: startedStatus.nativeTrackerStatus
      })
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : 'Failed to start native pipeline.')
    } finally {
      setPipelineActionPending(null)
    }
  }

  const startNativePipelineAndOpenPreview = async (): Promise<void> => {
    if (!desktopApi || pipelineActionPending || isMediaPipeCameraIncompatible) {
      return
    }

    setStopFeedback(null)
    setOpenError(null)
    setPreviewOpenFeedback(null)
    setPipelineError(null)
    setPipelineActionPending('start-and-open')

    try {
      const status = await desktopApi.startNativePipeline({
        cameraSource: selectedCameraSource,
        faceDetector: selectedFaceDetector,
        cameraIndex: coerceCameraIndex(selectedCameraIndex),
        cameraFps: coerceCameraFps(selectedCameraFps),
        cameraWidth: coerceCameraWidth(selectedCameraWidth),
        cameraHeight: coerceCameraHeight(selectedCameraHeight),
        trackingBackend: selectedTrackingBackend
      })
      setRuntimeStatus(status)
      setStartFeedback({
        message: 'Native runtime started.',
        nativeTrackerStatus: status.nativeTrackerStatus
      })

      if (!isNativePipelineRunning(status)) {
        return
      }

      await desktopApi.openExternalUrl(status.previewNativeUrl)
      setPreviewOpenFeedback({
        message: 'Native preview opened.',
        nativeTrackerStatus: status.nativeTrackerStatus
      })
    } catch (error) {
      setPipelineError(
        error instanceof Error ? error.message : 'Failed to start native pipeline and open preview.'
      )
    } finally {
      setPipelineActionPending(null)
    }
  }

  const saveRuntimeSettings = async (settings: DesktopRuntimeSettings): Promise<void> => {
    if (!desktopApi) {
      return
    }

    setSettingsSaveFeedback(null)

    try {
      const savedSettings = normalizeRuntimeSettings(await desktopApi.saveRuntimeSettings(settings))

      setSelectedCameraSource(savedSettings.cameraSource)
      setSelectedFaceDetector(savedSettings.faceDetector)
      setSelectedCameraIndex(savedSettings.cameraIndex)
      setSelectedCameraFps(savedSettings.cameraFps)
      setSelectedCameraWidth(savedSettings.cameraWidth)
      setSelectedCameraHeight(savedSettings.cameraHeight)
      setSelectedTrackingBackend(savedSettings.trackingBackend)
      setSettingsError(null)
      setSettingsSaveFeedback({
        message: 'Settings saved.',
        settingsKey: getRuntimeSettingsKey(savedSettings)
      })
    } catch (error) {
      setSettingsSaveFeedback(null)
      setSettingsError({
        detail: error instanceof Error ? error.message : 'Failed to save runtime settings.',
        summary: 'Failed to save runtime settings.'
      })
    }
  }

  const getSelectedRuntimeSettings = (): DesktopRuntimeSettings => ({
    cameraSource: selectedCameraSource,
    faceDetector: selectedFaceDetector,
    cameraIndex: coerceCameraIndex(selectedCameraIndex),
    cameraFps: coerceCameraFps(selectedCameraFps),
    cameraWidth: coerceCameraWidth(selectedCameraWidth),
    cameraHeight: coerceCameraHeight(selectedCameraHeight),
    trackingBackend: selectedTrackingBackend
  })

  const updateSelectedCameraSource = (cameraSource: NativePipelineCameraSource): void => {
    setSelectedCameraSource(cameraSource)
    void saveRuntimeSettings({ ...getSelectedRuntimeSettings(), cameraSource })
  }

  const updateSelectedFaceDetector = (faceDetector: NativePipelineFaceDetector): void => {
    setSelectedFaceDetector(faceDetector)
    void saveRuntimeSettings({ ...getSelectedRuntimeSettings(), faceDetector })
  }

  const updateSelectedTrackingBackend = (trackingBackend: NativePipelineTrackingBackend): void => {
    setSelectedTrackingBackend(trackingBackend)
    void saveRuntimeSettings({ ...getSelectedRuntimeSettings(), trackingBackend })
  }

  const updateSelectedCameraIndex = (cameraIndexValue: string): void => {
    const cameraIndex = coerceCameraIndex(cameraIndexValue)
    setSelectedCameraIndex(cameraIndex)
    void saveRuntimeSettings({ ...getSelectedRuntimeSettings(), cameraIndex })
  }

  const updateSelectedCameraFps = (cameraFpsValue: string): void => {
    const cameraFps = coerceCameraFps(cameraFpsValue)
    setSelectedCameraFps(cameraFps)
    void saveRuntimeSettings({ ...getSelectedRuntimeSettings(), cameraFps })
  }

  const updateSelectedCameraWidth = (cameraWidthValue: string): void => {
    const cameraWidth = coerceCameraWidth(cameraWidthValue)
    setSelectedCameraWidth(cameraWidth)
    void saveRuntimeSettings({ ...getSelectedRuntimeSettings(), cameraWidth })
  }

  const updateSelectedCameraHeight = (cameraHeightValue: string): void => {
    const cameraHeight = coerceCameraHeight(cameraHeightValue)
    setSelectedCameraHeight(cameraHeight)
    void saveRuntimeSettings({ ...getSelectedRuntimeSettings(), cameraHeight })
  }

  const fetchNativeCapabilities = useCallback(async (): Promise<void> => {
    if (!desktopApi || isCapabilitiesLoading) return
    setIsCapabilitiesLoading(true)
    try {
      const result = await desktopApi.getNativeRuntimeCapabilities()
      setNativeCapabilities(result)
      setLastNativeCapabilitiesCheckedAt(new Date())
      setCopyCapabilitiesMessage(null)
    } finally {
      setIsCapabilitiesLoading(false)
    }
  }, [desktopApi, isCapabilitiesLoading])

  const copyNativeRuntimeDiagnostics = async (): Promise<void> => {
    if (isRuntimeStatusRefreshPending) {
      return
    }

    if (!nativeRuntimeDiagnostics || !navigator.clipboard) {
      setCopyDiagnosticsMessage({
        diagnostics: nativeRuntimeDiagnostics,
        message: 'Failed to copy diagnostics.'
      })
      return
    }

    try {
      await navigator.clipboard.writeText(nativeRuntimeDiagnostics)
      setCopyDiagnosticsMessage({
        diagnostics: nativeRuntimeDiagnostics,
        message: 'Copied diagnostics.'
      })
    } catch {
      setCopyDiagnosticsMessage({
        diagnostics: nativeRuntimeDiagnostics,
        message: 'Failed to copy diagnostics.'
      })
    }
  }

  const copyNativeCapabilities = async (): Promise<void> => {
    if (!nativeCapabilities || !navigator.clipboard) {
      setCopyCapabilitiesMessage({
        message: 'Failed to copy capabilities.',
        summary: ''
      })
      return
    }

    const summary = buildNativeCapabilitiesCopySummary(
      nativeCapabilities,
      lastNativeCapabilitiesCheckedAt
    )

    try {
      await navigator.clipboard.writeText(summary)
      setCopyCapabilitiesMessage({
        message: 'Copied capabilities.',
        summary
      })
    } catch {
      setCopyCapabilitiesMessage({
        message: 'Failed to copy capabilities.',
        summary
      })
    }
  }

  const copyMotionEndpoint = async (): Promise<void> => {
    if (!runtimeStatus?.motionEndpoint || !navigator.clipboard) {
      setEndpointCopyFeedback('Copy failed.')
      return
    }
    try {
      await navigator.clipboard.writeText(runtimeStatus.motionEndpoint)
      setEndpointCopyFeedback('Endpoint copied.')
    } catch {
      setEndpointCopyFeedback('Copy failed.')
    }
  }

  const stopNativePipeline = async (): Promise<void> => {
    if (!desktopApi || pipelineActionPending) {
      return
    }

    setStartFeedback(null)
    setPreviewOpenFeedback(null)
    setOpenError(null)
    setStopFeedback(null)
    setPipelineError(null)
    setPipelineActionPending('stop')

    try {
      const stoppedStatus = await desktopApi.stopNativePipeline()
      setRuntimeStatus(stoppedStatus)
      setStopFeedback({
        message: 'Native runtime stopped.',
        nativeTrackerStatus: stoppedStatus.nativeTrackerStatus
      })
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : 'Failed to stop native pipeline.')
    } finally {
      setPipelineActionPending(null)
    }
  }

  const isPipelineBusy = runtimeStatus
    ? ['starting', 'running', 'stopping'].includes(runtimeStatus.nativeTrackerStatus) ||
      ['starting', 'running', 'stopping'].includes(runtimeStatus.motionBridgeStatus)
    : false
  const isPipelineActionPending = pipelineActionPending !== null
  const isObsActionPending = obsActionPending !== null
  const canStartNativePipeline = Boolean(
    desktopApi &&
    runtimeStatus &&
    !isPipelineBusy &&
    !isPipelineActionPending &&
    !isMediaPipeCameraIncompatible
  )
  const canStopNativePipeline = runtimeStatus
    ? !isPipelineActionPending &&
      (['starting', 'running'].includes(runtimeStatus.nativeTrackerStatus) ||
        ['starting', 'running'].includes(runtimeStatus.motionBridgeStatus))
    : false
  const activeCameraSource = runtimeStatus?.pipelineCameraSource ?? 'dummy'
  const activeFaceDetector = runtimeStatus?.pipelineFaceDetector ?? 'noop'
  const activeCameraIndex = runtimeStatus?.pipelineCameraIndex ?? MIN_CAMERA_INDEX
  const activeCameraFps = runtimeStatus?.pipelineCameraFps ?? DEFAULT_CAMERA_FPS
  const activeCameraWidth = runtimeStatus?.pipelineCameraWidth ?? DEFAULT_CAMERA_WIDTH
  const activeCameraHeight = runtimeStatus?.pipelineCameraHeight ?? DEFAULT_CAMERA_HEIGHT
  const nativeRuntimeDiagnostics = runtimeStatus
    ? buildNativeRuntimeDiagnostics(runtimeStatus, pipelineError)
    : ''
  const lastRuntimeStatusRefreshLabel = lastRuntimeStatusRefreshAt
    ? lastRuntimeStatusRefreshAt.toLocaleTimeString()
    : null
  const currentRuntimeStatusRefreshMessage =
    runtimeStatusRefreshMessage?.diagnostics === nativeRuntimeDiagnostics
      ? runtimeStatusRefreshMessage
      : null
  const currentCopyDiagnosticsMessage =
    copyDiagnosticsMessage?.diagnostics === nativeRuntimeDiagnostics
      ? copyDiagnosticsMessage.message
      : null
  const currentRuntimeSettingsKey = getRuntimeSettingsKey(getSelectedRuntimeSettings())
  const currentSettingsSaveFeedback =
    settingsSaveFeedback?.settingsKey === currentRuntimeSettingsKey
      ? settingsSaveFeedback.message
      : null
  const currentStopFeedback =
    stopFeedback !== null && stopFeedback.nativeTrackerStatus === runtimeStatus?.nativeTrackerStatus
      ? stopFeedback.message
      : null
  const currentStartFeedback =
    startFeedback !== null &&
    startFeedback.nativeTrackerStatus === runtimeStatus?.nativeTrackerStatus
      ? startFeedback.message
      : null
  const currentPreviewOpenFeedback =
    previewOpenFeedback !== null &&
    previewOpenFeedback.nativeTrackerStatus === runtimeStatus?.nativeTrackerStatus
      ? previewOpenFeedback.message
      : null
  const nativeCapabilitiesCopySummary = nativeCapabilities
    ? buildNativeCapabilitiesCopySummary(nativeCapabilities, lastNativeCapabilitiesCheckedAt)
    : ''
  const nativeCapabilitiesCheckedAtLabel =
    nativeCapabilities && lastNativeCapabilitiesCheckedAt
      ? formatNativeCapabilitiesCheckedAtLabel(lastNativeCapabilitiesCheckedAt)
      : null
  const currentCopyCapabilitiesMessage =
    copyCapabilitiesMessage?.summary === nativeCapabilitiesCopySummary
      ? copyCapabilitiesMessage.message
      : null
  const hasSuccessfulNativeCapabilities = Boolean(
    nativeCapabilities &&
    nativeCapabilities.skipped !== true &&
    nativeCapabilities.error === undefined
  )
  const opencvCapabilityAdvisories = [
    selectedCameraSource === 'opencv' && !hasSuccessfulNativeCapabilities
      ? 'Run Check capabilities before starting an OpenCV pipeline.'
      : null,
    selectedFaceDetector === 'opencv' && !hasSuccessfulNativeCapabilities
      ? 'Run Check capabilities before starting an OpenCV pipeline.'
      : null,
    selectedCameraSource === 'opencv' &&
    hasSuccessfulNativeCapabilities &&
    nativeCapabilities?.opencvCameraSupport === false
      ? 'OpenCV camera support appears disabled or unavailable based on the latest Native runtime capabilities preflight.'
      : null,
    selectedFaceDetector === 'opencv' &&
    hasSuccessfulNativeCapabilities &&
    nativeCapabilities?.opencvFaceDetectorSupport === false
      ? 'OpenCV face detection support appears disabled or unavailable based on the latest Native runtime capabilities preflight.'
      : null,
    selectedFaceDetector === 'opencv' && runtimeStatus?.faceCascadePathConfigured === false
      ? 'OpenCV face detection requires LVK_FACE_CASCADE_PATH to be set to a Haar cascade XML path before starting Electron.'
      : null
  ].filter(
    (message, index, messages): message is string =>
      Boolean(message) && messages.indexOf(message) === index
  )
  const capabilitiesChecked = nativeCapabilities !== null
  const cameraSourceOpenCvState = getOpenCvSelectionState(
    selectedCameraSource === 'opencv',
    capabilitiesChecked,
    hasSuccessfulNativeCapabilities,
    nativeCapabilities?.opencvCameraSupport ?? null
  )
  const faceDetectorOpenCvState = getOpenCvSelectionState(
    selectedFaceDetector === 'opencv',
    capabilitiesChecked,
    hasSuccessfulNativeCapabilities,
    nativeCapabilities?.opencvFaceDetectorSupport ?? null
  )
  const nativeRuntimeReadinessSummary = runtimeStatus
    ? buildNativeRuntimeReadinessSummary({
        status: runtimeStatus,
        canStart: canStartNativePipeline,
        selectedCameraSource,
        selectedFaceDetector,
        cameraSourceOpenCvState,
        faceDetectorOpenCvState,
        capabilitiesChecked
      })
    : null

  return (
    <main className="desktop-shell">
      <section className="hero-panel" aria-labelledby="app-title">
        <p className="eyebrow">LVK Desktop Preview</p>
        <h1 id="app-title">Local Virtual Kit</h1>
        <p className="hero-description">Local-first VTuber / virtual avatar starter kit.</p>
      </section>

      {loadError ? <p className="error-message">{loadError}</p> : null}
      {settingsError ? (
        <p
          className="error-message settings-error-message"
          role="alert"
          aria-labelledby="runtime-settings-error-label"
        >
          <strong id="runtime-settings-error-label" className="status-detail-label">
            Settings error
          </strong>
          <span>{settingsError.summary}</span>
          {settingsError.detail === settingsError.summary ? null : (
            <span className="settings-error-detail">{settingsError.detail}</span>
          )}
        </p>
      ) : null}

      {!desktopApi ? (
        <section className="card fallback-card" aria-labelledby="desktop-api-unavailable-heading">
          <div className="card-header">
            <div>
              <p className="section-label">Desktop API</p>
              <h2 id="desktop-api-unavailable-heading">Electron required</h2>
            </div>
            <StatusPill label="Unavailable" tone="warning" />
          </div>
          <p className="runtime-message">
            LVK desktop API is not available. Open this page from the Electron app. For Web Preview,
            run pnpm dev:web and open http://localhost:5173/?source=dummy.
          </p>
        </section>
      ) : runtimeStatus ? (
        <div className="shell-grid">
          <section className="card" aria-labelledby="preview-heading">
            <div className="card-header">
              <div>
                <p className="section-label">Web Preview</p>
                <h2 id="preview-heading">Preview URLs</h2>
              </div>
              <StatusPill label="Manual launch" />
            </div>

            <div className="url-list">
              <div className="url-row">
                <div>
                  <span className="url-label">Dummy source</span>
                  <code>{runtimeStatus.previewDummyUrl}</code>
                </div>
                <button
                  type="button"
                  onClick={() => openPreviewUrl(runtimeStatus.previewDummyUrl)}
                  disabled={isPreviewOpenPending}
                >
                  Open
                </button>
              </div>

              <div className="url-row">
                <div>
                  <span className="url-label">Native source</span>
                  <code>{runtimeStatus.previewNativeUrl}</code>
                </div>
                <button
                  type="button"
                  onClick={() => openPreviewUrl(runtimeStatus.previewNativeUrl)}
                  disabled={isPreviewOpenPending}
                >
                  Open
                </button>
              </div>
            </div>

            {isPreviewOpenPending ? (
              <p className="runtime-message compact" role="status">
                Opening native preview...
              </p>
            ) : null}
            {openError ? (
              <p
                className="error-message compact"
                role="alert"
                aria-labelledby="preview-open-error-label"
              >
                <strong id="preview-open-error-label" className="status-detail-label">
                  Preview open error
                </strong>
                {openError}
              </p>
            ) : null}
            {currentPreviewOpenFeedback ? (
              <p className="runtime-message compact" role="status">
                {currentPreviewOpenFeedback}
              </p>
            ) : null}
          </section>

          <section
            className="card card--wide obs-setup-card"
            aria-labelledby="obs-browser-source-heading"
          >
            <div className="card-header">
              <div>
                <p className="section-label">OBS</p>
                <h2 id="obs-browser-source-heading">OBS Browser Source</h2>
              </div>
              <StatusPill label="Localhost only" />
            </div>

            <div className="obs-setup-intro">
              <p>
                Add LVK to OBS as a Browser Source. Recommended starting size:{' '}
                <strong>1920 × 1080</strong>. This is a suggested starting point, not a required
                resolution for every avatar, scene, or display.
              </p>
              <p>
                Both URLs are localhost-only. Camera frames remain local and are never uploaded to
                the cloud.
              </p>
            </div>

            <div className="obs-setup-grid">
              {(() => {
                const obsDummyUrl = runtimeStatus.previewObsDummyUrl
                const dummyPending = obsActionPending?.source === 'dummy' ? obsActionPending : null
                const dummyFeedback = resolveObsSourceFeedback(
                  obsActionFeedback,
                  'dummy',
                  obsDummyUrl,
                  runtimeStatus
                )

                return (
                  <div
                    className="obs-source-panel obs-source-panel--dummy"
                    aria-labelledby="obs-dummy-source-heading"
                    aria-busy={dummyPending !== null}
                  >
                    <div className="obs-source-panel__header">
                      <p id="obs-dummy-source-heading" className="section-label">
                        OBS dummy source
                      </p>
                      <code>{obsDummyUrl}</code>
                    </div>
                    <p className="obs-source-description">
                      Does not require Native Core, the webcam, or the MotionFrame bridge. Use it to
                      inspect the OBS-friendly renderer layout.
                    </p>
                    <div className="obs-source-actions">
                      <button
                        type="button"
                        aria-label="Copy OBS dummy Browser Source URL"
                        onClick={() => copyObsPreviewUrl('dummy', obsDummyUrl)}
                        disabled={isObsActionPending}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        aria-label="Open OBS dummy Browser Source preview"
                        onClick={() => openObsPreviewUrl('dummy', obsDummyUrl)}
                        disabled={isObsActionPending}
                      >
                        Open
                      </button>
                    </div>
                    {dummyPending ? (
                      <p className="obs-action-feedback" role="status">
                        {buildObsPendingMessage(dummyPending)}
                      </p>
                    ) : dummyFeedback ? (
                      <p
                        className={`obs-action-feedback obs-action-feedback--${dummyFeedback.tone}`}
                        role={dummyFeedback.tone === 'danger' ? 'alert' : 'status'}
                      >
                        {dummyFeedback.message}
                      </p>
                    ) : null}
                  </div>
                )
              })()}

              {(() => {
                const obsNativeUrl = runtimeStatus.previewObsNativeUrl
                const nativePending =
                  obsActionPending?.source === 'native' ? obsActionPending : null
                const nativeFeedback = resolveObsSourceFeedback(
                  obsActionFeedback,
                  'native',
                  obsNativeUrl,
                  runtimeStatus
                )

                return (
                  <div
                    className="obs-source-panel obs-source-panel--native"
                    aria-labelledby="obs-native-source-heading"
                    aria-busy={nativePending !== null}
                  >
                    <div className="obs-source-panel__header">
                      <p id="obs-native-source-heading" className="section-label">
                        OBS native source
                      </p>
                      <code>{obsNativeUrl}</code>
                    </div>
                    <p className="obs-source-description">
                      Requires the local native pipeline and the local MotionFrame bridge. Camera
                      frames remain local, and the URL itself remains localhost-only. Open does not
                      start the native pipeline.
                    </p>
                    <div className="obs-source-actions">
                      <button
                        type="button"
                        aria-label="Copy OBS native Browser Source URL"
                        onClick={() => copyObsPreviewUrl('native', obsNativeUrl)}
                        disabled={isObsActionPending}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        aria-label="Open OBS native Browser Source preview"
                        onClick={() => openObsPreviewUrl('native', obsNativeUrl)}
                        disabled={isObsActionPending}
                      >
                        Open
                      </button>
                    </div>
                    {nativePending ? (
                      <p className="obs-action-feedback" role="status">
                        {buildObsPendingMessage(nativePending)}
                      </p>
                    ) : nativeFeedback ? (
                      <p
                        className={`obs-action-feedback obs-action-feedback--${nativeFeedback.tone}`}
                        role={nativeFeedback.tone === 'danger' ? 'alert' : 'status'}
                      >
                        {nativeFeedback.message}
                      </p>
                    ) : null}
                  </div>
                )
              })()}
            </div>
          </section>

          <section
            id="native-runtime-status-section"
            className="card"
            aria-labelledby="runtime-heading"
            aria-busy={isRuntimeStatusRefreshPending}
          >
            <div className="card-header">
              <div>
                <p className="section-label">Runtime</p>
                <h2 id="runtime-heading">Source status</h2>
              </div>
              <StatusPill label="Auto-refreshing" />
            </div>

            {nativeRuntimeReadinessSummary ? (
              <div
                className={`readiness-summary readiness-summary--${nativeRuntimeReadinessSummary.tone}`}
                aria-label="Native runtime readiness summary"
              >
                <div className="readiness-summary__headline">
                  <StatusPill
                    label={
                      nativeRuntimeReadinessSummary.tone === 'ready' ? 'Ready' : 'Review needed'
                    }
                    tone={nativeRuntimeReadinessSummary.tone === 'ready' ? 'success' : 'warning'}
                  />
                  <p>{nativeRuntimeReadinessSummary.headline}</p>
                </div>
                <ul className="readiness-summary__points">
                  {nativeRuntimeReadinessSummary.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {runtimeStatus.startupWarning === 'no_frame_timeout' ? (
              <div
                className="runtime-message compact"
                role="status"
                aria-labelledby="no-frame-startup-warning-label"
              >
                <strong id="no-frame-startup-warning-label" className="status-detail-label">
                  No-frame startup warning
                </strong>
                <span>
                  No MotionFrame has been received yet since the native pipeline started. Check the
                  tracker/camera configuration, or rebuild the native tracker, then Refresh status.
                </span>
              </div>
            ) : null}

            <div className="runtime-status-summary" aria-label="Native runtime overview">
              <p className="runtime-status-summary__header">Native runtime overview</p>
              <ul className="runtime-status-summary__items">
                <li className="runtime-status-summary__item">
                  <span>Native tracker</span>
                  <StatusPill
                    label={statusLabels[runtimeStatus.nativeTrackerStatus]}
                    tone={getStatusTone(runtimeStatus.nativeTrackerStatus)}
                  />
                </li>
                <li className="runtime-status-summary__item">
                  <span>Motion bridge</span>
                  <StatusPill
                    label={bridgeLabels[runtimeStatus.motionBridgeStatus]}
                    tone={getStatusTone(runtimeStatus.motionBridgeStatus)}
                  />
                </li>
                <li className="runtime-status-summary__item">
                  <span>Camera source</span>
                  <StatusPill label={cameraSourceLabels[activeCameraSource]} />
                </li>
                {lastRuntimeStatusRefreshLabel ? (
                  <li className="runtime-status-summary__item">
                    <span>Last refreshed</span>
                    <time dateTime={lastRuntimeStatusRefreshAt?.toISOString()}>
                      {lastRuntimeStatusRefreshLabel}
                    </time>
                  </li>
                ) : null}
              </ul>
            </div>

            <dl className="status-list">
              <div>
                <dt>MotionFrame endpoint</dt>
                <dd className="endpoint-dd">
                  <code>{runtimeStatus.motionEndpoint}</code>
                  <button
                    type="button"
                    onClick={copyMotionEndpoint}
                    disabled={isRuntimeStatusRefreshPending}
                    aria-describedby="native-motion-endpoint-copy-feedback"
                  >
                    Copy endpoint
                  </button>
                  {endpointCopyFeedback ? (
                    <span
                      id="native-motion-endpoint-copy-feedback"
                      className="endpoint-copy-feedback"
                      role="status"
                      aria-live="polite"
                    >
                      {endpointCopyFeedback}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Camera source</dt>
                <dd>
                  <StatusPill label={cameraSourceLabels[activeCameraSource]} />
                </dd>
              </div>
              {activeCameraSource === 'opencv' ? (
                <div>
                  <dt>Camera index</dt>
                  <dd>{activeCameraIndex}</dd>
                </div>
              ) : null}
              <div>
                <dt>Camera FPS</dt>
                <dd>{activeCameraFps}</dd>
              </div>
              <div>
                <dt>Camera resolution</dt>
                <dd>{`${activeCameraWidth} × ${activeCameraHeight}`}</dd>
              </div>
              <div>
                <dt>Face detector</dt>
                <dd>
                  <StatusPill label={faceDetectorLabels[activeFaceDetector]} />
                </dd>
              </div>
              <div>
                <dt>Native tracker status</dt>
                <dd>
                  <StatusPill
                    label={statusLabels[runtimeStatus.nativeTrackerStatus]}
                    tone={getStatusTone(runtimeStatus.nativeTrackerStatus)}
                  />
                </dd>
              </div>
              <div>
                <dt>Motion bridge status</dt>
                <dd>
                  <StatusPill
                    label={bridgeLabels[runtimeStatus.motionBridgeStatus]}
                    tone={getStatusTone(runtimeStatus.motionBridgeStatus)}
                  />
                </dd>
              </div>
            </dl>

            <label className="field-row" htmlFor="camera-source">
              <span>Camera source</span>
              <select
                id="camera-source"
                value={selectedCameraSource}
                disabled={isPipelineBusy || isPipelineActionPending}
                onChange={(event) => {
                  const cameraSource = event.currentTarget.value

                  if (isNativePipelineCameraSource(cameraSource)) {
                    updateSelectedCameraSource(cameraSource)
                  }
                }}
              >
                <option value="dummy">Dummy source</option>
                <option value="opencv">OpenCV camera</option>
              </select>
            </label>

            <label className="field-row" htmlFor="camera-index">
              <span>Camera index</span>
              <input
                id="camera-index"
                type="number"
                min={MIN_CAMERA_INDEX}
                max={MAX_CAMERA_INDEX}
                step={1}
                value={selectedCameraIndex}
                disabled={
                  selectedCameraSource === 'dummy' || isPipelineBusy || isPipelineActionPending
                }
                onChange={(event) => updateSelectedCameraIndex(event.currentTarget.value)}
                onBlur={(event) => updateSelectedCameraIndex(event.currentTarget.value)}
              />
            </label>

            <label className="field-row" htmlFor="camera-fps">
              <span>Camera FPS</span>
              <input
                id="camera-fps"
                type="number"
                min={MIN_CAMERA_FPS}
                max={MAX_CAMERA_FPS}
                value={selectedCameraFps}
                disabled={isPipelineBusy || isPipelineActionPending}
                onChange={(event) => updateSelectedCameraFps(event.currentTarget.value)}
                onBlur={(event) => updateSelectedCameraFps(event.currentTarget.value)}
              />
            </label>

            <label className="field-row" htmlFor="camera-width">
              <span>Camera width</span>
              <input
                id="camera-width"
                type="number"
                min={MIN_CAMERA_WIDTH}
                max={MAX_CAMERA_WIDTH}
                step={1}
                value={selectedCameraWidth}
                disabled={isPipelineBusy || isPipelineActionPending}
                onChange={(event) => updateSelectedCameraWidth(event.currentTarget.value)}
                onBlur={(event) => updateSelectedCameraWidth(event.currentTarget.value)}
              />
            </label>

            <label className="field-row" htmlFor="camera-height">
              <span>Camera height</span>
              <input
                id="camera-height"
                type="number"
                min={MIN_CAMERA_HEIGHT}
                max={MAX_CAMERA_HEIGHT}
                step={1}
                value={selectedCameraHeight}
                disabled={isPipelineBusy || isPipelineActionPending}
                onChange={(event) => updateSelectedCameraHeight(event.currentTarget.value)}
                onBlur={(event) => updateSelectedCameraHeight(event.currentTarget.value)}
              />
            </label>

            <label className="field-row" htmlFor="face-detector">
              <span>Face detector</span>
              <select
                id="face-detector"
                value={selectedFaceDetector}
                disabled={isPipelineBusy || isPipelineActionPending}
                onChange={(event) => {
                  const faceDetector = event.currentTarget.value

                  if (isNativePipelineFaceDetector(faceDetector)) {
                    updateSelectedFaceDetector(faceDetector)
                  }
                }}
              >
                <option value="noop">Noop face detector</option>
                <option value="opencv">OpenCV face detection</option>
              </select>
            </label>

            <label className="field-row" htmlFor="tracking-backend">
              <span>Tracking backend</span>
              <select
                id="tracking-backend"
                value={selectedTrackingBackend}
                disabled={isPipelineBusy || isPipelineActionPending}
                aria-describedby="tracking-backend-description"
                onChange={(event) => {
                  const trackingBackend = event.currentTarget.value

                  if (isNativePipelineTrackingBackend(trackingBackend)) {
                    updateSelectedTrackingBackend(trackingBackend)
                  }
                }}
              >
                <option value="face-pipeline">{trackingBackendLabels['face-pipeline']}</option>
                <option
                  value="mediapipe-face-landmarker"
                  disabled={selectedCameraSource !== 'opencv'}
                >
                  {trackingBackendLabels['mediapipe-face-landmarker']}
                </option>
              </select>
            </label>
            <p id="tracking-backend-description" className="note">
              MediaPipe Face Landmarker is a local development route and requires the OpenCV camera
              source. Python, model, and helper configuration remain owned by the Electron main
              process.
            </p>

            {isMediaPipeCameraIncompatible ? (
              <p
                className="runtime-message compact"
                role="alert"
                aria-labelledby="tracking-backend-compatibility-label"
              >
                <strong id="tracking-backend-compatibility-label" className="status-detail-label">
                  Tracking backend compatibility
                </strong>
                <span>
                  MediaPipe Face Landmarker requires the OpenCV camera source. Switch Camera source
                  to OpenCV camera, or choose Face pipeline, before starting.
                </span>
              </p>
            ) : null}

            {currentSettingsSaveFeedback ? (
              <p className="settings-save-feedback" role="status">
                {currentSettingsSaveFeedback}
              </p>
            ) : null}

            {opencvCapabilityAdvisories.length > 0 ? (
              <div className="runtime-message compact" role="status">
                <strong className="status-detail-label">OpenCV capability advisory</strong>
                <ul>
                  {opencvCapabilityAdvisories.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="button-row" aria-label="Development native pipeline controls">
              <button
                type="button"
                onClick={startNativePipeline}
                disabled={!canStartNativePipeline}
              >
                Start native pipeline
              </button>
              <button
                type="button"
                onClick={startNativePipelineAndOpenPreview}
                disabled={!canStartNativePipeline}
              >
                Start and open native preview
              </button>
              <button type="button" onClick={stopNativePipeline} disabled={!canStopNativePipeline}>
                Stop native pipeline
              </button>
            </div>

            {pipelineActionPending ? (
              <p className="runtime-message compact" role="status">
                {pipelineActionPendingMessages[pipelineActionPending]}
              </p>
            ) : null}

            {!pipelineActionPending && currentStopFeedback ? (
              <p className="runtime-message compact" role="status">
                {currentStopFeedback}
              </p>
            ) : null}

            {!pipelineActionPending && currentStartFeedback ? (
              <p className="runtime-message compact" role="status">
                {currentStartFeedback}
              </p>
            ) : null}

            {nativeRuntimeDiagnostics ? (
              <div className="diagnostics-copy-section">
                <div className="diagnostics-copy-row">
                  <button
                    type="button"
                    onClick={refreshRuntimeStatus}
                    disabled={isRuntimeStatusRefreshPending}
                    aria-controls="native-runtime-status-section"
                    aria-describedby="native-runtime-refresh-status-feedback"
                  >
                    Refresh status
                  </button>
                  {isRuntimeStatusRefreshPending ? (
                    <span
                      id="native-runtime-refresh-status-feedback"
                      className="status-refresh-feedback"
                      role="status"
                      aria-live="polite"
                    >
                      Refreshing status...
                    </span>
                  ) : currentRuntimeStatusRefreshMessage ? (
                    <span
                      id="native-runtime-refresh-status-feedback"
                      className={`status-refresh-feedback status-refresh-feedback--${currentRuntimeStatusRefreshMessage.tone}`}
                      role="status"
                      aria-live="polite"
                    >
                      {currentRuntimeStatusRefreshMessage.message}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={copyNativeRuntimeDiagnostics}
                    disabled={isRuntimeStatusRefreshPending}
                    aria-describedby="native-runtime-diagnostics-copy-feedback"
                  >
                    Copy diagnostics
                  </button>
                  {currentCopyDiagnosticsMessage ? (
                    <span
                      id="native-runtime-diagnostics-copy-feedback"
                      className="diagnostics-copy-feedback"
                      role="status"
                      aria-live="polite"
                    >
                      {currentCopyDiagnosticsMessage}
                    </span>
                  ) : null}
                </div>
                {lastRuntimeStatusRefreshLabel ? (
                  <p className="runtime-refresh-timestamp">
                    <strong className="status-detail-label">Last refreshed</strong>
                    <time dateTime={lastRuntimeStatusRefreshAt?.toISOString()}>
                      {lastRuntimeStatusRefreshLabel}
                    </time>
                  </p>
                ) : null}
                <div className="diagnostics-preview" aria-labelledby="diagnostics-preview-label">
                  <strong id="diagnostics-preview-label" className="status-detail-label">
                    Diagnostics preview
                  </strong>
                  <pre>{nativeRuntimeDiagnostics}</pre>
                </div>
              </div>
            ) : null}

            {runtimeStatus.lastMessage || runtimeStatus.lastError || pipelineError ? (
              <div className="runtime-details-panel">
                <p className="runtime-details-panel__header">Runtime details</p>
                <div className="runtime-details-panel__items">
                  {runtimeStatus.lastMessage ? (
                    <p
                      className="runtime-message"
                      role="status"
                      aria-labelledby="latest-status-label"
                    >
                      <strong id="latest-status-label" className="status-detail-label">
                        Latest status
                      </strong>
                      {runtimeStatus.lastMessage}
                    </p>
                  ) : null}
                  {runtimeStatus.lastError ? (
                    <p
                      className="error-message compact"
                      role="alert"
                      aria-labelledby="latest-error-label"
                    >
                      <strong id="latest-error-label" className="status-detail-label">
                        Latest error
                      </strong>
                      {runtimeStatus.lastError}
                    </p>
                  ) : null}
                  {pipelineError ? (
                    <p className="error-message compact" role="alert">
                      {pipelineError}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="card" aria-labelledby="native-capabilities-heading">
            <div className="card-header">
              <div>
                <p className="section-label">Preflight check</p>
                <h2 id="native-capabilities-heading">Native runtime capabilities</h2>
              </div>
            </div>

            <p className="note">
              Safe build-time preflight. Does not open a camera, start tracking, or validate webcam
              access, OS camera permission, or OBS Browser Source.
            </p>

            <div className="diagnostics-copy-row">
              <button
                type="button"
                onClick={fetchNativeCapabilities}
                disabled={!desktopApi || isCapabilitiesLoading}
              >
                {isCapabilitiesLoading ? 'Checking…' : 'Check capabilities'}
              </button>
              <button
                type="button"
                onClick={copyNativeCapabilities}
                disabled={!nativeCapabilities}
                aria-describedby="native-capabilities-copy-feedback"
              >
                Copy capabilities
              </button>
              {currentCopyCapabilitiesMessage ? (
                <span
                  id="native-capabilities-copy-feedback"
                  className="diagnostics-copy-feedback"
                  role="status"
                  aria-live="polite"
                >
                  {currentCopyCapabilitiesMessage}
                </span>
              ) : null}
            </div>

            {nativeCapabilities ? (
              nativeCapabilities.skipped === true || nativeCapabilities.error !== undefined ? (
                <>
                  {nativeCapabilitiesCheckedAtLabel ? (
                    <p className="runtime-refresh-timestamp">
                      <strong className="status-detail-label">Last checked</strong>
                      <time dateTime={lastNativeCapabilitiesCheckedAt?.toISOString()}>
                        {nativeCapabilitiesCheckedAtLabel}
                      </time>
                    </p>
                  ) : null}
                  <p className="error-message compact" role="alert">
                    {nativeCapabilities.error ?? 'Native tracker binary unavailable.'}
                  </p>
                </>
              ) : (
                <>
                  {nativeCapabilitiesCheckedAtLabel ? (
                    <p className="runtime-refresh-timestamp">
                      <strong className="status-detail-label">Last checked</strong>
                      <time dateTime={lastNativeCapabilitiesCheckedAt?.toISOString()}>
                        {nativeCapabilitiesCheckedAtLabel}
                      </time>
                    </p>
                  ) : null}
                  <dl className="status-list">
                    <div className="status-list__item">
                      <dt className="status-detail-label">OpenCV camera support</dt>
                      <dd>
                        {nativeCapabilities.opencvCameraSupport === true
                          ? 'Enabled'
                          : nativeCapabilities.opencvCameraSupport === false
                            ? 'Disabled'
                            : 'Unknown'}
                      </dd>
                    </div>
                    <div className="status-list__item">
                      <dt className="status-detail-label">OpenCV face detector support</dt>
                      <dd>
                        {nativeCapabilities.opencvFaceDetectorSupport === true
                          ? 'Enabled'
                          : nativeCapabilities.opencvFaceDetectorSupport === false
                            ? 'Disabled'
                            : 'Unknown'}
                      </dd>
                    </div>
                    <div className="status-list__item">
                      <dt className="status-detail-label">Supported camera sources</dt>
                      <dd>{nativeCapabilities.supportedCameraSources.join(', ') || '—'}</dd>
                    </div>
                    <div className="status-list__item">
                      <dt className="status-detail-label">Supported face detectors</dt>
                      <dd>{nativeCapabilities.supportedFaceDetectors.join(', ') || '—'}</dd>
                    </div>
                    <div className="status-list__item">
                      <dt className="status-detail-label">Camera opened</dt>
                      <dd>No</dd>
                    </div>
                    <div className="status-list__item">
                      <dt className="status-detail-label">MotionFrames emitted</dt>
                      <dd>No</dd>
                    </div>
                    <div className="status-list__item">
                      <dt className="status-detail-label">Local only</dt>
                      <dd>Yes</dd>
                    </div>
                  </dl>
                </>
              )
            ) : null}
          </section>

          <section className="card" aria-labelledby="settings-placeholder-heading">
            <div className="card-header">
              <div>
                <p className="section-label">Settings</p>
                <h2 id="settings-placeholder-heading">Desktop settings placeholder</h2>
              </div>
              <StatusPill label="Not implemented" tone="warning" />
            </div>

            <p className="note">
              Future controls for preview and runtime preferences will live here. Camera source and
              face detector selection are available in the Runtime controls. OpenCV face detection
              is optional and requires an explicit LVK_FACE_CASCADE_PATH configuration before
              Electron passes a cascade to the native tracker.
            </p>
          </section>

          <section className="card" aria-labelledby="calibration-placeholder-heading">
            <div className="card-header">
              <div>
                <p className="section-label">Calibration</p>
                <h2 id="calibration-placeholder-heading">Tracking calibration placeholder</h2>
              </div>
              <StatusPill label="Not implemented" tone="warning" />
            </div>

            <p className="note">
              Future neutral pose, deadzone, and smoothing controls will live here. This card is
              display-only and does not access cameras or native tracking.
            </p>
          </section>

          <section className="card card--wide" aria-labelledby="commands-heading">
            <div className="card-header">
              <div>
                <p className="section-label">Development</p>
                <h2 id="commands-heading">Command examples</h2>
              </div>
            </div>

            <ol className="command-list">
              {developmentCommands.map((command) => (
                <li key={command}>
                  <code>{command}</code>
                </li>
              ))}
            </ol>

            <p className="note">
              Desktop can start dummy, OpenCV camera capture-only, or an explicitly configured
              OpenCV face detection development pipeline. Camera frames stay local, Electron only
              manages native processes, and MotionFrame bridge URLs stay unchanged.
            </p>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default App
