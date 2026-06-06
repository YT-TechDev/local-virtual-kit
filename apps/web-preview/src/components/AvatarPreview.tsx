import{AvatarScene}from'./AvatarScene'
import{PreviewCanvas}from'./PreviewCanvas'
import{PreviewShell}from'./PreviewShell'
type P={mode:'default'|'obs';source:'dummy'|'native'}
export function AvatarPreview(p:P){return <PreviewShell mode={p.mode}><PreviewCanvas obs={p.mode==='obs'}><AvatarScene source={p.source}/></PreviewCanvas></PreviewShell>}
