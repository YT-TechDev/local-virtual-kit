import { Canvas, useFrame } from "@react-three/fiber";
import { useState } from "react";
import { DummyAvatar } from "./DummyAvatar";
import { usePreviewMotionFrame } from "../hooks/usePreviewMotionFrame";
import { mapMotionFrameToAvatar } from "../motion/mapMotionFrameToAvatar";
import type { PreviewMode } from "../preview/previewMode";
import type { PreviewSource } from "../preview/previewSource";

type AvatarPreviewProps = {
  mode: PreviewMode;
  source: PreviewSource;
};

type AvatarSceneProps = {
  source: PreviewSource;
};

function getSourceBadgeContent(source: PreviewSource) {
  if (source === "native") {
    return {
      label: "Source: Native localhost",
      helper:
        "Uses localhost MotionFrame input; preview may fall back visually until native frames arrive.",
    };
  }

  return {
    label: "Source: Dummy MotionFrame",
    helper: null,
  };
}

function AvatarScene({ source }: AvatarSceneProps) {
  const [timestampMs, setTimestampMs] = useState(0);

  useFrame(({ clock }) => {
    setTimestampMs(clock.elapsedTime * 1000);
  });

  const frame = usePreviewMotionFrame(source, timestampMs);
  const motion = mapMotionFrameToAvatar(frame);

  return (
    <>
      <ambientLight intensity={0.8} />
      <pointLight position={[3, 3, 4]} intensity={2} />
      <DummyAvatar motion={motion} />
    </>
  );
}

export function AvatarPreview({ mode, source }: AvatarPreviewProps) {
  const isObsMode = mode === "obs";
  const sourceBadgeContent = getSourceBadgeContent(source);
  const shellClassName = `preview-shell preview-shell--${mode}`;
  const panelClassName = `preview-panel preview-panel--${mode}`;

  return (
    <main className={shellClassName}>
      {!isObsMode && (
        <aside
          className="preview-source-badge"
          aria-label="Preview source status"
        >
          <span className="preview-source-badge__label">
            {sourceBadgeContent.label}
          </span>
          {sourceBadgeContent.helper !== null && (
            <span className="preview-source-badge__helper">
              {sourceBadgeContent.helper}
            </span>
          )}
        </aside>
      )}
      <section
        className={panelClassName}
        aria-label="Dummy MotionFrame avatar preview"
      >
        <Canvas
          camera={{ position: [0, 0, 5], fov: 45 }}
          gl={{ alpha: isObsMode }}
        >
          <AvatarScene source={source} />
        </Canvas>
      </section>
    </main>
  );
}
