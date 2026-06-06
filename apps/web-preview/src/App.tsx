import './App.css'
import { AvatarPreview } from './components/AvatarPreview'
import { getPreviewModeFromSearch } from './preview/previewMode'

function App() {
  const previewMode = getPreviewModeFromSearch(window.location.search)

  return <AvatarPreview mode={previewMode} />
}

export default App
