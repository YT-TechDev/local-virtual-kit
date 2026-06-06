import { Canvas, useFrame } from '@react-three/fiber'
import { useState } from 'react'
import { DummyAvatar } from './DummyAvatar'
import { useDummyMotionFrame } from '../hooks/useDummyMotionFrame'
import { mapMotionFrameToAvatar } from '../motion/mapMotionFrameToAvatar'

function AvatarScene() {
  const [timestampMs, setTimestampMs] = useState(0)

  useFrame(({ clock }) => {
    setTimestampMs(clock.elapsedTime * 1000)
  })

  const frame = useDummyMotionFrame(timestampMs)
  const motion = mapMotionFrameToAvatar(frame)

  return (
    <>
      <ambientLight intensity={0.8} />
      <pointLight position={[3, 3, 4]} intensity={2} />
      <DummyAvatar motion={motion} />
    </>
  )
}

export function AvatarPreview() {
  return (
    <main className="preview-shell">
      <section className="preview-panel" aria-label="Dummy MotionFrame avatar preview">
        <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
          <AvatarScene />
        </Canvas>
      </section>
    </main>
  )
}
