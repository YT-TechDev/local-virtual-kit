import{useFrame}from'@react-three/fiber'
import{useState}from'react'
export function usePreviewTime(){const[t,s]=useState(0);useFrame(({clock})=>s(clock.elapsedTime*1000));return t}
