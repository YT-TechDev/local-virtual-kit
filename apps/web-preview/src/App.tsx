import { useEffect } from "react";
import "./App.css";
import { AvatarPreview } from "./components/AvatarPreview";
import { getPreviewDebugModeFromSearch } from "./preview/previewDebug";
import { getPreviewModeFromSearch } from "./preview/previewMode";
import { getPreviewSourceFromSearch } from "./preview/previewSource";

function App() {
  const previewMode = getPreviewModeFromSearch(window.location.search);
  const previewSource = getPreviewSourceFromSearch(window.location.search);
  const previewDebugMode = getPreviewDebugModeFromSearch(
    window.location.search,
  );

  useEffect(() => {
    document.documentElement.dataset.previewMode = previewMode;

    return () => {
      delete document.documentElement.dataset.previewMode;
    };
  }, [previewMode]);

  return (
    <AvatarPreview
      debugMode={previewDebugMode}
      mode={previewMode}
      source={previewSource}
    />
  );
}

export default App;
