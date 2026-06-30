export type PreviewDebugMode = "motion" | null;

const MOTION_DEBUG_VALUE = "motion";

export function getPreviewDebugModeFromSearch(
  search: string,
): PreviewDebugMode {
  const debugMode = new URLSearchParams(search).get("debug");

  return debugMode === MOTION_DEBUG_VALUE ? "motion" : null;
}
