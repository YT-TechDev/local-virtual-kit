import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import nodeProcess from 'node:process'
import type { LvkRuntimeStatus, MotionBridgeStatus, NativeTrackerStatus } from '../preload/api'

const PREVIEW_DUMMY_URL = 'http://localhost:5173/?source=dummy'
const PREVIEW_NATIVE_URL = 'http://localhost:5173/?source=native'
const MOTION_ENDPOINT = 'ws://127.0.0.1:45731/motion'
const TRACKER_FRAME_COUNT = '600'
const FORCE_KILL_TIMEOUT_MS = 1_500
const MAX_STATUS_MESSAGE_LENGTH = 360

function createInitialStatus(): LvkRuntimeStatus {
  return {
    previewDummyUrl: PREVIEW_DUMMY_URL,
    previewNativeUrl: PREVIEW_NATIVE_URL,
    motionEndpoint: MOTION_ENDPOINT,
    nativeTrackerStatus: 'not_started',
    motionBridgeStatus: 'manual_dev_tool'
  }
}

function findRepoRoot(): string {
  let current = resolve(__dirname)

  for (let depth = 0; depth < 8; depth += 1) {
    if (
      existsSync(join(current, 'package.json')) &&
      existsSync(join(current, 'tools', 'motion-ws-bridge.mjs'))
    ) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  return resolve(__dirname, '../../../..')
}

function truncateStatusMessage(message: string): string {
  const normalized = message.trim().replace(/\s+/g, ' ')
  if (normalized.length <= MAX_STATUS_MESSAGE_LENGTH) {
    return normalized
  }

  return `${normalized.slice(0, MAX_STATUS_MESSAGE_LENGTH - 1)}…`
}

function isActiveStatus(status: NativeTrackerStatus | MotionBridgeStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'stopping'
}

function hasExited(processRef: ChildProcessWithoutNullStreams): boolean {
  return processRef.exitCode !== null || processRef.signalCode !== null
}

function getTrackerExecutableCandidates(repoRoot: string): string[] {
  const executableName =
    nodeProcess.platform === 'win32' ? 'lvk-tracker-core.exe' : 'lvk-tracker-core'
  const buildDir = join(repoRoot, 'native', 'tracker-core', 'build')
  const configDirs = ['', 'Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel']

  return configDirs.map((configDir) =>
    configDir ? join(buildDir, configDir, executableName) : join(buildDir, executableName)
  )
}

function resolveTrackerExecutable(repoRoot: string): string | null {
  return (
    getTrackerExecutableCandidates(repoRoot).find((candidatePath) => existsSync(candidatePath)) ??
    null
  )
}

export class NativePipelineManager {
  private status = createInitialStatus()
  private trackerProcess: ChildProcessWithoutNullStreams | null = null
  private bridgeProcess: ChildProcessWithoutNullStreams | null = null
  private isStopping = false

  getStatus(): LvkRuntimeStatus {
    return { ...this.status }
  }

  start(): LvkRuntimeStatus {
    if (
      isActiveStatus(this.status.nativeTrackerStatus) ||
      isActiveStatus(this.status.motionBridgeStatus)
    ) {
      return this.getStatus()
    }

    const repoRoot = findRepoRoot()
    const bridgeScriptPath = join(repoRoot, 'tools', 'motion-ws-bridge.mjs')
    const trackerExecutableCandidates = getTrackerExecutableCandidates(repoRoot)
    const trackerExecutablePath = resolveTrackerExecutable(repoRoot)

    if (!existsSync(bridgeScriptPath)) {
      this.status = {
        ...this.status,
        nativeTrackerStatus: 'not_started',
        motionBridgeStatus: 'error',
        lastError: `Development MotionFrame bridge was not found at ${bridgeScriptPath}. Run this from the LVK repository checkout.`
      }
      return this.getStatus()
    }

    if (trackerExecutablePath === null) {
      this.status = {
        ...this.status,
        nativeTrackerStatus: 'error',
        motionBridgeStatus: 'manual_dev_tool',
        lastError: `Native tracker executable was not found. Build it first with: cmake -S native/tracker-core -B native/tracker-core/build && cmake --build native/tracker-core/build. Candidate locations checked: ${trackerExecutableCandidates.join(', ')}`
      }
      return this.getStatus()
    }

    this.isStopping = false
    this.status = {
      ...createInitialStatus(),
      nativeTrackerStatus: 'starting',
      motionBridgeStatus: 'starting',
      lastMessage: 'Starting development native MotionFrame pipeline.'
    }

    try {
      this.bridgeProcess = spawn(nodeProcess.execPath, [bridgeScriptPath], {
        cwd: repoRoot,
        env: { ...nodeProcess.env, ELECTRON_RUN_AS_NODE: '1' },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      this.attachProcessHandlers('bridge', this.bridgeProcess)

      this.trackerProcess = spawn(
        trackerExecutablePath,
        ['--frames', TRACKER_FRAME_COUNT, '--realtime'],
        {
          cwd: repoRoot,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
      this.attachProcessHandlers('tracker', this.trackerProcess)

      this.trackerProcess.stdout.pipe(this.bridgeProcess.stdin, { end: true })
      this.bridgeProcess.stdin.on('error', (error: NodeJS.ErrnoException) => {
        if (!this.isStopping && error.code !== 'EPIPE') {
          this.status = {
            ...this.status,
            motionBridgeStatus: 'error',
            lastError: `Motion bridge stdin error: ${truncateStatusMessage(error.message)}`
          }
        }
      })

      this.status = {
        ...this.status,
        nativeTrackerStatus: 'running',
        motionBridgeStatus: 'running',
        lastMessage: `Development native pipeline started with realtime dummy output. Open ${PREVIEW_NATIVE_URL} to preview native MotionFrames.`
      }
    } catch (error) {
      this.status = {
        ...this.status,
        nativeTrackerStatus: 'error',
        motionBridgeStatus: 'error',
        lastError: error instanceof Error ? error.message : 'Failed to start native pipeline.'
      }
      void this.stop()
    }

    return this.getStatus()
  }

  async stop(): Promise<LvkRuntimeStatus> {
    if (
      !this.trackerProcess &&
      !this.bridgeProcess &&
      !isActiveStatus(this.status.nativeTrackerStatus) &&
      !isActiveStatus(this.status.motionBridgeStatus)
    ) {
      return this.getStatus()
    }

    this.isStopping = true
    this.status = {
      ...this.status,
      nativeTrackerStatus: this.trackerProcess ? 'stopping' : this.status.nativeTrackerStatus,
      motionBridgeStatus: this.bridgeProcess ? 'stopping' : this.status.motionBridgeStatus,
      lastMessage: 'Stopping development native MotionFrame pipeline.'
    }

    if (this.trackerProcess && this.bridgeProcess) {
      this.trackerProcess.stdout.unpipe(this.bridgeProcess.stdin)
    }

    if (this.bridgeProcess?.stdin.writable) {
      this.bridgeProcess.stdin.end()
    }

    await Promise.all([
      this.terminateProcess(this.trackerProcess),
      this.terminateProcess(this.bridgeProcess)
    ])

    this.trackerProcess = null
    this.bridgeProcess = null
    this.status = {
      ...this.status,
      nativeTrackerStatus: 'exited',
      motionBridgeStatus: 'exited',
      lastMessage: 'Development native MotionFrame pipeline stopped.'
    }
    this.isStopping = false

    return this.getStatus()
  }

  cleanupOnQuit(): void {
    this.isStopping = true

    if (this.trackerProcess && this.bridgeProcess) {
      this.trackerProcess.stdout.unpipe(this.bridgeProcess.stdin)
    }

    if (this.bridgeProcess?.stdin.writable) {
      this.bridgeProcess.stdin.end()
    }

    this.killProcess(this.trackerProcess)
    this.killProcess(this.bridgeProcess)
    this.trackerProcess = null
    this.bridgeProcess = null
  }

  private attachProcessHandlers(
    kind: 'tracker' | 'bridge',
    childProcess: ChildProcessWithoutNullStreams
  ): void {
    childProcess.stdout.on('data', () => {
      // Native MotionFrames are intentionally not logged from Electron main.
    })

    childProcess.stderr.on('data', (data: Buffer) => {
      const message = truncateStatusMessage(data.toString('utf8'))
      if (!message) {
        return
      }

      this.status = {
        ...this.status,
        lastMessage: `${kind === 'tracker' ? 'Native tracker' : 'Motion bridge'}: ${message}`
      }

      if (kind === 'bridge' && message.includes('server error') && !this.isStopping) {
        this.status = {
          ...this.status,
          motionBridgeStatus: 'error',
          lastError: `Motion bridge failed: ${message}`
        }

        void this.terminateProcess(this.trackerProcess)
        void this.terminateProcess(this.bridgeProcess)
      }
    })

    childProcess.once('error', (error) => {
      if (kind === 'tracker') {
        this.status = {
          ...this.status,
          nativeTrackerStatus: 'error',
          lastError: `Native tracker failed: ${truncateStatusMessage(error.message)}`
        }
      } else {
        this.status = {
          ...this.status,
          motionBridgeStatus: 'error',
          lastError: `Motion bridge failed: ${truncateStatusMessage(error.message)}`
        }
      }
    })

    childProcess.once('exit', (code, signal) => {
      if (kind === 'tracker' && this.trackerProcess === childProcess) {
        this.trackerProcess = null
        if (!this.isStopping) {
          this.status = {
            ...this.status,
            nativeTrackerStatus: code === 0 ? 'exited' : 'error',
            lastMessage:
              code === 0
                ? 'Native tracker exited after emitting development dummy frames.'
                : this.status.lastMessage,
            lastError:
              code === 0
                ? this.status.lastError
                : `Native tracker exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}.`
          }
        }
      }

      if (kind === 'bridge' && this.bridgeProcess === childProcess) {
        this.bridgeProcess = null
        if (!this.isStopping) {
          this.status = {
            ...this.status,
            motionBridgeStatus: code === 0 ? 'exited' : 'error',
            lastError:
              code === 0
                ? this.status.lastError
                : `Motion bridge exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}.`
          }

          if (code !== 0 && this.trackerProcess) {
            void this.terminateProcess(this.trackerProcess)
          }
        }
      }
    })
  }

  private async terminateProcess(
    childProcess: ChildProcessWithoutNullStreams | null
  ): Promise<void> {
    if (!childProcess || hasExited(childProcess)) {
      return
    }

    await new Promise<void>((resolvePromise) => {
      const timeout = setTimeout(() => {
        this.killProcess(childProcess)
      }, FORCE_KILL_TIMEOUT_MS)

      childProcess.once('exit', () => {
        clearTimeout(timeout)
        resolvePromise()
      })

      this.killProcess(childProcess, 'SIGTERM')
    })
  }

  private killProcess(
    childProcess: ChildProcessWithoutNullStreams | null,
    signal: NodeJS.Signals = 'SIGKILL'
  ): void {
    if (!childProcess || hasExited(childProcess)) {
      return
    }

    childProcess.kill(signal)
  }
}
