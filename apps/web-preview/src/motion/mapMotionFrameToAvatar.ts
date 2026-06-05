import type { MotionFrame } from '@lvk/motion-protocol'

const clamp = (value: number) => Math.max(-1, Math.min(1, value))

export function mapMotionFrameToAvatar(frame: MotionFrame) {
  return {
    position: [clamp(frame.face.position.x), clamp(frame.face.position.y), 0] as [number, number, number],
    rotation: [frame.face.rotation.pitch, frame.face.rotation.yaw, frame.face.rotation.roll] as [number, number, number],
    eyes: [frame.eyes.leftOpen, frame.eyes.rightOpen] as [number, number],
    gaze: [clamp(frame.eyes.gaze.x), clamp(frame.eyes.gaze.y)]