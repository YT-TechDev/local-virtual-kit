import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { createDummyMotionFrame, type MotionFrame } from "@lvk/motion-protocol";
import { DummyAvatar } from "./DummyAvatar";
import {
  NATIVE_FRAME_STALE_TIMEOUT_MS,
  NATIVE_MOTION_WS_URL,
  RECONNECT_DELAY_MS,
  useNativeMotionFrame,
  type NativeMotionConnectionStatus,
} from "../hooks/useNativeMotionFrame";
import {
  applyRendererIdleApproximation,
  createNeutralAvatarMotionState,
  lerpAvatarMotionState,
  mapMotionFrameToAvatar,
  type AvatarMotionState,
} from "../motion/mapMotionFrameToAvatar";
import type { PreviewDebugMode } from "../preview/previewDebug";
import type { PreviewMode } from "../preview/previewMode";
import type { PreviewSource } from "../preview/previewSource";

type AvatarPreviewProps = {
  debugMode: PreviewDebugMode;
  mode: PreviewMode;
  source: PreviewSource;
};

type AvatarSceneProps = {
  nativeFrame: MotionFrame | null;
  source: PreviewSource;
};

type MotionDebugOverlayProps = {
  connectionStatus: NativeMotionConnectionStatus;
  currentTimeMs: number;
  frame: MotionFrame | null;
  lastFrameReceivedAtMs: number | null;
  receivedFrameCount: number;
  source: PreviewSource;
};

const LOST_TRACKING_HOLD_MS = 300;
const LOST_TRACKING_RETURN_TO_NEUTRAL_AMOUNT = 0.12;
const LOST_TRACKING_FEATURE_RESET_AMOUNT = 0.35;

const clampMotionDebugMarker = (value: number) => {
  return Math.min(1, Math.max(-1, value));
};

const formatMotionDebugNumber = (value: number) => value.toFixed(4);

const getMotionDebugFrameAgeText = (
  lastFrameReceivedAtMs: number | null,
  currentTimeMs: number,
) => {
  if (lastFrameReceivedAtMs === null) {
    return "no frame yet";
  }

  const elapsedMs = Math.max(0, currentTimeMs - lastFrameReceivedAtMs);

  return `${elapsedMs.toFixed(0)} ms`;
};

function MotionDebugOverlay({
  connectionStatus,
  currentTimeMs,
  frame,
  lastFrameReceivedAtMs,
  receivedFrameCount,
  source,
}: MotionDebugOverlayProps) {
  const position = frame?.face.position ?? null;
  const markerXPercent =
    ((position === null ? 0 : clampMotionDebugMarker(position.x)) + 1) * 50;
  const markerYPercent =
    (1 - (position === null ? 0 : clampMotionDebugMarker(position.y))) * 50;

  return (
    <aside
      className="motion-debug-overlay"
      aria-label="MotionFrame debug values"
    >
      <div className="motion-debug-overlay__title">MotionFrame debug</div>
      <dl className="motion-debug-overlay__values">
        <div>
          <dt>source</dt>
          <dd>{frame?.source ?? source}</dd>
        </div>
        <div>
          <dt>connection</dt>
          <dd>{connectionStatus}</dd>
        </div>
        <div>
          <dt>frames received</dt>
          <dd>{receivedFrameCount}</dd>
        </div>
        <div>
          <dt>tracking.status</dt>
          <dd>{frame?.tracking.status ?? "no_frame"}</dd>
        </div>
        <div>
          <dt>tracking.confidence</dt>
          <dd>
            {frame === null
              ? "—"
              : formatMotionDebugNumber(frame.tracking.confidence)}
          </dd>
        </div>
        <div>
          <dt>face.position.x</dt>
          <dd>
            {position === null ? "—" : formatMotionDebugNumber(position.x)}
          </dd>
        </div>
        <div>
          <dt>face.position.y</dt>
          <dd>
            {position === null ? "—" : formatMotionDebugNumber(position.y)}
          </dd>
        </div>
        <div>
          <dt>face.position.z</dt>
          <dd>
            {position === null ? "—" : formatMotionDebugNumber(position.z)}
          </dd>
        </div>
        <div>
          <dt>latest frame age</dt>
          <dd>
            {getMotionDebugFrameAgeText(lastFrameReceivedAtMs, currentTimeMs)}
          </dd>
        </div>
      </dl>
      <div className="motion-debug-overlay__marker-box" aria-hidden="true">
        <span className="motion-debug-overlay__axis motion-debug-overlay__axis--x" />
        <span className="motion-debug-overlay__axis motion-debug-overlay__axis--y" />
        <span
          className="motion-debug-overlay__marker"
          style={{ left: `${markerXPercent}%`, top: `${markerYPercent}%` }}
        />
      </div>
    </aside>
  );
}

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

