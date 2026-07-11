import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import nodeProcess from 'node:process'
import { createInterface, type Interface as RlInterface } from 'node:readline'
import type {
  LvkRuntimeStatus,
  MotionBridgeStatus,
  NativeRuntimeCapabilities,
  NativePipelineCameraSource,
  NativePipelineFaceDetector,
  NativeTrackerStatus
} from '../preload/api'
import {
  startMotionBridgeServer,
  stopMotionBridgeServer,
  publishMotionFrameLine
} from './motionBridgeServer'

const PREVIEW_DUMMY_URL = 'http://localhost:5173/?source=dummy'
const PREVIEW_NATIVE_URL = 'http://localhost:5173/?source=native'
const PREVIEW_OBS_NATIVE_URL = 'http://localhost:5173/?mode=obs&source=native'
const PREVIEW_OBS_DUMMY_URL = 'http://localhost:5173/?mode=obs&source=dummy'
const MOTION_ENDPOINT = 'ws://127.0.0.1:45731/motion'
const FORCE_KILL_TIMEOUT_MS = 1_500
const NO_FRAME_STARTUP_TIMEOUT_MS = 8_000
const NO_FRAME_STARTUP_WARNING_MESSAGE =
  'No MotionFrame has been received yet since the native pipeline started. Check the tracker/camera configuration or rebuild the native tracker.'
const MAX_STATUS_MESSAGE_LENGTH = 360
const DEFAULT_CAMERA_FPS = 60
const DEFAULT_CAMERA_WIDTH = 640
const DEFAULT_CAMERA_HEIGHT = 480

function getConfiguredFaceCascadePath(): string | null {
  const cascadePath = nodeProcess.env.LVK_FACE_CASCADE_PATH?.trim()
  return cascadePath ? cascadePath : null
}

function getFaceDetector(
  cameraSource: NativePipelineCameraSource,
  faceDetector?: NativePipelineFaceDetector
): NativePipelineFaceDetector {
  if (faceDetector) {
    return faceDetector
  }

  return cameraSource === 'opencv' && getConfiguredFaceCascadePath() ? 'opencv' : 'noop'
}

function createTrackerArgs(
  cameraSource: NativePipelineCameraSource,
  faceDetector: NativePipelineFaceDetector,
  cameraIndex: number,
  cameraFps: number,
  cameraWidth: number,
  cameraHeight: number
): string[] {
  const baseArgs = [
    '--camera-source',
    cameraSource,
    '--face-detector',
    faceDetector,
    '--continuous',
    '--realtime',
    '--camera-fps',
    String(cameraFps),
    '--camera-width',
    String(cameraWidth),
    '--camera-height',
    String(cameraHeight),
    '--log-pipeline-status',
    '--pipeline-status-interval',
    '60'
  ]

  if (faceDetector === 'opencv') {
    const cascadePath = getConfiguredFaceCascadePath()
    if (cascadePath) {
      baseArgs.push('--face-cascade', cascadePath, '--log-face-status')
    }
  }

  if (cameraSource === 'opencv') {
    baseArgs.push(
      '--camera-index',
      String(cameraIndex),
      '--log-camera-status',
      '--camera-status-interval',
      '60'
    )
  }

  return baseArgs
}

function getCameraSourceLabel(cameraSource: NativePipelineCameraSource): string {
  return cameraSource === 'opencv' ? 'OpenCV camera' : 'dummy'
}

function getFaceDetectorLabel(faceDetector: NativePipelineFaceDetector): string {
  return faceDetector === 'opencv' ? 'OpenCV face detection' : 'noop face detector'
}

function createInitialStatus(): LvkRuntimeStatus {
  return {
    previewDummyUrl: PREVIEW_DUMMY_URL,
    previewNativeUrl: PREVIEW_NATIVE_URL,
    previewObsNativeUrl: PREVIEW_OBS_NATIVE_URL,
    previewObsDummyUrl: PREVIEW_OBS_DUMMY_URL,
    motionEndpoint: MOTION_ENDPOINT,
    nativeTrackerStatus: 'not_started',
    motionBridgeStatus: 'not_started',
    startupWarning: 'none',
    pipelineCameraSource: 'dummy',
    pipelineFaceDetector: 'noop',
    pipelineCameraIndex: 0,
    pipelineCameraFps: DEFAULT_CAMERA_FPS,
    pipelineCameraWidth: DEFAULT_CAMERA_WIDTH,
    pipelineCameraHeight: DEFAULT_CAMERA_HEIGHT,
    faceCascadePathConfigured: getConfiguredFaceCascadePath() !== null
  }
}

