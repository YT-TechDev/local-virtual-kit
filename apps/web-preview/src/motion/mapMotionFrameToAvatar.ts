import type{MotionFrame}from'@lvk/motion-protocol'
type V3=[number,number,number];type V2=[number,number]
export const mapMotionFrameToAvatar=(f:MotionFrame)=>({p:[f.face.position.x,f.face.position.y,0]as V3,r:[f.face.rotation.pitch,f.face.rotation.yaw,f.face.rotation.roll]as V3,e:[f.eyes.leftOpen,f.eyes.rightOpen]as V2,g:[f.eyes.gaze.x,f.eyes