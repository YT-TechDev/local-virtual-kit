import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useState } from "react";
import { createDummyMotionFrame, type MotionFrame } from "@lvk/motion-protocol";
import { DummyAvatar } from "./DummyAvatar";
import {
  useNativeMotionFrame,
  type NativeMotionConnectionStatus,
} from "../hooks/useNativeMotionFrame";
import {
  createNeutralAvatarMotionState,
  lerpAvatarMotionState,
  mapMotionFrameToAvatar,
  type AvatarMotionState,
} from "../motion/mapMotionFrameToAvatar";
import type { PreviewMode } from "../preview/previewMode";
import type { PreviewSource } from "../preview/previewSource";

type AvatarPreviewProps = {
  mode: PreviewMode;
  source: PreviewSource;
};

type AvatarSceneProps = {
  nativeFrame: MotionFrame | null;
  source: PreviewSource;
};

const LOST_TRACKING_HOLD_MS = 300;
const LOST_TRACKING_RETURN_TO_NEUTRAL_AMOUNT = 0.12;
const LOST_TRACKING_FEATURE_RESET_AMOUNT = 0.35;

type TrackingFallbackState = {
  lastTrackingMotion: AvatarMotionState | null;
  lastTrackingTimestampMs: number | null;
  lostFallbackMotion: AvatarMotionState | null;
  renderedMotion: AvatarMotionState;
};

const createInitialTrackingFallbackState = (): TrackingFallbackState => {
  return {
    lastTrackingMotion: null,
    lastTrackingTimestampMs: null,
    lostFallbackMotion: null,
    renderedMotion: createNeutralAvatarMotionState("not_started"),
  };
};

function getAvatarPreviewLabel(source: PreviewSource) {
  return source === "native"
    ? "Native MotionFrame avatar preview"
    : "Dummy MotionFrame avatar preview";
}

type StatusIndicatorVariant = "active" | "waiting" | "inactive";

function getNativeStatusIndicatorVariant(
  status: NativeMotionConnectionStatus,
): StatusIndicatorVariant | null {
  switch (status) {
    case "connected":
      return "active";
    case "connecting":
    case "connected_waiting_for_frame":
      return "waiting";
    case "reconnecting":
    case "fallback":
      return "inactive";
    case "disabled":
      return null;
  }
}

function getNativeStatusText(status: NativeMotionConnectionStatus) {
  switch (status) {
    case "disabled":
      return "Disabled";
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "connected_waiting_for_frame":
      return "Connected · Waiting for frames";
    case "reconnecting":
      return "Reconnecting";
    case "fallback":
      return "No frames · Bridge open";
  }
}

function getNativeStatusHelper(status: NativeMotionConnectionStatus) {
  switch (status) {
    case "connected":
      return "Connected to localhost and receiving valid native MotionFrames.";
    case "connected_waiting_for_frame":
      return "Connected to localhost, but no valid native frames have arrived yet; fallback preview remains safe.";
    case "connecting":
      return "Opening localhost MotionFrame connection; fallback preview remains safe.";
    case "reconnecting":
      return "Native connection was interrupted; retrying with safe fallback behavior.";
    case "fallback":
      return "Bridge WebSocket is open but no valid frames arrived in the last 1.8s; showing static fallback avatar until frames resume.";
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

function AvatarScene({ nativeFrame, source }: AvatarSceneProps) {
  const [fallbackState, setFallbackState] = useState(
    createInitialTrackingFallbackState,
  );
  const stableNativeFallbackFrame = useMemo(
    () => createDummyMotionFrame(0),
    [],
  );

  useFrame(({ clock }) => {
    const timestampMs = clock.elapsedTime * 1000;
    const frame =
      source === "native"
        ? (nativeFrame ?? stableNativeFallbackFrame)
        : createDummyMotionFrame(timestampMs);
    const mappedMotion = mapMotionFrameToAvatar(frame);

    setFallbackState((previousState) => {
      if (mappedMotion.trackingStatus === "tracking") {
        return {
          lastTrackingMotion: mappedMotion,
          lastTrackingTimestampMs: timestampMs,
          lostFallbackMotion: mappedMotion,
          renderedMotion: mappedMotion,
        };
      }

      if (mappedMotion.trackingStatus === "lost") {
        const neutralLostMotion = createNeutralAvatarMotionState("lost");
        const lastTrackingMotion = previousState.lastTrackingMotion;
        const lastTrackingTimestampMs = previousState.lastTrackingTimestampMs;
        const hasRecentTrackingPose =
          lastTrackingMotion !== null &&
          lastTrackingTimestampMs !== null &&
          timestampMs - lastTrackingTimestampMs <= LOST_TRACKING_HOLD_MS;

        const renderedMotion = hasRecentTrackingPose
          ? lerpAvatarMotionState(
              lastTrackingMotion,
              neutralLostMotion,
              LOST_TRACKING_FEATURE_RESET_AMOUNT,
            )
          : lerpAvatarMotionState(
              previousState.lostFallbackMotion ?? neutralLostMotion,
              neutralLostMotion,
              LOST_TRACKING_RETURN_TO_NEUTRAL_AMOUNT,
            );

        return {
          ...previousState,
          lostFallbackMotion: renderedMotion,
          renderedMotion,
        };
      }

      return {
        lastTrackingMotion: previousState.lastTrackingMotion,
        lastTrackingTimestampMs: previousState.lastTrackingTimestampMs,
        lostFallbackMotion: null,
        renderedMotion: createNeutralAvatarMotionState("not_started"),
      };
    });
  });

  return (
    <>
      <ambientLight intensity={0.8} />
      <pointLight position={[3, 3, 4]} intensity={2} />
      <DummyAvatar motion={fallbackState.renderedMotion} />
    </>
  );
}

export function AvatarPreview({ mode, source }: AvatarPreviewProps) {
  const { latestFrame: nativeFrame, connectionStatus: nativeStatus } =
    useNativeMotionFrame(source === "native");
  const isObsMode = mode === "obs";
  const avatarPreviewLabel = getAvatarPreviewLabel(source);
  const sourceBadgeContent = getSourceBadgeContent(source, nativeStatus);
  const nativeIndicatorVariant =
    source === "native" ? getNativeStatusIndicatorVariant(nativeStatus) : null;
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
            {nativeIndicatorVariant !== null && (
              <span
                className={`preview-source-badge__indicator preview-source-badge__indicator--${nativeIndicatorVariant}`}
                aria-hidden="true"
              />
            )}
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
          <AvatarScene nativeFrame={nativeFrame} source={source} />
        </Canvas>
      </section>
    </main>
  );
}
