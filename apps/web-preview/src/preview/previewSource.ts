export type PreviewSource = "dummy" | "native";

export function getPreviewSourceFromSearch(search: string): PreviewSource {
  return new URLSearchParams(search).get("source") === "native"
    ? "native"
    : "dummy";
}
