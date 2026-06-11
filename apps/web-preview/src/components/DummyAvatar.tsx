import type { AvatarMotionState } from "../motion/mapMotionFrameToAvatar";

type DummyAvatarProps = {
  motion: AvatarMotionState;
};

export function DummyAvatar({ motion }: DummyAvatarProps) {
  const leftEyeHeight = 0.04 + motion.eyeOpen.left * 0.12;
  const rightEyeHeight = 0.04 + motion.eyeOpen.right * 0.12;
  const gazeX = motion.gaze[0] * 0.08;
  const gazeY = motion.gaze[1] * 0.05;
  const mouthWidth = 0.28 + motion.mouth.smile * 0.3;
  const mouthHeight = 0.05 + motion.mouth.open * 0.22;

  return (
    <group position={motion.rootPosition}>
      <mesh position={[0, -1.15, 0]} scale={[0.9, 1.35, 0.45]}>
        <boxGeometry />
        <meshNormalMaterial />
      </mesh>
      <group rotation={motion.headRotation}>
        <mesh position={[0, 0.25, 0]} scale={[0.95, 1.05, 0.9]}>
          <sphereGeometry args={[0.75, 32, 32]} />
          <meshNormalMaterial />
        </mesh>
        <mesh
          position={[-0.27, 0.35, 0.68]}
          scale={[0.14, leftEyeHeight, 0.04]}
        >
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial />
        </mesh>
        <mesh
          position={[0.27, 0.35, 0.68]}
          scale={[0.14, rightEyeHeight, 0.04]}
        >
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial />
        </mesh>
        <mesh
          position={[-0.27 + gazeX, 0.35 + gazeY, 0.73]}
          scale={[0.045, 0.045, 0.02]}
        >
          <sphereGeometry args={[1, 12, 12]} />
          <meshNormalMaterial />
        </mesh>
        <mesh
          position={[0.27 + gazeX, 0.35 + gazeY, 0.73]}
          scale={[0.045, 0.045, 0.02]}
        >
          <sphereGeometry args={[1, 12, 12]} />
          <meshNormalMaterial />
        </mesh>
        <mesh
          position={[0, -0.12, 0.72]}
          scale={[mouthWidth, mouthHeight, 0.04]}
        >
          <boxGeometry />
          <meshNormalMaterial />
        </mesh>
      </group>
    </group>
  );
}