function resolvePackagedTrackerExecutable(): string | null {
  const electronProcess = nodeProcess as NodeJS.Process & { resourcesPath?: string }
  const resourcesPath = electronProcess.resourcesPath
  if (!resourcesPath) return null
  const executableName =
    nodeProcess.platform === 'win32' ? 'lvk-tracker-core.exe' : 'lvk-tracker-core'
  const candidatePath = join(resourcesPath, 'native-runtime', 'bin', executableName)
  return existsSync(candidatePath) ? candidatePath : null
}

function buildNativeRuntimeEnv(binDir: string): NodeJS.ProcessEnv {
  const sep = nodeProcess.platform === 'win32' ? ';' : ':'
  const systemBase =
    nodeProcess.platform === 'win32'
      ? `${nodeProcess.env.SystemRoot ?? 'C:\\Windows'}\\System32${sep}${nodeProcess.env.SystemRoot ?? 'C:\\Windows'}`
      : '/usr/bin:/bin'
  return { ...nodeProcess.env, PATH: `${binDir}${sep}${systemBase}` }
}

// Stable, repo-level markers that identify the LVK monorepo root. A nested
// workspace package (for example apps/desktop) also contains a package.json, so
// the presence of package.json alone is not enough: in Electron dev the walk
// would otherwise stop at apps/desktop and resolve native build outputs under
// apps/desktop/native/... instead of the real repository root.
function isLvkRepoRoot(candidatePath: string): boolean {
  const packageJsonPath = join(candidatePath, 'package.json')
  if (!existsSync(packageJsonPath)) {
    return false
  }

  // The monorepo root owns the Native Core source tree; nested workspace
  // packages do not. Require it so apps/desktop is never mistaken for the root.
  if (!existsSync(join(candidatePath, 'native', 'tracker-core'))) {
    return false
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: unknown }
    return parsed.name === 'local-virtual-kit'
  } catch {
    // A missing/unreadable/malformed package.json cannot confirm the repo root.
    return false
  }
}

function findRepoRoot(): string {
  let current = resolve(__dirname)

  for (let depth = 0; depth < 8; depth += 1) {
    if (isLvkRepoRoot(current)) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  // Fallback when no LVK monorepo root marker is found within the bounded walk.
  // Derived relative to this module's location so resolution stays deterministic
  // and dependency-free; packaged builds resolve the tracker separately.
  return resolve(__dirname, '../../../..')
}

function describeTrackerSpawnError(error: Error): string {
  const errno = error as NodeJS.ErrnoException
  if (errno.code === 'ENOENT') {
    return (
      `Missing/inaccessible helper binary (ENOENT): rebuild the native tracker helper ` +
      `and verify the built binary exists. Detail: ${error.message}`
    )
  }
  if (errno.code === 'EACCES') {
    return (
      `Permission denied on helper binary (EACCES): check executable permissions on ` +
      `the built binary. Detail: ${error.message}`
    )
  }
  return `Native tracker failed to start: ${error.message}`
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

const CAPABILITIES_REQUIRED_KEYS = [
  'opencvCameraSupport',
  'opencvFaceDetectorSupport',
  'supportedCameraSources',
  'supportedFaceDetectors'
] as const

const CAPABILITIES_FAILED_RESULT: NativeRuntimeCapabilities = {
  opencvCameraSupport: null,
  opencvFaceDetectorSupport: null,
  supportedCameraSources: [],
  supportedFaceDetectors: [],
  cameraOpened: false,
  motionFramesEmitted: false,
  localOnly: true,
  error: 'Native runtime capabilities command failed. Rebuild the native tracker and retry.'
}

function parseCapabilitiesOutput(stdout: string): NativeRuntimeCapabilities {
  if (!stdout.includes('LVK native runtime capabilities')) {
    return CAPABILITIES_FAILED_RESULT
  }

  const lines = stdout.split('\n')
  const getValue = (key: string): string | undefined => {
    const line = lines.find((l) => l.startsWith(`${key}=`))
    return line ? line.slice(key.length + 1).trim() : undefined
  }

  for (const key of CAPABILITIES_REQUIRED_KEYS) {
    if (getValue(key) === undefined) {
      return CAPABILITIES_FAILED_RESULT
    }
  }

  const parseBool = (val: string | undefined): boolean | null => {
    if (val === 'true') return true
    if (val === 'false') return false
    return null
  }

  return {
    opencvCameraSupport: parseBool(getValue('opencvCameraSupport')),
    opencvFaceDetectorSupport: parseBool(getValue('opencvFaceDetectorSupport')),
    supportedCameraSources: getValue('supportedCameraSources')?.split(',').filter(Boolean) ?? [],
    supportedFaceDetectors: getValue('supportedFaceDetectors')?.split(',').filter(Boolean) ?? [],
    cameraOpened: false,
    motionFramesEmitted: false,
    localOnly: true
  }
}

const CAPABILITIES_SPAWN_FAILED_RESULT: NativeRuntimeCapabilities = {
  opencvCameraSupport: null,
  opencvFaceDetectorSupport: null,
  supportedCameraSources: [],
  supportedFaceDetectors: [],
  cameraOpened: false,
  motionFramesEmitted: false,
  localOnly: true,
  error: 'Native runtime capabilities command could not start. Build the native tracker and retry.'
}

export async function queryNativeRuntimeCapabilities(): Promise<NativeRuntimeCapabilities> {
  const packagedPath = resolvePackagedTrackerExecutable()
  const repoRoot = findRepoRoot()
  const executablePath = packagedPath ?? resolveTrackerExecutable(repoRoot)

  if (!executablePath) {
    return {
      opencvCameraSupport: null,
      opencvFaceDetectorSupport: null,
      supportedCameraSources: [],
      supportedFaceDetectors: [],
      cameraOpened: false,
      motionFramesEmitted: false,
      localOnly: true,
      skipped: true,
      error: 'Native tracker binary not found. Build the native tracker first.'
    }
  }

  const spawnEnv = packagedPath ? buildNativeRuntimeEnv(dirname(packagedPath)) : undefined

  return new Promise((resolve) => {
    let stdout = ''
    const child = spawn(executablePath, ['--print-runtime-capabilities'], {
      env: spawnEnv
    })

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        resolve(CAPABILITIES_FAILED_RESULT)
        return
      }
      resolve(parseCapabilitiesOutput(stdout))
    })

    child.on('error', () => {
      resolve(CAPABILITIES_SPAWN_FAILED_RESULT)
    })
  })
}

