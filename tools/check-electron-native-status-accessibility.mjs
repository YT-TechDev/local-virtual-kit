#!/usr/bin/env node
// Electron native runtime status accessibility smoke checker.
//
// Protects the source-level renderer markup for native runtime status/error
// announcements. Dependency-free: Node built-ins only.
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
const appStylesPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "renderer",
  "src",
  "assets",
  "main.css",
);

const fail = (message) => {
  console.error(
    `Electron native status accessibility smoke check failed: ${message}`,
  );
  process.exit(1);
};

const source = readFileSync(appRendererPath, "utf8");
const styles = readFileSync(appStylesPath, "utf8");

const requireMatch = (text, pattern, message) => {
  if (!pattern.test(text)) {
    fail(message);
  }
};

requireMatch(
  source,
  /<strong\s+id=['"]latest-error-label['"]\s+className=['"]status-detail-label['"]>\s*Latest error\s*<\/strong>/u,
  "runtimeStatus.lastError must keep a visible Latest error label",
);
requireMatch(
  source,
  /<strong\s+id=['"]latest-status-label['"]\s+className=['"]status-detail-label['"]>\s*Latest status\s*<\/strong>/u,
  "runtimeStatus.lastMessage must keep a visible Latest status label",
);
requireMatch(
  source,
  /runtimeStatus\.lastError\s*\?\s*\(\s*<p\s+className=['"]error-message compact['"]\s+role=['"]alert['"]\s+aria-labelledby=['"]latest-error-label['"][\s\S]*?\{runtimeStatus\.lastError\}/u,
  'runtimeStatus.lastError must keep role="alert" and aria-labelledby="latest-error-label" linkage',
);
requireMatch(
  source,
  /runtimeStatus\.lastMessage\s*\?\s*\(\s*<p\s+className=['"]runtime-message['"]\s+role=['"]status['"]\s+aria-labelledby=['"]latest-status-label['"][\s\S]*?\{runtimeStatus\.lastMessage\}/u,
  'runtimeStatus.lastMessage must keep role="status" and aria-labelledby="latest-status-label" linkage',
);
requireMatch(
  source,
  /pipelineError\s*\?\s*\(\s*<p\s+className=['"]error-message compact['"]\s+role=['"]alert['"]>\s*\{pipelineError\}/u,
  'pipelineError must keep role="alert" semantics',
);

requireMatch(
  source,
  /type\s+SettingsSaveFeedback\s*=\s*\{[\s\S]*?message:\s*string[\s\S]*?settingsKey:\s*string[\s\S]*?\}/u,
  "SettingsSaveFeedback must keep message and settingsKey fields",
);
requireMatch(
  source,
  /const\s+getRuntimeSettingsKey\s*=\s*\(settings:\s*DesktopRuntimeSettings\):\s*string\s*=>\s*\n\s*JSON\.stringify\(normalizeRuntimeSettings\(settings\)\)/u,
  "getRuntimeSettingsKey must derive a stable key from JSON.stringify(normalizeRuntimeSettings(settings))",
);
requireMatch(
  source,
  /const\s+\[settingsSaveFeedback,\s*setSettingsSaveFeedback\]\s*=\s*useState<SettingsSaveFeedback\s*\|\s*null>\(\s*\n\s*null\s*\n\s*\)/u,
  "settingsSaveFeedback state must keep the SettingsSaveFeedback | null type",
);
requireMatch(
  source,
  /const\s+saveRuntimeSettings\s*=\s*async\s*\(settings:\s*DesktopRuntimeSettings\):\s*Promise<void>\s*=>\s*\{[\s\S]*?if\s*\(!desktopApi\)\s*\{[\s\S]*?return[\s\S]*?\}[\s\S]*?setSettingsSaveFeedback\(null\)[\s\S]*?try\s*\{/u,
  "runtime settings save start must clear settingsSaveFeedback before saving",
);
requireMatch(
  source,
  /setSettingsSaveFeedback\(\{[\s\S]*?message:\s*['"]Settings saved\.['"][\s\S]*?settingsKey:\s*getRuntimeSettingsKey\(savedSettings\)[\s\S]*?\}\)/u,
  "successful runtime settings saves must show Settings saved. and store getRuntimeSettingsKey(savedSettings)",
);
requireMatch(
  source,
  /\}\s*catch\s*\(error\)\s*\{\s*\n\s*setSettingsSaveFeedback\(null\)[\s\S]*?setSettingsError\(\{[\s\S]*?summary:\s*['"]Failed to save runtime settings\.['"]/u,
  "runtime settings save failures must clear settingsSaveFeedback and preserve settingsError behavior",
);
requireMatch(
  source,
  /const\s+currentSettingsSaveFeedback\s*=\s*\n\s*settingsSaveFeedback\?\.settingsKey\s*===\s*currentRuntimeSettingsKey\s*\n\s*\?\s*settingsSaveFeedback\.message\s*\n\s*:\s*null/u,
  "currentSettingsSaveFeedback must render only when the saved settings key matches the current runtime settings key",
);
requireMatch(
  source,
  /currentSettingsSaveFeedback\s*\?\s*\(\s*\n\s*<p\s+className=['"]settings-save-feedback['"]\s+role=['"]status['"]>\s*\n\s*\{currentSettingsSaveFeedback\}/u,
  'runtime settings save success feedback must render with className="settings-save-feedback" and role="status"',
);
requireMatch(
  styles,
  /\.settings-save-feedback\s*\{/u,
  "settings save feedback styles must keep the .settings-save-feedback hook",
);

requireMatch(
  source,
  /type\s+SettingsErrorMessage\s*=\s*\{[\s\S]*?detail:\s*string[\s\S]*?summary:\s*string[\s\S]*?\}/u,
  "SettingsErrorMessage must keep structured summary and detail fields",
);
requireMatch(
  source,
  /const\s+\[settingsError,\s*setSettingsError\]\s*=\s*useState<SettingsErrorMessage\s*\|\s*null>\(null\)/u,
  "settingsError state must keep the SettingsErrorMessage | null type",
);
requireMatch(
  source,
  /setSettingsError\(\{[\s\S]*?detail:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*['"]Failed to load runtime settings\.['"][\s\S]*?summary:\s*['"]Failed to load runtime settings\.['"][\s\S]*?\}\)/u,
  "runtime settings load failures must keep the expected settingsError summary",
);
requireMatch(
  source,
  /setSettingsError\(\{[\s\S]*?detail:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*['"]Failed to save runtime settings\.['"][\s\S]*?summary:\s*['"]Failed to save runtime settings\.['"][\s\S]*?\}\)/u,
  "runtime settings save failures must keep the expected settingsError summary",
);
requireMatch(
  source,
  /settingsError\s*\?\s*\(\s*<p\s+className=['"]error-message settings-error-message['"]\s+role=['"]alert['"]\s+aria-labelledby=['"]runtime-settings-error-label['"][\s\S]*?<strong\s+id=['"]runtime-settings-error-label['"]\s+className=['"]status-detail-label['"]>\s*Settings error\s*<\/strong>[\s\S]*?<span>\{settingsError\.summary\}<\/span>[\s\S]*?<span\s+className=['"]settings-error-detail['"]>\{settingsError\.detail\}<\/span>/u,
  'settingsError must keep className="error-message settings-error-message", role="alert", aria-labelledby linkage, visible Settings error label, summary text, and optional detail styling hook',
);
requireMatch(
  styles,
  /\.settings-error-message\s*\{/u,
  "settings error styles must keep the .settings-error-message hook",
);
requireMatch(
  styles,
  /\.settings-error-message\s+\.settings-error-detail\s*\{/u,
  "settings error detail styles must keep the .settings-error-detail hook",
);

requireMatch(
  source,
  /const\s+buildNativeRuntimeDiagnostics\s*=\s*\([\s\S]*?`Native tracker status:\s*\$\{statusLabels\[status\.nativeTrackerStatus\]\}`[\s\S]*?`Motion bridge status:\s*\$\{bridgeLabels\[status\.motionBridgeStatus\]\}`[\s\S]*?status\.lastMessage\s*\?\s*`Latest status:\s*\$\{status\.lastMessage\}`\s*:\s*null[\s\S]*?status\.lastError\s*\?\s*`Latest error:\s*\$\{status\.lastError\}`\s*:\s*null[\s\S]*?pipelineError\s*\?\s*`Pipeline error:\s*\$\{pipelineError\}`\s*:\s*null[\s\S]*?\]\s*\.filter\(\(line\):\s*line\s+is\s+string\s*=>\s*Boolean\(line\)\)\s*\.join\(['"]\\n['"]\)/u,
  "buildNativeRuntimeDiagnostics must keep expected local-only fields, filter optional lines, and join with newline separators",
);
requireMatch(
  source,
  /const\s+nativeRuntimeDiagnostics\s*=\s*runtimeStatus\s*\?\s*buildNativeRuntimeDiagnostics\(runtimeStatus,\s*pipelineError\)\s*:\s*['"]['"]/u,
  "nativeRuntimeDiagnostics must be built from current runtime status and pipeline error",
);

requireMatch(
  source,
  /<section[\s\S]*?className=['"]card['"][\s\S]*?aria-labelledby=['"]runtime-heading['"][\s\S]*?aria-busy=\{isRuntimeStatusRefreshPending\}[\s\S]*?>[\s\S]*?<h2\s+id=['"]runtime-heading['"]>Source status<\/h2>[\s\S]*?onClick=\{copyMotionEndpoint\}[\s\S]*?onClick=\{refreshRuntimeStatus\}[\s\S]*?onClick=\{copyNativeRuntimeDiagnostics\}/u,
  "native runtime status section must expose aria-busy while status refresh is pending",
);

requireMatch(
  source,
  /<button[\s\S]*?type=['"]button['"][\s\S]*?onClick=\{refreshRuntimeStatus\}[\s\S]*?>\s*Refresh status\s*<\/button>/u,
  "native runtime diagnostics must keep a visible Refresh status button that calls the existing refresh handler",
);
requireMatch(
  source,
  /<button[\s\S]*?type=['"]button['"][\s\S]*?onClick=\{refreshRuntimeStatus\}[\s\S]*?disabled=\{isRuntimeStatusRefreshPending\}[\s\S]*?>/u,
  "native runtime diagnostics Refresh status button must be disabled while a status request is in flight",
);
requireMatch(
  source,
  /<button[\s\S]*?type=['"]button['"][\s\S]*?onClick=\{refreshRuntimeStatus\}[\s\S]*?>\s*Refresh status\s*<\/button>/u,
  "native runtime diagnostics Refresh status button must keep the visible label unchanged",
);
requireMatch(
  source,
  /const\s+refreshRuntimeStatus\s*=\s*async\s*\(\):\s*Promise<void>\s*=>\s*\{[\s\S]*?await\s+loadRuntimeStatus\(\)/u,
  "Refresh status must reuse the existing local runtime status request path",
);
requireMatch(
  source,
  /const\s+refreshRuntimeStatus\s*=\s*async\s*\(\):\s*Promise<void>\s*=>\s*\{[\s\S]*?setRuntimeStatusRefreshMessage\(null\)[\s\S]*?setCopyDiagnosticsMessage\(null\)[\s\S]*?setEndpointCopyFeedback\(null\)[\s\S]*?setIsRuntimeStatusRefreshPending\(true\)[\s\S]*?await\s+loadRuntimeStatus\(\)/u,
  "Refresh status start must clear endpoint copy feedback before requesting runtime status",
);
requireMatch(
  source,
  /<button[\s\S]*?onClick=\{copyNativeRuntimeDiagnostics\}[\s\S]*?>\s*Copy diagnostics\s*<\/button>/u,
  "native runtime diagnostics must keep the visible Copy diagnostics button",
);
requireMatch(
  source,
  /navigator\.clipboard\.writeText\(nativeRuntimeDiagnostics\)/u,
  "native runtime diagnostics copy must use the local browser clipboard API",
);

requireMatch(
  source,
  /<strong\s+id=['"]diagnostics-preview-label['"]\s+className=['"]status-detail-label['"]>\s*Diagnostics preview\s*<\/strong>[\s\S]*?<pre>\s*\{nativeRuntimeDiagnostics\}\s*<\/pre>/u,
  "native runtime diagnostics preview must keep a visible label and show the exact copied diagnostics text",
);
requireMatch(
  source,
  /const\s+lastRuntimeStatusRefreshLabel\s*=\s*lastRuntimeStatusRefreshAt[\s\S]*?lastRuntimeStatusRefreshAt\.toLocaleTimeString\(\)[\s\S]*?:\s*null/u,
  "last refreshed label must be derived locally in the renderer with toLocaleTimeString",
);
requireMatch(
  source,
  /<strong\s+className=['"]status-detail-label['"]>\s*Last refreshed\s*<\/strong>[\s\S]*?<time\s+dateTime=\{lastRuntimeStatusRefreshAt\?\.toISOString\(\)\}>[\s\S]*?\{lastRuntimeStatusRefreshLabel\}[\s\S]*?<\/time>/u,
  "native runtime diagnostics must show a compact Last refreshed timestamp when a local status refresh succeeds",
);

requireMatch(
  source,
  /type\s+RuntimeStatusRefreshMessage\s*=\s*\{[\s\S]*?diagnostics:\s*string[\s\S]*?message:\s*string[\s\S]*?tone:\s*['"]success['"]\s*\|\s*['"]danger['"][\s\S]*?\}/u,
  "runtime status refresh feedback must keep the diagnostics text it corresponds to",
);
requireMatch(
  source,
  /const\s+currentRuntimeStatusRefreshMessage\s*=\s*runtimeStatusRefreshMessage\?\.diagnostics\s*===\s*nativeRuntimeDiagnostics\s*\?\s*runtimeStatusRefreshMessage\s*:\s*null/u,
  "runtime status refresh feedback must clear when nativeRuntimeDiagnostics changes",
);
requireMatch(
  source,
  /className=\{`status-refresh-feedback status-refresh-feedback--\$\{currentRuntimeStatusRefreshMessage\.tone\}`\}[\s\S]*?\{currentRuntimeStatusRefreshMessage\.message\}/u,
  "runtime status refresh feedback must render only the current diagnostics-scoped message",
);

requireMatch(
  source,
  /const\s+currentCopyDiagnosticsMessage\s*=\s*copyDiagnosticsMessage\?\.diagnostics\s*===\s*nativeRuntimeDiagnostics\s*\?\s*copyDiagnosticsMessage\.message\s*:\s*null/u,
  "copy diagnostics feedback must clear when nativeRuntimeDiagnostics changes",
);

requireMatch(
  source,
  /const\s+\[endpointCopyFeedback,\s*setEndpointCopyFeedback\]\s*=\s*useState<string\s*\|\s*null>\(null\)/u,
  "endpointCopyFeedback state must be string | null initialized to null",
);
requireMatch(
  source,
  /const\s+motionEndpoint\s*=\s*runtimeStatus\?\.motionEndpoint\s*\?\?\s*null/u,
  "motionEndpoint dependency must be extracted from runtimeStatus.motionEndpoint with a null fallback",
);
requireMatch(
  source,
  /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?window\.setTimeout\(\s*\(\)\s*=>\s*\{\s*setEndpointCopyFeedback\(null\)\s*\},\s*0\s*\)[\s\S]*?window\.clearTimeout[\s\S]*?\},\s*\[motionEndpoint\]\)/u,
  "endpointCopyFeedback must clear using the extracted motionEndpoint dependency without depending directly on runtimeStatus.motionEndpoint",
);
requireMatch(
  source,
  /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?endpointCopyFeedback\s*===\s*null[\s\S]*?window\.setTimeout[\s\S]*?setEndpointCopyFeedback\(null\)[\s\S]*?window\.clearTimeout/u,
  "endpointCopyFeedback must be cleared by a timer useEffect using window.setTimeout",
);
requireMatch(
  source,
  /const\s+copyMotionEndpoint\s*=\s*async\s*\(\):\s*Promise<void>\s*=>\s*\{[\s\S]*?runtimeStatus\?\.motionEndpoint[\s\S]*?navigator\.clipboard[\s\S]*?setEndpointCopyFeedback\(['"]Copy failed\.['"]\)[\s\S]*?navigator\.clipboard\.writeText\(runtimeStatus\.motionEndpoint\)[\s\S]*?setEndpointCopyFeedback\(['"]Endpoint copied\.['"]\)/u,
  "copyMotionEndpoint must guard on runtimeStatus.motionEndpoint and navigator.clipboard, write via local clipboard API, and set Endpoint copied. on success and Copy failed. on failure",
);
requireMatch(
  source,
  /<button[\s\S]*?type=['"]button['"][\s\S]*?onClick=\{copyMotionEndpoint\}[\s\S]*?disabled=\{isRuntimeStatusRefreshPending\}[\s\S]*?aria-describedby=['"]native-motion-endpoint-copy-feedback['"][\s\S]*?>\s*Copy endpoint\s*<\/button>/u,
  'endpoint copy button must keep type=button, onClick=copyMotionEndpoint, disabled={isRuntimeStatusRefreshPending}, visible Copy endpoint label, and aria-describedby="native-motion-endpoint-copy-feedback"',
);
requireMatch(
  source,
  /endpointCopyFeedback\s*\?\s*\(\s*\n?\s*<span[\s\S]*?id=['"]native-motion-endpoint-copy-feedback['"][\s\S]*?className=['"]endpoint-copy-feedback['"][\s\S]*?role=['"]status['"][\s\S]*?aria-live=['"]polite['"][\s\S]*?>\s*\n?\s*\{endpointCopyFeedback\}/u,
  'endpoint copy feedback must render with id="native-motion-endpoint-copy-feedback", className="endpoint-copy-feedback", role="status", and aria-live="polite"',
);
requireMatch(
  styles,
  /\.endpoint-copy-feedback[\s\S]*?\{/u,
  "endpoint copy feedback styles must keep the .endpoint-copy-feedback hook",
);
requireMatch(
  styles,
  /\.endpoint-dd\s*\{/u,
  "endpoint dd layout must keep the .endpoint-dd hook",
);

console.log(
  "Electron native status accessibility smoke OK: lastError keeps a visible " +
    "Latest error label with alert semantics and aria-labelledby linkage; " +
    "lastMessage keeps a visible Latest status label with status semantics and " +
    "aria-labelledby linkage; pipelineError keeps alert semantics; settingsError keeps structured summary/detail data, load/save summaries, a visible Settings error label, alert semantics, aria-labelledby linkage, and settings-specific CSS hooks; settings save feedback keeps stable normalized settings keys, success status semantics, stale-hide behavior, failure clearing, and CSS hooks; " +
    "refresh status keeps a visible in-flight-disabled local status control and exposes the runtime status section busy state; copy diagnostics keeps a visible local clipboard control and exact local preview; " +
    "diagnostics content keeps expected fields, filters optional lines, " +
    "joins with newlines, writes nativeRuntimeDiagnostics, and resets refresh and copy " +
    "feedback when diagnostics change; last refreshed uses a local renderer timestamp; " +
    "endpoint copy keeps a local clipboard copy button, refresh-pending disabled state, lint-safe endpoint-change stale feedback clearing, refresh-start stale feedback clearing, timer-cleared feedback, and CSS hooks.",
);
