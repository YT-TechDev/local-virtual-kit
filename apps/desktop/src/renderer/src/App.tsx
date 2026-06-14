import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LvkRuntimeStatus,
  MotionBridgeStatus,
  NativePipelineCameraSource,
  NativePipelineFaceDetector,
  NativeTrackerStatus
} from '../../preload/api'

type RuntimeStatus = LvkRuntimeStatus
type StatusTone = 'neutral' | 'warning' | 'success' | 'danger'
type PipelineActionPending = null | 'start' | 'start-and-open' | 'stop'

const RUNTIME_STATUS_POLL_INTERVAL_MS = 1500
const CAMERA_SOURCE_STORAGE_KEY = 'lvk.desktop.cameraSource'
const FACE_DETECTOR_STORAGE_KEY = 'lvk.desktop.faceDetector'
const CAMERA_INDEX_STORAGE_KEY = 'lvk.desktop.cameraIndex'
const MIN_CAMERA_INDEX = 0
const MAX_CAMERA_INDEX = 16

const developmentCommands = [
  'pnpm dev:web',
  'cmake -S native/tracker-core -B native/tracker-core/build',
  'cmake --build native/tracker-core/build',
  './native/tracker-core/build/lvk-tracker-core --camera-source dummy --face-detector noop --continuous --realtime | node tools/motion-ws-bridge.mjs',
  './native/tracker-core/build/lvk-tracker-core --camera-source opencv --face-detector noop --camera-index 0 --continuous --realtime --log-camera-status --camera-status-interval 60 | node tools/motion-ws-bridge.mjs',
  'LVK_FACE_CASCADE_PATH=/path/to/haarcascade.xml ./native/tracker-core/build/lvk-tracker-core --camera-source opencv --face-detector opencv --face-cascade /path/to/haarcascade.xml --frames 3 --log-face-status'
]

const cameraSourceLabels: Record<NativePipelineCameraSource, string> = {
  dummy: 'Dummy source',
  opencv: 'OpenCV camera'
}

const isNativePipelineCameraSource = (value: string | null): value is NativePipelineCameraSource =>
  value === 'dummy' || value === 'opencv'

const getStoredCameraSource = (): NativePipelineCameraSource => {
  try {
    const storedCameraSource = window.localStorage.getItem(CAMERA_SOURCE_STORAGE_KEY)

    if (isNativePipelineCameraSource(storedCameraSource)) {
      return storedCameraSource
    }
  } catch {
    // Keep the desktop UI usable if localStorage is unavailable.
  }

  return 'dummy'
}

const persistCameraSource = (cameraSource: NativePipelineCameraSource): void => {
  try {
    window.localStorage.setItem(CAMERA_SOURCE_STORAGE_KEY, cameraSource)
  } catch {
    // Persistence is best-effort; the selected value remains active in React state.
  }
}

const coerceCameraIndex = (value: unknown): number => {
  const numericValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numericValue)) {
    return MIN_CAMERA_INDEX
  }

  return Math.min(MAX_CAMERA_INDEX, Math.max(MIN_CAMERA_INDEX, Math.trunc(numericValue)))
}

const getStoredCameraIndex = (): number => {
  try {
    const storedCameraIndex = window.localStorage.getItem(CAMERA_INDEX_STORAGE_KEY)

    if (storedCameraIndex !== null) {
      return coerceCameraIndex(storedCameraIndex)
    }
  } catch {
    // Keep the desktop UI usable if localStorage is unavailable.
  }

  return MIN_CAMERA_INDEX
}

const persistCameraIndex = (cameraIndex: number): void => {
  try {
    window.localStorage.setItem(CAMERA_INDEX_STORAGE_KEY, String(cameraIndex))
  } catch {
    // Persistence is best-effort; the selected value remains active in React state.
  }
}

const isNativePipelineFaceDetector = (value: string | null): value is NativePipelineFaceDetector =>
  value === 'noop' || value === 'opencv'

