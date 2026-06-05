import type { MotionFrame } from '@lvk/motion-protocol'
export type AvatarMotion={p:[number,number,number];r:[number,number,number];e:[number,number];g:[number,number];m:[number,number]}
const c=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v))
export const mapMotionFrameToAvatar=(f:MotionFrame):AvatarMotion=>({p:[f.face.position.x,f.face.position.y,0],r:[f.face.rotation.pitch,f.face.rotation.yaw,f.face.rotation.roll],e:[c(f.eyes.leftOpen,.08,1),c(f.eyes.rightOpen,.08,1)],g:[c(f.eyes.gaze.x,-1