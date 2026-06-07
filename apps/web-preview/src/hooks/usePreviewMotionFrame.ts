import { createDummyMotionFrame, type MotionFrame } from '@lvk/motion-protocol'
import { useNativeMotionFrame } from './useNativeMotionFrame'
import type { PreviewSource } from '../preview/previewSource'

export function usePreviewMotionFrame(source: PreviewSource, timestampMs: number): MotionFrame {
  const nativeFrame = useNativeMotionFrame(source === 'native')

  switch (source) {
    case 'native':
      return nativeFrame ?? createDummyMotionFrame(timestampMs)
    case 'dummy':
      return createDummyMotionFrame(timestampMs)
  }
}
