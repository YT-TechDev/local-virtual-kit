import { Canvas, useFrame } from '@react-three/fiber'
import { useState } from 'react'
import { useDummyMotionFrame } from '../hooks/useDummyMotionFrame'
import { mapMotionFrameToAvatar } from '../motion/mapMotionFrameToAvatar'

function Scene() {
  const [, tick] = useState(0)
  useFrame(({ clock }) => tick(clock.elapsedTime))
  const a = mapMotionFrameToAvatar(useDummyMotionFrame())