export class NativePipelineManager {
  private status = createInitialStatus()
  private trackerProcess: ChildProcessWithoutNullStreams | null = null
  private trackerStdoutReader: RlInterface | null = null
  private isStopping = false
  private noFrameStartupTimer: NodeJS.Timeout | null = null
  private hasReceivedMotionFrameSinceStart = false

  getStatus(): LvkRuntimeStatus {
    return { ...this.status }
  }

  start({
    cameraSource = 'dummy',
    faceDetector: requestedFaceDetector,
    cameraIndex = 0,
    cameraFps = DEFAULT_CAMERA_FPS,
    cameraWidth = DEFAULT_CAMERA_WIDTH,
    cameraHeight = DEFAULT_CAMERA_HEIGHT
  }: {
    cameraSource?: NativePipelineCameraSource
    faceDetector?: NativePipelineFaceDetector
    cameraIndex?: number
    cameraFps?: number
    cameraWidth?: number
    cameraHeight?: number
  } = {}): LvkRuntimeStatus {
    if (
      isActiveStatus(this.status.nativeTrackerStatus) ||
      isActiveStatus(this.status.motionBridgeStatus)
    ) {
      return this.getStatus()
    }

    const faceDetector = getFaceDetector(cameraSource, requestedFaceDetector)
    const cameraSourceLabel = getCameraSourceLabel(cameraSource)
    const faceDetectorLabel = getFaceDetectorLabel(faceDetector)
    const repoRoot = findRepoRoot()
    const faceCascadePath = getConfiguredFaceCascadePath()
    const trackerExecutableCandidates = getTrackerExecutableCandidates(repoRoot)
    const packagedTrackerPath = resolvePackagedTrackerExecutable()
    const trackerExecutablePath = packagedTrackerPath ?? resolveTrackerExecutable(repoRoot)
    const trackerEnv = packagedTrackerPath
      ? buildNativeRuntimeEnv(dirname(packagedTrackerPath))
      : undefined

    if (requestedFaceDetector === 'opencv' && !faceCascadePath) {
      this.status = {
        ...this.status,
        nativeTrackerStatus: 'error',
        motionBridgeStatus: 'not_started',
        startupWarning: 'none',
        pipelineCameraSource: cameraSource,
        pipelineFaceDetector: faceDetector,
        pipelineCameraIndex: cameraIndex,
        pipelineCameraFps: cameraFps,
        pipelineCameraWidth: cameraWidth,
        pipelineCameraHeight: cameraHeight,
        lastError:
          'OpenCV face detection requires LVK_FACE_CASCADE_PATH to point to a Haar cascade XML file before starting the native pipeline.'
      }
      return this.getStatus()
    }

    const trackerArgs = createTrackerArgs(
      cameraSource,
      faceDetector,
      cameraIndex,
      cameraFps,
      cameraWidth,
      cameraHeight
    )

    if (trackerExecutablePath === null) {
      this.status = {
        ...this.status,
        nativeTrackerStatus: 'error',
        motionBridgeStatus: 'not_started',
        startupWarning: 'none',
        pipelineCameraSource: cameraSource,
        pipelineFaceDetector: faceDetector,
        pipelineCameraIndex: cameraIndex,
        pipelineCameraFps: cameraFps,
        pipelineCameraWidth: cameraWidth,
        pipelineCameraHeight: cameraHeight,
        lastError: `Native tracker executable was not found. Build it first with: cmake -S native/tracker-core -B native/tracker-core/build && cmake --build native/tracker-core/build. Candidate locations checked: ${trackerExecutableCandidates.join(', ')}`
      }
      return this.getStatus()
    }

    this.isStopping = false
    this.status = {
      ...createInitialStatus(),
      nativeTrackerStatus: 'starting',
      motionBridgeStatus: 'starting',
      pipelineCameraSource: cameraSource,
      pipelineFaceDetector: faceDetector,
      pipelineCameraIndex: cameraIndex,
      pipelineCameraFps: cameraFps,
      pipelineCameraWidth: cameraWidth,
      pipelineCameraHeight: cameraHeight,
      lastMessage: `Starting native MotionFrame pipeline with ${cameraSourceLabel} source and ${faceDetectorLabel}.`
    }

    try {
      startMotionBridgeServer((error) => {
        if (!this.isStopping) {
          this.clearNoFrameStartupTimer()
          this.status = {
            ...this.status,
            motionBridgeStatus: 'error',
            startupWarning: 'none',
            lastError: `Motion bridge server error: ${truncateStatusMessage(error.message)}`
          }
          void this.terminateProcess(this.trackerProcess)
          stopMotionBridgeServer()
        }
      })

      this.trackerProcess = spawn(trackerExecutablePath, trackerArgs, {
        cwd: packagedTrackerPath ? dirname(packagedTrackerPath) : repoRoot,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(trackerEnv ? { env: trackerEnv } : {})
      })
      this.attachProcessHandlers('tracker', this.trackerProcess)

      this.trackerStdoutReader = createInterface({
        input: this.trackerProcess.stdout,
        crlfDelay: Infinity,
        terminal: false
      })
      this.trackerStdoutReader.on('line', (line: string) => {
        if (publishMotionFrameLine(line)) {
          this.handleValidMotionFrameReceived()
        }
      })

      this.armNoFrameStartupTimer()

      this.status = {
        ...this.status,
        nativeTrackerStatus: 'running',
        motionBridgeStatus: 'running',
        pipelineCameraSource: cameraSource,
        pipelineFaceDetector: faceDetector,
        pipelineCameraIndex: cameraIndex,
        pipelineCameraFps: cameraFps,
        pipelineCameraWidth: cameraWidth,
        pipelineCameraHeight: cameraHeight,
        lastMessage: `Native pipeline started with ${cameraSourceLabel} source and ${faceDetectorLabel}. Open ${PREVIEW_NATIVE_URL} to preview native MotionFrames.`
      }
    } catch (error) {
      this.clearNoFrameStartupTimer()
      this.status = {
        ...this.status,
        nativeTrackerStatus: 'error',
        motionBridgeStatus: 'error',
        startupWarning: 'none',
        lastError: error instanceof Error ? error.message : 'Failed to start native pipeline.'
      }
      void this.stop()
    }

    return this.getStatus()
  }

