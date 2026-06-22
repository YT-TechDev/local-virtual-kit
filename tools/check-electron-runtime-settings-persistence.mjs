#!/usr/bin/env node
// Electron runtime settings persistence smoke checker.
//
// Protects the source-level invariants of the local runtime settings
// save/load/reload flow across renderer, preload, and main process.
// Dependency-free: Node built-ins only.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appRendererPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "renderer",
  "src",
  "App.tsx",
);
const mainIndexPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "main",
  "index.ts",
);
const runtimeSettingsConfigPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "main",
  "runtimeSettingsConfig.ts",
);

const fail = (message) => {
  console.error(
    `Electron runtime settings persistence smoke check failed: ${message}`,
  );
  process.exit(1);
};

const rendererSource = readFileSync(appRendererPath, "utf8");
const mainSource = readFileSync(mainIndexPath, "utf8");
const configSource = readFileSync(runtimeSettingsConfigPath, "utf8");

const requireMatch = (text, pattern, message) => {
  if (!pattern.test(text)) {
    fail(message);
  }
};

// Renderer: settings are loaded from disk on mount via desktopApi.getRuntimeSettings()
requireMatch(
  rendererSource,
  /const\s+settings\s*=\s*normalizeRuntimeSettings\(await\s+desktopApi\.getRuntimeSettings\(\)\)/u,
  "renderer loadRuntimeSettings must call desktopApi.getRuntimeSettings() and normalize the result",
);

// Renderer: all 6 fields are set from the normalized loaded settings
requireMatch(
  rendererSource,
  /setSelectedCameraSource\(settings\.cameraSource\)/u,
  "renderer loadRuntimeSettings must set selectedCameraSource from loaded settings",
);
requireMatch(
  rendererSource,
  /setSelectedFaceDetector\(settings\.faceDetector\)/u,
  "renderer loadRuntimeSettings must set selectedFaceDetector from loaded settings",
);
requireMatch(
  rendererSource,
  /setSelectedCameraIndex\(settings\.cameraIndex\)/u,
  "renderer loadRuntimeSettings must set selectedCameraIndex from loaded settings",
);
requireMatch(
  rendererSource,
  /setSelectedCameraFps\(settings\.cameraFps\)/u,
  "renderer loadRuntimeSettings must set selectedCameraFps from loaded settings",
);
requireMatch(
  rendererSource,
  /setSelectedCameraWidth\(settings\.cameraWidth\)/u,
  "renderer loadRuntimeSettings must set selectedCameraWidth from loaded settings",
);
requireMatch(
  rendererSource,
  /setSelectedCameraHeight\(settings\.cameraHeight\)/u,
  "renderer loadRuntimeSettings must set selectedCameraHeight from loaded settings",
);

// Renderer: settings load is triggered once on mount in useEffect
requireMatch(
  rendererSource,
  /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?void\s+loadRuntimeSettings\(\)[\s\S]*?\},\s*\[desktopApi\]\s*\)/u,
  "renderer must load runtime settings from disk on mount in a useEffect([desktopApi]) hook",
);

// Renderer: save path calls desktopApi.saveRuntimeSettings and normalizes the result
requireMatch(
  rendererSource,
  /const\s+savedSettings\s*=\s*normalizeRuntimeSettings\(await\s+desktopApi\.saveRuntimeSettings\(settings\)\)/u,
  "renderer saveRuntimeSettings must call desktopApi.saveRuntimeSettings(settings) and normalize the result",
);

// Renderer: all 6 fields are updated from the normalized saved settings
requireMatch(
  rendererSource,
  /setSelectedCameraSource\(savedSettings\.cameraSource\)/u,
  "renderer saveRuntimeSettings must update selectedCameraSource from savedSettings",
);
requireMatch(
  rendererSource,
  /setSelectedFaceDetector\(savedSettings\.faceDetector\)/u,
  "renderer saveRuntimeSettings must update selectedFaceDetector from savedSettings",
);
requireMatch(
  rendererSource,
  /setSelectedCameraIndex\(savedSettings\.cameraIndex\)/u,
  "renderer saveRuntimeSettings must update selectedCameraIndex from savedSettings",
);
requireMatch(
  rendererSource,
  /setSelectedCameraFps\(savedSettings\.cameraFps\)/u,
  "renderer saveRuntimeSettings must update selectedCameraFps from savedSettings",
);
requireMatch(
  rendererSource,
  /setSelectedCameraWidth\(savedSettings\.cameraWidth\)/u,
  "renderer saveRuntimeSettings must update selectedCameraWidth from savedSettings",
);
requireMatch(
  rendererSource,
  /setSelectedCameraHeight\(savedSettings\.cameraHeight\)/u,
  "renderer saveRuntimeSettings must update selectedCameraHeight from savedSettings",
);

