import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { DummyAvatar } from "./DummyAvatar";
import { usePreviewMotionFrame } from "../hooks/usePreviewMotionFrame";
import type { NativeMotionConnectionStatus } from "../hooks/useNativeMotionFrame";
import { mapMotionFrameToAvatar } from "../motion/mapMotionFrameToAvatar";
import type { PreviewMode } from "../preview/previewMode";
import type { PreviewSource } from "../preview/previewSource";

type AvatarPreviewProps = {
  mode: PreviewMode;
  source: PreviewSource;
};

type AvatarSceneProps = {
  source: PreviewSource;
  onNativeStatusChange: (status: NativeMotionConnectionStatus) => void;
};

function getAvatarPreviewLabel(source: PreviewSource) {
  return source === "native"
    ? "Native MotionFrame avatar preview"
    : "Dummy MotionFrame avatar preview";
}

function getNativeStatusText(status: NativeMotionConnectionStatus) {
  switch (status) {
    case "disabled":
      return "Disabled";
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "reconnecting":
      return "Reconnecting";
    case "fallback":
      return "Fallback";
  }
}

function getNativeStatusHelper(status: NativeMotionConnectionStatus) {
  switch (status) {
    case "connected":
      return "Receiving native MotionFrame data from localhost.";
    case "connecting":
      return "Opening localhost MotionFrame connection; fallback preview remains safe.";
    case "reconnecting":
      return "Native connection was interrupted; retrying with safe fallback behavior.";
    case "fallback":
      return "Connected to localhost, but no valid native frames have arrived yet; using fallback preview data.";
    case "disabled":
      return "Native MotionFrame input is disabled for the current preview source.";
  }
}

function getSourceBadgeContent(
  source: PreviewSource,
  nativeStatus: NativeMotionConnectionStatus,
) {
  if (source === "native") {
    return {
      label: `Source: Native localhost · ${getNativeStatusText(nativeStatus)}`,
      helper: getNativeStatusHelper(nativeStatus),
    };
  }

  return {
    label: "Source: Dummy MotionFrame",
    helper: null,
  };
}

function AvatarScene({ source, onNativeStatusChange }: AvatarSceneProps) {
  const [timestampMs, setTimestampMs] = useState(0);

  useFrame(({ clock }) => {
    setTimestampMs(clock.elapsedTime * 1000);
  });

  const { frame, nativeStatus } = usePreviewMotionFrame(source, timestampMs);
  const motion = mapMotionFrameToAvatar(frame);

  useEffect(() => {
    onNativeStatusChange(nativeStatus);
  }, [nativeStatus, onNativeStatusChange]);

  return (
    <>
      <ambientLight intensity={0.8} />
      <pointLight position={[3, 3, 4]} intensity={2} />
      <DummyAvatar motion={motion} />
    </>
  );
}

export function AvatarPreview({ mode, source }: AvatarPreviewProps) {
  const [nativeStatus, setNativeStatus] =
    useState<NativeMotionConnectionStatus>("disabled");
  const isObsMode = mode === "obs";
  const avatarPreviewLabel = getAvatarPreviewLabel(source);
  const sourceBadgeContent = getSourceBadgeContent(source, nativeStatus);
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
      <section className={panelClassName} aria-label={avatarPreviewLabel}>
        <Canvas
          camera={{ position: [0, 0, 5], fov: 45 }}
          gl={{ alpha: isObsMode }}
        >
          <AvatarScene source={source} onNativeStatusChange={setNativeStatus} />
        </Canvas>
      </section>
    </main>
  );
}
