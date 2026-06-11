export type PreviewMode = "default" | "obs";

const OBS_MODE_VALUE = "obs";

export function getPreviewModeFromSearch(search: string): PreviewMode {
  const mode = new URLSearchParams(search).get("mode");

  return mode === OBS_MODE_VALUE ? "obs" : "default";
}
