import type { MotionFrame } from '@lvk/motion-protocol'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function mapMotionFrameToAvatar(frame: MotionFrame) {
  return {
    position: [frame.face.position.x * 1.2, frame.face.position.y * 0.8, 0] as const,
    headRotation: [frame.face.rotation.pitch * 0.7, frame.face.rotation