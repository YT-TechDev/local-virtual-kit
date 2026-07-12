import type * as THREE from "three";
import type { AvatarMotionState } from "../motion/mapMotionFrameToAvatar";

type LoadedGlbAvatarProps = {
  motion: AvatarMotionState;
  scene: THREE.Group;
  uniformScale: number;
};

export function LoadedGlbAvatar({
  motion,
  scene,
  uniformScale,
}: LoadedGlbAvatarProps) {
  return (
    <group position={motion.rootPosition} dispose={null}>
      <group rotation={motion.headRotation} dispose={null}>
        <group scale={uniformScale} dispose={null}>
          <primitive object={scene} dispose={null} />
        </group>
      </group>
    </group>
  );
}