  async stop(): Promise<LvkRuntimeStatus> {
    if (
      !this.trackerProcess &&
      !isActiveStatus(this.status.nativeTrackerStatus) &&
      !isActiveStatus(this.status.motionBridgeStatus)
    ) {
      return this.getStatus()
    }

    this.isStopping = true
    this.clearNoFrameStartupTimer()
    try {
      this.status = {
        ...this.status,
        nativeTrackerStatus: this.trackerProcess ? 'stopping' : this.status.nativeTrackerStatus,
        motionBridgeStatus: 'stopping',
        lastMessage: 'Stopping native MotionFrame pipeline.'
      }

      this.trackerStdoutReader?.close()
      this.trackerStdoutReader = null

      await this.terminateProcess(this.trackerProcess)
      stopMotionBridgeServer()

      this.trackerProcess = null
      this.status = {
        ...this.status,
        nativeTrackerStatus: 'exited',
        motionBridgeStatus: 'exited',
        startupWarning: 'none',
        lastMessage: 'Native MotionFrame pipeline stopped.'
      }
    } finally {
      this.isStopping = false
    }

    return this.getStatus()
  }

  cleanupOnQuit(): void {
    this.isStopping = true
    this.clearNoFrameStartupTimer()

    this.trackerStdoutReader?.close()
    this.trackerStdoutReader = null

    this.killProcess(this.trackerProcess)
    this.trackerProcess = null

    stopMotionBridgeServer()
  }