// Local-first reassurance shown in the badge for every non-OBS preview: the Web
// Preview only ever consumes MotionFrame data locally and never receives or sends
// camera frames. Purely presentational; it asserts no protocol or runtime change.
const PREVIEW_LOCAL_PRIVACY_NOTE =
  "Local preview only · No camera frames leave this device.";
const NATIVE_FRAME_STALE_TIMEOUT_SECONDS = NATIVE_FRAME_STALE_TIMEOUT_MS / 1000;
const RECONNECT_DELAY_SECONDS = RECONNECT_DELAY_MS / 1000;
const ENDPOINT_COPY_SUCCESS_TEXT = "Endpoint copied";
const ENDPOINT_COPY_FAILURE_TEXT = "Copy failed";
const ENDPOINT_COPY_FEEDBACK_CLEAR_DELAY_MS = 2000;
const NATIVE_FRAME_AGE_REFRESH_INTERVAL_MS = 500;
const ENDPOINT_COPY_FEEDBACK_ID = "web-preview-endpoint-copy-feedback";
const SOURCE_BADGE_ENDPOINT_NOTE_ID = "web-preview-native-endpoint-note";

type EndpointCopyFeedbackState = {
  message: string;
  endpointNote: string | null;
} | null;

function getAvatarPreviewLabel(source: PreviewSource) {
  return source === "native"
    ? "Native MotionFrame avatar preview"
    : "Local demo MotionFrame avatar preview";
}

type StatusIndicatorVariant = "active" | "waiting" | "inactive" | "demo";

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

function getBadgeIndicatorVariant(
  source: PreviewSource,
  status: NativeMotionConnectionStatus,
): StatusIndicatorVariant | null {
  // The local demo source is always a deterministic, local-only preview, so it
  // gets its own steady "demo" indicator rather than a native connection state.
  if (source !== "native") {
    return "demo";
  }

  return getNativeStatusIndicatorVariant(status);
}

function getNativeStatusText(status: NativeMotionConnectionStatus) {
  switch (status) {
    case "disabled":
      return "Disabled";
    case "connecting":
      return "Connecting to bridge";
    case "connected":
      return "Receiving native frames";
    case "connected_waiting_for_frame":
      return "Bridge open · Waiting for first frame";
    case "reconnecting":
      return "Bridge disconnected · Retrying";
    case "fallback":
      return "Bridge open · No recent frames";
  }
}

function getNativeStatusHelper(status: NativeMotionConnectionStatus) {
  switch (status) {
    case "connected":
      return "Connected to localhost and receiving valid native MotionFrames.";
    case "connected_waiting_for_frame":
      return `The localhost bridge accepted the preview connection, but no valid native MotionFrame has arrived yet; the fallback avatar appears after about ${NATIVE_FRAME_STALE_TIMEOUT_SECONDS.toFixed(1)}s if frames do not arrive.`;
    case "connecting":
      return "Opening the localhost MotionFrame bridge connection; the fallback avatar stays visible while waiting.";
    case "reconnecting":
      return `The localhost bridge connection closed or is unavailable; retrying in about ${RECONNECT_DELAY_SECONDS.toFixed(1)}s without changing transport behavior.`;
    case "fallback":
      return `The bridge is still connected, but valid native MotionFrames have paused for about ${NATIVE_FRAME_STALE_TIMEOUT_SECONDS.toFixed(1)}s; showing the fallback avatar until frames resume.`;
    case "disabled":
      return "Native MotionFrame input is disabled for the current preview source.";
  }
}

