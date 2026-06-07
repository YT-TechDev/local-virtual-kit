import { useEffect, useState } from 'react'

type RuntimeStatus = Awaited<ReturnType<Window['lvk']['getRuntimeStatus']>>

type NativeTrackerStatus = RuntimeStatus['nativeTrackerStatus']
type MotionBridgeStatus = RuntimeStatus['motionBridgeStatus']
type StatusTone = 'neutral' | 'warning' | 'success' | 'danger'

const developmentCommands = [
  'pnpm dev:web',
  'cmake -S native/tracker-core -B native/tracker-core/build',
  'cmake --build native/tracker-core/build'
]

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
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)

  const refreshRuntimeStatus = async (): Promise<void> => {
    setLoadError(null)

    try {
      setRuntimeStatus(await window.lvk.getRuntimeStatus())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load runtime status.')
    }
  }

  useEffect(() => {
    let isMounted = true

    window.lvk
      .getRuntimeStatus()
      .then((status) => {
        if (isMounted) {
          setRuntimeStatus(status)
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load runtime status.')
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  const openPreviewUrl = async (url: string): Promise<void> => {
    setOpenError(null)

    try {
      await window.lvk.openExternalUrl(url)
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : 'Failed to open preview URL.')
    }
  }

  const startNativePipeline = async (): Promise<void> => {
    setPipelineError(null)

    try {
      setRuntimeStatus(await window.lvk.startNativePipeline())
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : 'Failed to start native pipeline.')
    }
  }

  const stopNativePipeline = async (): Promise<void> => {
    setPipelineError(null)

    try {
      setRuntimeStatus(await window.lvk.stopNativePipeline())
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : 'Failed to stop native pipeline.')
    }
  }

  const canStartNativePipeline = runtimeStatus
    ? !['starting', 'running', 'stopping'].includes(runtimeStatus.nativeTrackerStatus) &&
      !['starting', 'running', 'stopping'].includes(runtimeStatus.motionBridgeStatus)
    : false
  const canStopNativePipeline = runtimeStatus
    ? ['starting', 'running'].includes(runtimeStatus.nativeTrackerStatus) ||
      ['starting', 'running'].includes(runtimeStatus.motionBridgeStatus)
    : false

  return (
    <main className="desktop-shell">
      <section className="hero-panel" aria-labelledby="app-title">
        <p className="eyebrow">LVK Desktop Preview</p>
        <h1 id="app-title">Local Virtual Kit</h1>
        <p className="hero-description">Local-first VTuber / virtual avatar starter kit.</p>
      </section>

      {loadError ? <p className="error-message">{loadError}</p> : null}

      {runtimeStatus ? (
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
            </div>

            {openError ? <p className="error-message compact">{openError}</p> : null}
          </section>

          <section className="card" aria-labelledby="runtime-heading">
            <div className="card-header">
              <div>
                <p className="section-label">Runtime</p>
                <h2 id="runtime-heading">Source status</h2>
              </div>
            </div>

            <dl className="status-list">
              <div>
                <dt>MotionFrame endpoint</dt>
                <dd>
                  <code>{runtimeStatus.motionEndpoint}</code>
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

            <div className="button-row" aria-label="Development native pipeline controls">
              <button
                type="button"
                onClick={startNativePipeline}
                disabled={!canStartNativePipeline}
              >
                Start native pipeline
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
              This shell can start the development native dummy MotionFrame pipeline after the
              native tracker has been built. Real camera tracking and the final production native
              transport are still out of scope for this development control surface.
            </p>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default App
