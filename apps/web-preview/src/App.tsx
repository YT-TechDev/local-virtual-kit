import { useEffect } from 'react'
import './App.css'
import { AvatarPreview } from './components/AvatarPreview'
import { getPreviewModeFromSearch } from './preview/previewMode'

function App() {
  const previewMode = getPreviewModeFromSearch(window.location.search)

  useEffect(() => {
    document.documentElement.dataset.previewMode = previewMode

    return () => {
      delete document.documentElement.dataset.previewMode
    }
  }, [previewMode])

  return <AvatarPreview mode={previewMode} />
}

export default App
