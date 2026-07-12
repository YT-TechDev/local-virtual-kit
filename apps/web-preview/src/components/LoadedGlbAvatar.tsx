import type * as THREE from "three";
import type { AvatarMotionState } from "../motion/mapMotionFrameToAvatar";

type LoadedGlbAvatarProps = {
  motion: AvatarMotionState;
  scene: THREE.Group;
  uniformScale: number;
  verticalOffset: number;
  yawRadians: number;
};

export function LoadedGlbAvatar({
  motion,
  scene,
  uniformScale,
  verticalOffset,
  yawRadians,
}: LoadedGlbAvatarProps) {
  return (
    <group position={motion.rootPosition} dispose={null}>
      <group
        position={[0, verticalOffset, 0]}
        rotation={[0, yawRadians, 0]}
        dispose={null}
      >
        <group rotation={motion.headRotation} dispose={null}>
          <group scale={uniformScale} dispose={null}>
            <primitive object={scene} dispose={null} />
          </group>
        </group>
      </group>
    </group>
  );
}