// Main process: IPC handlers wire getRuntimeSettings and saveRuntimeSettings to config functions
requireMatch(
  mainSource,
  /ipcMain\.handle\(\s*LVK_IPC_CHANNELS\.getRuntimeSettings\s*,\s*\(\)\s*=>\s*loadRuntimeSettings\(\)\s*\)/u,
  "main process must wire lvk:get-runtime-settings IPC channel to loadRuntimeSettings()",
);
requireMatch(
  mainSource,
  /ipcMain\.handle\(\s*LVK_IPC_CHANNELS\.saveRuntimeSettings\s*,\s*\(_event,\s*settings:\s*unknown\)\s*=>\s*\n\s*saveRuntimeSettings\(settings\)\s*\)/u,
  "main process must wire lvk:save-runtime-settings IPC channel to saveRuntimeSettings(settings)",
);

// Config: normalizeDesktopRuntimeSettings returns defaults for non-object/null input
requireMatch(
  configSource,
  /if\s*\(typeof\s+settings\s*!==\s*['"]object['"]\s*\|\|\s*settings\s*===\s*null\s*\|\|\s*Array\.isArray\(settings\)\)\s*\{\s*\n\s*return\s*\{\s*\.\.\.\s*DEFAULT_DESKTOP_RUNTIME_SETTINGS\s*\}/u,
  "normalizeDesktopRuntimeSettings must return DEFAULT_DESKTOP_RUNTIME_SETTINGS for non-object or null input",
);

// Config: loadRuntimeSettings returns defaults on any read/parse error
requireMatch(
  configSource,
  /export\s+async\s+function\s+loadRuntimeSettings[\s\S]*?catch\s*\{[\s\S]*?return\s*\{\s*\.\.\.\s*DEFAULT_DESKTOP_RUNTIME_SETTINGS\s*\}\s*\}/u,
  "loadRuntimeSettings must return a copy of DEFAULT_DESKTOP_RUNTIME_SETTINGS on any file read or parse error",
);

// Config: saveRuntimeSettings normalizes before writing to disk
requireMatch(
  configSource,
  /export\s+async\s+function\s+saveRuntimeSettings[\s\S]*?const\s+normalizedSettings\s*=\s*normalizeDesktopRuntimeSettings\(settings\)[\s\S]*?await\s+writeFile/u,
  "saveRuntimeSettings must normalize settings before writing to disk",
);

// Config: DEFAULT_DESKTOP_RUNTIME_SETTINGS defines all 6 fields
requireMatch(
  configSource,
  /export\s+const\s+DEFAULT_DESKTOP_RUNTIME_SETTINGS:\s*DesktopRuntimeSettings\s*=\s*\{[\s\S]*?cameraSource[\s\S]*?faceDetector[\s\S]*?cameraIndex[\s\S]*?cameraFps[\s\S]*?cameraWidth[\s\S]*?cameraHeight[\s\S]*?\}/u,
  "DEFAULT_DESKTOP_RUNTIME_SETTINGS must define all 6 runtime settings fields",
);

// Config: settings are written to the Electron userData directory
requireMatch(
  configSource,
  /app\.getPath\(['"]userData['"]\)/u,
  "runtime settings must be stored in the Electron app userData directory",
);

console.log(
  "Electron runtime settings persistence smoke OK: " +
    "renderer loads all 6 settings fields from disk on mount via desktopApi.getRuntimeSettings(); " +
    "renderer updates all 6 settings fields from normalized save response via desktopApi.saveRuntimeSettings(); " +
    "main process IPC handlers wire getRuntimeSettings and saveRuntimeSettings to config functions; " +
    "normalizeDesktopRuntimeSettings returns defaults for invalid input; " +
    "loadRuntimeSettings returns defaults on error; " +
    "saveRuntimeSettings normalizes before writing; " +
    "settings are persisted to Electron userData directory.",
);
