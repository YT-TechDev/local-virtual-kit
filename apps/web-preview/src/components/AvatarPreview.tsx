import { Canvas, useFrame } from '@react-three/fiber'
import { useState } from 'react'
import { DummyAvatar } from './DummyAvatar'
import { useDummyMotionFrame } from '../hooks/useDummyMotionFrame'
import { mapMotionFrameToAvatar } from '../motion/mapMotionFrameToAvatar'
import type { PreviewMode } from '../preview/previewMode'

type AvatarPreviewProps = {
  mode: PreviewMode
}

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

export function AvatarPreview({ mode }: AvatarPreviewProps) {
  const isObsMode = mode === 'obs'
  const shellClassName = `preview-shell preview-shell--${mode}`
  const panelClassName = `preview-panel preview-panel--${mode}`

  return (
    <main className={shellClassName}>
      <section className={panelClassName} aria-label="Dummy MotionFrame avatar preview">
        <Canvas camera={{ position: [0, 0, 5], fov: 45 }} gl={{ alpha: isObsMode }}>
          <AvatarScene />
        </Canvas>
      </section>
    </main>
  )
}
