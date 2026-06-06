import{Canvas}from'@react-three/fiber'
import type{ReactNode}from'react'
type P={obs:boolean;children:ReactNode}
export function PreviewCanvas(p:P){return <Canvas camera={{position:[0,0,5],fov:45}} gl={{alpha:p.obs}}>{p.children}</Canvas>}
