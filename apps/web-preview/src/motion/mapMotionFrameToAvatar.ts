import type { MotionFrame } from '@lvk/motion-protocol'

export type AvatarMotion = {
  position: [number, number, number]
  rotation: [number, number, number]
  eyes: [number, number]
  gaze: [number, number]
  mouth: [number, number]
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function mapMotionFrameTo