import type{MotionFrame}from'@lvk/motion-protocol'
export const mapMotionFrameToAvatar=(f:MotionFrame)=>({p:[f.face.position.x,f.face.position.y,0],r:[f.face.rotation.pitch,f.face.rotation.yaw,f.face.rotation.roll],e:[f.eyes.leftOpen,f.eyes.rightOpen],g:[f.eyes.gaze.x,f.eyes.gaze.y],m:[f.mouth.open,f.mouth.smile]})
