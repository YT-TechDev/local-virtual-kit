import { createDummyMotionFrame } from '@lvk/motion-protocol'
import { useEffect, useState } from 'react'

export function useDummyMotionFrame() {
  const [frame, setFrame] = useState(() => createDummyMotionFrame(0))

  useEffect(() => {
    let id = 0
    const start = performance.now()
    const tick = (now: number) => {
      setFrame(createDummyMotionFrame(now - start))
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  },