function getNativeFrameReceivedStatus(
  lastFrameReceivedAtMs: number | null,
  currentTimeMs: number,
) {
  if (lastFrameReceivedAtMs === null) {
    return "Last frame: not yet received";
  }

  const elapsedSeconds = Math.max(
    0,
    (currentTimeMs - lastFrameReceivedAtMs) / 1000,
  );

  return `Last frame: ${elapsedSeconds.toFixed(1)}s ago`;
}

function getSourceBadgeContent(
  source: PreviewSource,
  nativeStatus: NativeMotionConnectionStatus,
  receivedFrameCount: number,
  lastFrameReceivedAtMs: number | null,
  currentTimeMs: number,
) {
  if (source === "native") {
    return {
      label: `Source: Native localhost · ${getNativeStatusText(nativeStatus)}`,
      helper: getNativeStatusHelper(nativeStatus),
      endpointNote: `Local MotionFrame endpoint: ${NATIVE_MOTION_WS_URL}`,
      diagnostics: [
        `Frames received: ${receivedFrameCount}`,
        getNativeFrameReceivedStatus(lastFrameReceivedAtMs, currentTimeMs),
      ],
    };
  }

  return {
    label: "Source: Local demo MotionFrame",
    helper:
      "No native runtime connected — showing a built-in local demo MotionFrame so the preview stays useful offline.",
    diagnostics: null,
    endpointNote: null,
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
        // Cosmetic renderer-side idle approximation only: adds subtle blink /
        // gaze drift / mouth idle for still-neutral channels. It does not
        // represent real eye/mouth/expression tracking and never overrides
        // non-neutral MotionFrame values.
        const idleApproximatedMotion = applyRendererIdleApproximation(
          mappedMotion,
          timestampMs,
        );

        return {
          lastTrackingMotion: idleApproximatedMotion,
          lastTrackingTimestampMs: timestampMs,
          lostFallbackMotion: idleApproximatedMotion,
          renderedMotion: idleApproximatedMotion,
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

export function AvatarPreview({ debugMode, mode, source }: AvatarPreviewProps) {
  const {
    latestFrame: nativeFrame,
    connectionStatus: nativeStatus,
    receivedFrameCount,
    lastFrameReceivedAtMs,
  } = useNativeMotionFrame(source === "native");
  const isObsMode = mode === "obs";
  const [nativeFrameAgeCurrentTimeMs, setNativeFrameAgeCurrentTimeMs] =
    useState(() => Date.now());
  const avatarPreviewLabel = getAvatarPreviewLabel(source);
  const sourceBadgeContent = getSourceBadgeContent(
    source,
    nativeStatus,
    receivedFrameCount,
    lastFrameReceivedAtMs,
    nativeFrameAgeCurrentTimeMs,
  );
  const badgeIndicatorVariant = getBadgeIndicatorVariant(source, nativeStatus);
  const shellClassName = `preview-shell preview-shell--${mode}`;
  const panelClassName = `preview-panel preview-panel--${mode}`;
  const [endpointCopyFeedback, setEndpointCopyFeedback] =
    useState<EndpointCopyFeedbackState>(null);
  const currentEndpointCopyFeedback =
    endpointCopyFeedback?.endpointNote === sourceBadgeContent.endpointNote
      ? endpointCopyFeedback.message
      : null;

  useEffect(() => {
    if (source !== "native" || lastFrameReceivedAtMs === null) {
      return undefined;
    }

    const refreshNativeFrameAgeTimer = window.setInterval(() => {
      setNativeFrameAgeCurrentTimeMs(Date.now());
    }, NATIVE_FRAME_AGE_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshNativeFrameAgeTimer);
    };
  }, [lastFrameReceivedAtMs, source]);

  useEffect(() => {
    if (endpointCopyFeedback === null) {
      return undefined;
    }

    const clearFeedbackTimer = window.setTimeout(() => {
      setEndpointCopyFeedback(null);
    }, ENDPOINT_COPY_FEEDBACK_CLEAR_DELAY_MS);

    return () => {
      window.clearTimeout(clearFeedbackTimer);
    };
  }, [endpointCopyFeedback]);

  const handleCopyEndpoint = () => {
    if (navigator.clipboard === undefined) {
      setEndpointCopyFeedback({
        message: ENDPOINT_COPY_FAILURE_TEXT,
        endpointNote: sourceBadgeContent.endpointNote,
      });
      return;
    }

    navigator.clipboard
      .writeText(NATIVE_MOTION_WS_URL)
      .then(() => {
        setEndpointCopyFeedback({
          message: ENDPOINT_COPY_SUCCESS_TEXT,
          endpointNote: sourceBadgeContent.endpointNote,
        });
      })
      .catch(() => {
        setEndpointCopyFeedback({
          message: ENDPOINT_COPY_FAILURE_TEXT,
          endpointNote: sourceBadgeContent.endpointNote,
        });
      });
  };

  return (
    <main className={shellClassName}>
      {!isObsMode && (
        <aside
          className="preview-source-badge"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label="Preview source status"
          aria-describedby={
            sourceBadgeContent.endpointNote !== null
              ? SOURCE_BADGE_ENDPOINT_NOTE_ID
              : undefined
          }
        >
          <span className="preview-source-badge__label">
            {badgeIndicatorVariant !== null && (
              <span
                className={`preview-source-badge__indicator preview-source-badge__indicator--${badgeIndicatorVariant}`}
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
          {sourceBadgeContent.diagnostics !== null && (
            <span className="preview-source-badge__diagnostics">
              {sourceBadgeContent.diagnostics.map((diagnostic) => (
                <span
                  className="preview-source-badge__diagnostic"
                  key={diagnostic}
                >
                  {diagnostic}
                </span>
              ))}
            </span>
          )}
          {sourceBadgeContent.endpointNote !== null && (
            <span
              className="preview-source-badge__endpoint-row"
              role="group"
              aria-labelledby={SOURCE_BADGE_ENDPOINT_NOTE_ID}
            >
              <span
                id={SOURCE_BADGE_ENDPOINT_NOTE_ID}
                className="preview-source-badge__endpoint"
              >
                {sourceBadgeContent.endpointNote}
              </span>
              <button
                className="preview-source-badge__copy-button"
                type="button"
                onClick={handleCopyEndpoint}
                aria-describedby={
                  currentEndpointCopyFeedback !== null
                    ? ENDPOINT_COPY_FEEDBACK_ID
                    : undefined
                }
              >
                Copy endpoint
              </button>
              {currentEndpointCopyFeedback !== null && (
                <span
                  id={ENDPOINT_COPY_FEEDBACK_ID}
                  className="preview-source-badge__copy-feedback"
                  role="status"
                  aria-live="polite"
                >
                  {currentEndpointCopyFeedback}
                </span>
              )}
            </span>
          )}
          <span className="preview-source-badge__note">
            {PREVIEW_LOCAL_PRIVACY_NOTE}
          </span>
        </aside>
      )}
      {debugMode === "motion" && (
        <MotionDebugOverlay
          connectionStatus={nativeStatus}
          currentTimeMs={nativeFrameAgeCurrentTimeMs}
          frame={nativeFrame}
          lastFrameReceivedAtMs={lastFrameReceivedAtMs}
          receivedFrameCount={receivedFrameCount}
          source={source}
        />
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
