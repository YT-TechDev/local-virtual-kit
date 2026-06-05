import { createDummyMotionFrame } from '@lvk/motion-protocol'

export function useDummyMotionFrame() {
  return createDummyMotionFrame(performance.now())
}
