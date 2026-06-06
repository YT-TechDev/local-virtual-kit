import'./App.css'
import{AvatarPreview}from'./components/AvatarPreview'
import{getPreviewModeFromSearch as m}from'./preview/previewMode'
import{getPreviewSourceFromSearch as s}from'./preview/previewSource'
export default function App(){const q=location.search,mode=m(q),source=s(q);document.documentElement.dataset.previewMode=mode;return <AvatarPreview mode={mode} source={source}/>}
