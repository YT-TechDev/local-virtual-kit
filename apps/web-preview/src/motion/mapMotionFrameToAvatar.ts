import type{MotionFrame}from'@lvk/motion-protocol'
export const mapMotionFrameToAvatar=(f:MotionFrame)=>({p:[f.face.position.x,f.face.position.y,0]as const,r:[f.face.rotation.pitch,f.face.rotation.yaw,f.face.rotation.roll]as const,e:[f.eyes.leftOpen,f.eyes.rightOpen]as const,g:[f.eyes.gaze.x,f.eyes.gaze.y]as const,m:[f.mouth.open,f.mouth.smile]as const})
