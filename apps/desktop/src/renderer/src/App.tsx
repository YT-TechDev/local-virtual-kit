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

const RUNTIME_STATUS_POLL_INTERVAL_MS = 1500
const CAMERA_SOURCE_STORAGE_KEY = 'lvk.desktop.cameraSource'

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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)

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
    if (!desktopApi) {
      return
    }

    setPipelineError(null)

    try {
      setRuntimeStatus(await desktopApi.startNativePipeline({ cameraSource: selectedCameraSource }))
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : 'Failed to start native pipeline.')
    }
  }

  const startNativePipelineAndOpenPreview = async (): Promise<void> => {
    if (!desktopApi) {
      return
    }

    setOpenError(null)
    setPipelineError(null)

    try {
      const status = await desktopApi.startNativePipeline({ cameraSource: selectedCameraSource })
      setRuntimeStatus(status)

      if (!isNativePipelineRunning(status)) {
        return
      }

      await desktopApi.openExternalUrl(status.previewNativeUrl)
    } catch (error) {
      setPipelineError(
        error instanceof Error ? error.message : 'Failed to start native pipeline and open preview.'
      )
    }
  }

  const updateSelectedCameraSource = (cameraSource: NativePipelineCameraSource): void => {
    setSelectedCameraSource(cameraSource)
    persistCameraSource(cameraSource)
  }

  const stopNativePipeline = async (): Promise<void> => {
    if (!desktopApi) {
      return
    }

    setPipelineError(null)

    try {
      setRuntimeStatus(await desktopApi.stopNativePipeline())
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : 'Failed to stop native pipeline.')
    }
  }

  const isPipelineBusy = runtimeStatus
    ? ['starting', 'running', 'stopping'].includes(runtimeStatus.nativeTrackerStatus) ||
      ['starting', 'running', 'stopping'].includes(runtimeStatus.motionBridgeStatus)
    : false
  const canStartNativePipeline = Boolean(desktopApi && runtimeStatus && !isPipelineBusy)
  const canStopNativePipeline = runtimeStatus
    ? ['starting', 'running'].includes(runtimeStatus.nativeTrackerStatus) ||
      ['starting', 'running'].includes(runtimeStatus.motionBridgeStatus)
    : false
  const activeCameraSource = runtimeStatus?.pipelineCameraSource ?? 'dummy'
  const activeFaceDetector = runtimeStatus?.pipelineFaceDetector ?? 'noop'

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
                disabled={isPipelineBusy}
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
              Future controls for camera source, preview, face detector selection, and runtime
              preferences will live here. OpenCV face detection is optional and requires an explicit
              LVK_FACE_CASCADE_PATH configuration before Electron passes a cascade to the native
              tracker.
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
