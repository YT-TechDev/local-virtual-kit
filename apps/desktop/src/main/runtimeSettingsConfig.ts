import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DesktopRuntimeSettings } from '../preload/api'

const RUNTIME_SETTINGS_FILE_NAME = 'runtime-settings.json'

export const DEFAULT_DESKTOP_RUNTIME_SETTINGS: DesktopRuntimeSettings = {
  cameraSource: 'dummy',
  faceDetector: 'noop',
  cameraIndex: 0,
  cameraFps: 60,
  cameraWidth: 640,
  cameraHeight: 480
}

function getRuntimeSettingsPath(): string {
  return join(app.getPath('userData'), RUNTIME_SETTINGS_FILE_NAME)
}

function normalizeNumber(
  value: unknown,
  defaultValue: number,
  min: number,
  max: number,
  shouldTruncate: boolean
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultValue
  }

  const normalizedValue = shouldTruncate ? Math.trunc(value) : value
  return Math.min(max, Math.max(min, normalizedValue))
}

export function normalizeDesktopRuntimeSettings(settings: unknown): DesktopRuntimeSettings {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return { ...DEFAULT_DESKTOP_RUNTIME_SETTINGS }
  }

  const { cameraSource, faceDetector, cameraIndex, cameraFps, cameraWidth, cameraHeight } =
    settings as Record<string, unknown>

  return {
    cameraSource:
      cameraSource === 'dummy' || cameraSource === 'opencv'
        ? cameraSource
        : DEFAULT_DESKTOP_RUNTIME_SETTINGS.cameraSource,
    faceDetector:
      faceDetector === 'noop' || faceDetector === 'opencv'
        ? faceDetector
        : DEFAULT_DESKTOP_RUNTIME_SETTINGS.faceDetector,
    cameraIndex: normalizeNumber(
      cameraIndex,
      DEFAULT_DESKTOP_RUNTIME_SETTINGS.cameraIndex,
      0,
      16,
      true
    ),
    cameraFps: normalizeNumber(
      cameraFps,
      DEFAULT_DESKTOP_RUNTIME_SETTINGS.cameraFps,
      1,
      240,
      false
    ),
    cameraWidth: normalizeNumber(
      cameraWidth,
      DEFAULT_DESKTOP_RUNTIME_SETTINGS.cameraWidth,
      1,
      7680,
      true
    ),
    cameraHeight: normalizeNumber(
      cameraHeight,
      DEFAULT_DESKTOP_RUNTIME_SETTINGS.cameraHeight,
      1,
      4320,
      true
    )
  }
}

export async function loadRuntimeSettings(): Promise<DesktopRuntimeSettings> {
  try {
    const settingsJson = await readFile(getRuntimeSettingsPath(), 'utf8')
    return normalizeDesktopRuntimeSettings(JSON.parse(settingsJson))
  } catch {
    return { ...DEFAULT_DESKTOP_RUNTIME_SETTINGS }
  }
}

export async function saveRuntimeSettings(settings: unknown): Promise<DesktopRuntimeSettings> {
  const normalizedSettings = normalizeDesktopRuntimeSettings(settings)
  const settingsPath = getRuntimeSettingsPath()

  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(normalizedSettings, null, 2)}\n`, 'utf8')

  return normalizedSettings
}
