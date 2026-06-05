import type { MotionFrame } from '@lvk/motion-protocol'
const c=(v:number)=>Math.max(-1,Math.min(1,v))
export function mapMotionFrameToAvatar(f:MotionFrame){return{p:[c(f.face.position.x),c(f.face.position.y),0],r:[f.face.rotation.pitch,f.face.rotation.yaw,f.face.rotation.roll],e:[f.eyes.leftOpen,f.eyes.rightOpen],g:[c(f.eyes.gaze.x),c(f.eyes.gaze.y)],m:[f.mouth.open,f.m