  private attachProcessHandlers(
    kind: 'tracker',
    childProcess: ChildProcessWithoutNullStreams
  ): void {
    // tracker stdout is consumed by the readline interface created in start()

    childProcess.stderr.on('data', (data: Buffer) => {
      const message = truncateStatusMessage(data.toString('utf8'))
      if (!message) {
        return
      }

      this.status = {
        ...this.status,
        lastMessage: `${kind === 'tracker' ? 'Native tracker' : 'Motion bridge'}: ${message}`
      }
    })

    childProcess.once('error', (error) => {
      if (kind === 'tracker') {
        this.clearNoFrameStartupTimer()
        this.status = {
          ...this.status,
          nativeTrackerStatus: 'error',
          startupWarning: 'none',
          lastError: truncateStatusMessage(describeTrackerSpawnError(error))
        }
        this.terminateBridgeAfterTrackerExit()
      }
    })

    childProcess.once('exit', (code, signal) => {
      if (kind === 'tracker' && this.trackerProcess === childProcess) {
        this.trackerProcess = null
        this.clearNoFrameStartupTimer()
        if (!this.isStopping) {
          const trackerExitMessage = `Native tracker stopped unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'}): check stderr output or rebuild and retry.`
          this.status = {
            ...this.status,
            nativeTrackerStatus: code === 0 ? 'exited' : 'error',
            startupWarning: 'none',
            lastMessage: 'Native tracker stopped unexpectedly. Stopping the MotionFrame bridge.',
            lastError: trackerExitMessage
          }
          this.terminateBridgeAfterTrackerExit()
        }
      }
    })
  }

  private armNoFrameStartupTimer(): void {
    this.clearNoFrameStartupTimer()
    this.hasReceivedMotionFrameSinceStart = false
    this.noFrameStartupTimer = setTimeout(() => {
      this.noFrameStartupTimer = null
      if (this.hasReceivedMotionFrameSinceStart || this.isStopping) {
        return
      }
      if (!isActiveStatus(this.status.nativeTrackerStatus)) {
        return
      }
      this.status = {
        ...this.status,
        startupWarning: 'no_frame_timeout',
        lastMessage: NO_FRAME_STARTUP_WARNING_MESSAGE
      }
    }, NO_FRAME_STARTUP_TIMEOUT_MS)
  }

  private clearNoFrameStartupTimer(): void {
    if (this.noFrameStartupTimer !== null) {
      clearTimeout(this.noFrameStartupTimer)
      this.noFrameStartupTimer = null
    }
  }

  private handleValidMotionFrameReceived(): void {
    if (this.hasReceivedMotionFrameSinceStart) {
      return
    }
    this.hasReceivedMotionFrameSinceStart = true
    this.clearNoFrameStartupTimer()
    if (this.status.startupWarning !== 'none') {
      this.status = { ...this.status, startupWarning: 'none' }
    }
  }

  private terminateBridgeAfterTrackerExit(): void {
    if (this.isStopping) {
      return
    }

    this.trackerStdoutReader?.close()
    this.trackerStdoutReader = null

    this.status = {
      ...this.status,
      motionBridgeStatus: 'stopping',
      lastMessage: 'Native tracker stopped unexpectedly. Stopping the MotionFrame bridge.'
    }

    stopMotionBridgeServer()

    if (!this.isStopping) {
      this.status = {
        ...this.status,
        motionBridgeStatus: 'exited'
      }
    }
  }

  private async terminateProcess(
    childProcess: ChildProcessWithoutNullStreams | null
  ): Promise<void> {
    if (!childProcess || hasExited(childProcess)) {
      return
    }

    await new Promise<void>((resolvePromise) => {
      let settled = false

      const settle = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        childProcess.removeListener('exit', settle)
        resolvePromise()
      }

      const timeout = setTimeout(() => {
        this.killProcess(childProcess, 'SIGKILL')
        settle()
      }, FORCE_KILL_TIMEOUT_MS)

      childProcess.on('exit', settle)

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
