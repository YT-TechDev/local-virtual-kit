import { useEffect } from 'react'
import './App.css'
import { AvatarPreview } from './components/AvatarPreview'
import { getPreviewModeFromSearch } from './preview/previewMode'
import { getPreviewSourceFromSearch } from './preview/previewSource'

function App() {
  const previewMode = getPreviewModeFromSearch(window.location.search)
  const previewSource = getPreviewSourceFromSearch(window.location.search)

  useEffect(() => {
    document.documentElement.dataset.previewMode = previewMode

    return () => {
      delete document.documentElement.dataset.previewMode
    }
  }, [previewMode])

  return <AvatarPreview mode={previewMode} source={previewSource} />
}

export default App
