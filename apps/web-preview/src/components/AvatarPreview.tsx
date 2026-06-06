import{Canvas}from'@react-three/fiber'
import{AvatarScene as S}from'./AvatarScene'
type P={mode:'default'|'obs';source:'dummy'|'native'}
export function AvatarPreview({mode,source}:P){return <main className={`preview-shell preview-shell--${mode}`}><section className={`preview-panel preview-panel--${mode}`}><Canvas><S source={source}/></Canvas></section></