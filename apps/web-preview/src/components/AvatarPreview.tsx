import{Canvas}from'@react-three/fiber'
import{AvatarScene}from'./AvatarScene'
type P={mode:'default'|'obs';source:'dummy'|'native'}
export function AvatarPreview(p:P){return <Canvas><AvatarScene source={p.source}/></Canvas>}
