import type * as THREE from "three";
import type { AvatarMotionState } from "../motion/mapMotionFrameToAvatar";

type LoadedGlbAvatarProps = {
  motion: AvatarMotionState;
  scene: THREE.Group;
};

export function LoadedGlbAvatar({ motion, scene }: LoadedGlbAvatarProps) {
  return (
    <group position={motion.rootPosition} dispose={null}>
      <group rotation={motion.headRotation} dispose={null}>
        <primitive object={scene} dispose={null} />
      </group>
    </group>
  );
}