const getStoredFaceDetector = (): NativePipelineFaceDetector => {
  try {
    const storedFaceDetector = window.localStorage.getItem(FACE_DETECTOR_STORAGE_KEY)

    if (isNativePipelineFaceDetector(storedFaceDetector)) {
      return storedFaceDetector
    }
  } catch {
    // Keep the desktop UI usable if localStorage is unavailable.
  }

  return 'noop'
}

const persistFaceDetector = (faceDetector: NativePipelineFaceDetector): void => {
  try {
    window.localStorage.setItem(FACE_DETECTOR_STORAGE_KEY, faceDetector)
  } catch {
    // Persistence is best-effort; the selected value remains active in React state.
  }
}

const faceDetectorLabels: Record<NativePipelineFaceDetector, string> = {
  noop: 'Noop face detector',
  opencv: 'OpenCV face detection'
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
  manual_dev_tool: 'Manual dev tool',
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

const isNativePipelineRunning = (status: RuntimeStatus): boolean =>
  status.nativeTrackerStatus === 'running' && status.motionBridgeStatus === 'running'

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
  const [selectedCameraSource, setSelectedCameraSource] =
    useState<NativePipelineCameraSource>(getStoredCameraSource)
  const [selectedFaceDetector, setSelectedFaceDetector] =
    useState<NativePipelineFaceDetector>(getStoredFaceDetector)
  const [selectedCameraIndex, setSelectedCameraIndex] = useState<number>(getStoredCameraIndex)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [pipelineActionPending, setPipelineActionPending] = useState<PipelineActionPending>(null)

  const isMountedRef = useRef(false)
  const isRuntimeStatusRequestInFlightRef = useRef(false)

  const loadRuntimeStatus = useCallback(async (): Promise<void> => {
    if (!desktopApi) {
      return
    }

    if (isRuntimeStatusRequestInFlightRef.current) {
      return
    }

    isRuntimeStatusRequestInFlightRef.current = true

    try {
      const status = await desktopApi.getRuntimeStatus()

      if (isMountedRef.current) {
        setRuntimeStatus(status)
        setLoadError(null)
      }
    } catch (error) {
      if (isMountedRef.current) {
        setLoadError(error instanceof Error ? error.message : 'Failed to load runtime status.')
      }
    } finally {
      isRuntimeStatusRequestInFlightRef.current = false
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

  const refreshRuntimeStatus = async (): Promise<void> => {
    await loadRuntimeStatus()
  }

  const openPreviewUrl = async (url: string): Promise<void> => {
    if (!desktopApi) {
      return
    }

    setOpenError(null)

    try {
      await desktopApi.openExternalUrl(url)
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : 'Failed to open preview URL.')
    }
  }

  const startNativePipeline = async (): Promise<void> => {
    if (!desktopApi || pipelineActionPending) {
      return
    }

    setPipelineError(null)
    setPipelineActionPending('start')

    try {
      setRuntimeStatus(
        await desktopApi.startNativePipeline({
          cameraSource: selectedCameraSource,
          faceDetector: selectedFaceDetector,
          cameraIndex: coerceCameraIndex(selectedCameraIndex)
        })
      )
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : 'Failed to start native pipeline.')
    } finally {
      setPipelineActionPending(null)
    }
  }

  const startNativePipelineAndOpenPreview = async (): Promise<void> => {
    if (!desktopApi || pipelineActionPending) {
      return
    }

    setOpenError(null)
    setPipelineError(null)
    setPipelineActionPending('start-and-open')

    try {
      const status = await desktopApi.startNativePipeline({
        cameraSource: selectedCameraSource,
        faceDetector: selectedFaceDetector,
        cameraIndex: coerceCameraIndex(selectedCameraIndex)
      })
      setRuntimeStatus(status)

      if (!isNativePipelineRunning(status)) {
        return
      }

      await desktopApi.openExternalUrl(status.previewNativeUrl)
    } catch (error) {
      setPipelineError(
        error instanceof Error ? error.message : 'Failed to start native pipeline and open preview.'
      )
    } finally {
      setPipelineActionPending(null)
    }
  }

  const updateSelectedCameraSource = (cameraSource: NativePipelineCameraSource): void => {
    setSelectedCameraSource(cameraSource)
    persistCameraSource(cameraSource)
  }

  const updateSelectedFaceDetector = (faceDetector: NativePipelineFaceDetector): void => {
    setSelectedFaceDetector(faceDetector)
    persistFaceDetector(faceDetector)
  }

  const updateSelectedCameraIndex = (cameraIndexValue: string): void => {
    const cameraIndex = coerceCameraIndex(cameraIndexValue)
    setSelectedCameraIndex(cameraIndex)
    persistCameraIndex(cameraIndex)
  }

  const stopNativePipeline = async (): Promise<void> => {
    if (!desktopApi || pipelineActionPending) {
      return
    }

    setPipelineError(null)
    setPipelineActionPending('stop')

    try {
      setRuntimeStatus(await desktopApi.stopNativePipeline())
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
  const canStartNativePipeline = Boolean(
    desktopApi && runtimeStatus && !isPipelineBusy && !isPipelineActionPending
  )
  const canStopNativePipeline = runtimeStatus
    ? !isPipelineActionPending &&
      (['starting', 'running'].includes(runtimeStatus.nativeTrackerStatus) ||
        ['starting', 'running'].includes(runtimeStatus.motionBridgeStatus))
    : false
  const activeCameraSource = runtimeStatus?.pipelineCameraSource ?? 'dummy'
  const activeFaceDetector = runtimeStatus?.pipelineFaceDetector ?? 'noop'
  const activeCameraIndex = runtimeStatus?.pipelineCameraIndex ?? MIN_CAMERA_INDEX

  return (
    <main className="desktop-shell">
      <section className="hero-panel" aria-labelledby="app-title">
        <p className="eyebrow">LVK Desktop Preview</p>
        <h1 id="app-title">Local Virtual Kit</h1>
        <p className="hero-description">Local-first VTuber / virtual avatar starter kit.</p>
      </section>

      {loadError ? <p className="error-message">{loadError}</p> : null}

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
                <button type="button" onClick={() => openPreviewUrl(runtimeStatus.previewDummyUrl)}>
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
                >
                  Open
                </button>
              </div>

              <div className="url-row">
                <div>
                  <span className="url-label">OBS native source</span>
                  <code>{runtimeStatus.previewObsNativeUrl}</code>
                </div>
                <button
                  type="button"
                  onClick={() => openPreviewUrl(runtimeStatus.previewObsNativeUrl)}
                >
                  Open
                </button>
              </div>
            </div>

            {openError ? <p className="error-message compact">{openError}</p> : null}
          </section>

          <section className="card" aria-labelledby="runtime-heading">
            <div className="card-header">
              <div>
                <p className="section-label">Runtime</p>
                <h2 id="runtime-heading">Source status</h2>
              </div>
              <StatusPill label="Auto-refreshing" />
            </div>

            <dl className="status-list">
              <div>
                <dt>MotionFrame endpoint</dt>
                <dd>
                  <code>{runtimeStatus.motionEndpoint}</code>
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
              <button type="button" onClick={refreshRuntimeStatus}>
                Refresh status
              </button>
            </div>

            {pipelineActionPending ? (
              <p className="runtime-message compact" role="status">
                {pipelineActionPendingMessages[pipelineActionPending]}
              </p>
            ) : null}

            {runtimeStatus.lastError ? (
              <p className="error-message compact">{runtimeStatus.lastError}</p>
            ) : null}
            {pipelineError ? <p className="error-message compact">{pipelineError}</p> : null}
            {runtimeStatus.lastMessage ? (
              <p className="runtime-message">{runtimeStatus.lastMessage}</p>
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
