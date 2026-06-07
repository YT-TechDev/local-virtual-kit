import { createDummyMotionFrame, type MotionFrame } from '@lvk/motion-protocol'
import type { PreviewSource } from '../preview/previewSource'

export function usePreviewMotionFrame(source: PreviewSource, timestampMs: number): MotionFrame {
  switch (source) {
    case 'native':
      return createDummyMotionFrame(timestampMs)
    case 'dummy':
      return createDummyMotionFrame(timestampMs)
  }
}
