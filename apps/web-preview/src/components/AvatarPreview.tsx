import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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
  mapMotionFrameToAvatar,
  type AvatarMotionState,
} from "../motion/mapMotionFrameToAvatar";
import { computeLostTrackingFallbackMotion } from "../motion/lostTrackingFallback";
import {
  FACE_FOLLOWING_PRESETS,
  getFaceFollowingPresetById,
  type FaceFollowingPresetId,
} from "../motion/faceFollowingPresets";
import {
  createFaceFollowingCalibrationFromCenter,
  type FaceFollowingCalibration,
} from "../motion/faceFollowingCalibration";
import type { TrackingSmoothingOptions } from "../motion/trackingSmoothing";
import {
  loadRendererCalibrationState,
  saveRendererCalibrationState,
  type RendererCalibrationState,
} from "../motion/rendererCalibrationStorage";
import {
  canCaptureNativeNeutralPose,
  resolveRendererFaceFollowingCalibration,
} from "../motion/rendererNeutralPose";
import { smoothTrackingMotion } from "../motion/trackingSmoothing";
import type { PreviewDebugMode } from "../preview/previewDebug";
import type { PreviewMode } from "../preview/previewMode";
import type { PreviewSource } from "../preview/previewSource";

type AvatarPreviewProps = {
  debugMode: PreviewDebugMode;
  mode: PreviewMode;
  source: PreviewSource;
};

type AvatarSceneProps = {
  calibration: FaceFollowingCalibration;
  nativeFrame: MotionFrame | null;
  smoothing: TrackingSmoothingOptions;
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
const CALIBRATION_FEEDBACK_CLEAR_DELAY_MS = 4000;
const NATIVE_FRAME_AGE_REFRESH_INTERVAL_MS = 500;
const ENDPOINT_COPY_FEEDBACK_ID = "web-preview-endpoint-copy-feedback";
const SOURCE_BADGE_ENDPOINT_NOTE_ID = "web-preview-native-endpoint-note";
const CALIBRATION_GUIDANCE_ID = "web-preview-calibration-guidance";
const CALIBRATION_FEEDBACK_ID = "web-preview-calibration-feedback";
const CALIBRATION_COPY_ID = "web-preview-calibration-copy";
const RESET_NEUTRAL_NOTE_ID = "web-preview-reset-neutral-note";

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
      return "Opening localhost transport";
    case "connected":
      return "Native MotionFrames live";
    case "connected_waiting_for_frame":
      return "Transport open · Waiting for first native frame";
    case "reconnecting":
      return "Local transport disconnected · Retrying";
    case "fallback":
      return "Native frames stale · Showing fallback";
  }
}

function getNativeStatusHelper(status: NativeMotionConnectionStatus) {
  switch (status) {
    case "connected":
      return "Connected to localhost transport and using incoming native MotionFrames for the avatar.";
    case "connected_waiting_for_frame":
      return `The localhost transport is open, but no valid native MotionFrame has arrived yet; the fallback avatar appears after about ${NATIVE_FRAME_STALE_TIMEOUT_SECONDS.toFixed(1)}s if frames do not arrive, and the preview keeps showing the built-in dummy fallback until frames arrive.`;
    case "connecting":
      return "Opening the localhost MotionFrame transport; the built-in dummy fallback stays visible while waiting.";
    case "reconnecting":
      return `The localhost MotionFrame transport is closed or unavailable; retrying in about ${RECONNECT_DELAY_SECONDS.toFixed(1)}s without changing transport behavior and showing the built-in dummy fallback.`;
    case "fallback":
      return `The localhost transport is still open, but valid native MotionFrames have paused for about ${NATIVE_FRAME_STALE_TIMEOUT_SECONDS.toFixed(1)}s; showing the built-in dummy fallback until native frames resume.`;
    case "disabled":
      return "Native MotionFrame input is disabled for the current preview source.";
  }
}

function getNeutralPoseCaptureGuidance({
  canCapture,
  nativeFrame,
  nativeStatus,
  source,
}: {
  canCapture: boolean;
  nativeFrame: MotionFrame | null;
  nativeStatus: NativeMotionConnectionStatus;
  source: PreviewSource;
}) {
  if (source !== "native") {
    return "Switch to the native source to capture a neutral pose.";
  }

  switch (nativeStatus) {
    case "disabled":
      return "Native MotionFrame input is disabled for the current preview source.";
    case "connecting":
      return "Opening the localhost MotionFrame connection.";
    case "reconnecting":
      return "Reconnecting to the localhost MotionFrame connection.";
    case "connected_waiting_for_frame":
      return "Waiting for the first valid native MotionFrame.";
    case "fallback":
      return "Native frames are stale; waiting for a fresh tracking frame.";
    case "connected":
      break;
  }

  if (nativeFrame === null) {
    return "Connected, but no current native MotionFrame is available.";
  }

  if (nativeFrame.tracking.status === "not_started") {
    return "Native tracking has not started yet.";
  }

  if (nativeFrame.tracking.status === "lost") {
    return "Tracking is currently lost.";
  }

  return canCapture
    ? "Ready to capture the current native tracking pose."
    : "Waiting for a valid native tracking frame.";
}

function getNativeDisplayedMotionStatus(status: NativeMotionConnectionStatus) {
  switch (status) {
    case "connected":
      return "Displayed motion: native MotionFrames";
    case "connected_waiting_for_frame":
      return "Displayed motion: dummy fallback while waiting for native frames";
    case "connecting":
      return "Displayed motion: dummy fallback while opening localhost transport";
    case "reconnecting":
      return "Displayed motion: dummy fallback while reconnecting localhost transport";
    case "fallback":
      return "Displayed motion: dummy fallback because native frames are stale";
    case "disabled":
      return "Displayed motion: dummy source";
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
        getNativeDisplayedMotionStatus(nativeStatus),
        `Frames received: ${receivedFrameCount}`,
        getNativeFrameReceivedStatus(lastFrameReceivedAtMs, currentTimeMs),
      ],
    };
  }

  return {
    label: "Source: Local demo MotionFrame · Dummy mode active",
    helper:
      "Dummy mode is active — no native runtime or localhost transport is required, and the preview uses built-in local demo MotionFrames.",
    diagnostics: null,
    endpointNote: null,
  };
}

function AvatarScene({
  calibration,
  nativeFrame,
  smoothing,
  source,
}: AvatarSceneProps) {
  const [fallbackState, setFallbackState] = useState(
    createInitialTrackingFallbackState,
  );
  const stableNativeFallbackFrame = useMemo(
    () => createDummyMotionFrame(0),
    [],
  );

  useFrame(({ clock }, delta) => {
    const timestampMs = clock.elapsedTime * 1000;
    const frame =
      source === "native"
        ? (nativeFrame ?? stableNativeFallbackFrame)
        : createDummyMotionFrame(timestampMs);
    const mappedMotion = mapMotionFrameToAvatar(frame, calibration);

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

        // Smoothing targets the discrete native OpenCV face-following path. The
        // local demo (dummy) source already produces continuous motion, so it
        // keeps its previous behavior and uses the idle-approximated motion
        // directly. Ease the rendered root/head pose toward the mapped native
        // target so discrete OpenCV face-position updates read as gliding motion
        // instead of angular/blocky stepping. Start from the previous rendered
        // tracking pose; on the first tracking frame there is none, so we snap
        // to the target. Eye/gaze/mouth pass through untouched to keep idle
        // blink crisp.
        const trackingMotion =
          source === "native"
            ? smoothTrackingMotion(
                previousState.lastTrackingMotion ?? idleApproximatedMotion,
                idleApproximatedMotion,
                delta,
                smoothing,
              )
            : idleApproximatedMotion;

        return {
          lastTrackingMotion: trackingMotion,
          lastTrackingTimestampMs: timestampMs,
          lostFallbackMotion: trackingMotion,
          renderedMotion: trackingMotion,
        };
      }

      if (mappedMotion.trackingStatus === "lost") {
        // Stabilize short tracking/lost flicker: hold the last valid root pose
        // during a brief window while features relax toward neutral, then return
        // the root to neutral gradually. See computeLostTrackingFallbackMotion.
        const renderedMotion = computeLostTrackingFallbackMotion({
          lastTrackingMotion: previousState.lastTrackingMotion,
          lastTrackingTimestampMs: previousState.lastTrackingTimestampMs,
          previousLostFallbackMotion: previousState.lostFallbackMotion,
          currentTimestampMs: timestampMs,
        });

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
  const [rendererCalibrationState, setRendererCalibrationState] =
    useState<RendererCalibrationState>(loadRendererCalibrationState);
  const [calibrationRevision, setCalibrationRevision] = useState(0);
  const [calibrationFeedback, setCalibrationFeedback] = useState<string | null>(
    null,
  );
  const selectedPreset = getFaceFollowingPresetById(
    rendererCalibrationState.presetId,
  );
  const effectiveCalibration = useMemo(
    () =>
      resolveRendererFaceFollowingCalibration(
        selectedPreset,
        rendererCalibrationState,
      ),
    [rendererCalibrationState.neutralCenter, selectedPreset],
  );
  const canCaptureNeutralPose = canCaptureNativeNeutralPose({
    nativeFrame,
    nativeStatus,
    source,
  });
  const hasCustomNeutralCenter =
    rendererCalibrationState.neutralCenter !== null;
  const neutralCenterStateLabel = hasCustomNeutralCenter
    ? "Custom"
    : "Preset default";
  const neutralPoseGuidance = getNeutralPoseCaptureGuidance({
    canCapture: canCaptureNeutralPose,
    nativeFrame,
    nativeStatus,
    source,
  });
  const resetNeutralPoseDisabled = !hasCustomNeutralCenter;
  const resetNeutralPoseNote = resetNeutralPoseDisabled
    ? `The ${selectedPreset.label} preset default center is already in use.`
    : `Reset to the ${selectedPreset.label} preset default center.`;
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
    if (calibrationFeedback === null) {
      return undefined;
    }

    const clearFeedbackTimer = window.setTimeout(() => {
      setCalibrationFeedback(null);
    }, CALIBRATION_FEEDBACK_CLEAR_DELAY_MS);

    return () => {
      window.clearTimeout(clearFeedbackTimer);
    };
  }, [calibrationFeedback]);

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

  const handlePresetChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextPresetId = event.target.value as FaceFollowingPresetId;

    const nextState = {
      presetId: nextPresetId,
      neutralCenter: rendererCalibrationState.neutralCenter,
    };

    setRendererCalibrationState(nextState);
    setCalibrationRevision((revision) => revision + 1);
    saveRendererCalibrationState(nextState);
    const nextPreset = getFaceFollowingPresetById(nextPresetId);
    setCalibrationFeedback(
      rendererCalibrationState.neutralCenter === null
        ? `Preset changed to ${nextPreset.label}; using the preset default center.`
        : `Preset changed to ${nextPreset.label}; the custom neutral pose was preserved.`,
    );
  };

  const handleCaptureNeutralPose = () => {
    if (!canCaptureNeutralPose || nativeFrame === null) {
      return;
    }

    const capturedCalibration = createFaceFollowingCalibrationFromCenter(
      nativeFrame.face.position,
      selectedPreset.calibration,
    );
    const nextState = {
      presetId: rendererCalibrationState.presetId,
      neutralCenter: capturedCalibration.center,
    };

    setRendererCalibrationState(nextState);
    setCalibrationRevision((revision) => revision + 1);
    saveRendererCalibrationState(nextState);
    setCalibrationFeedback("Neutral pose captured and saved locally.");
  };

  const handleResetNeutralPose = () => {
    if (resetNeutralPoseDisabled) {
      return;
    }

    const nextState = {
      presetId: rendererCalibrationState.presetId,
      neutralCenter: null,
    };

    setRendererCalibrationState(nextState);
    setCalibrationRevision((revision) => revision + 1);
    saveRendererCalibrationState(nextState);
    setCalibrationFeedback(
      `Neutral pose reset to the ${selectedPreset.label} preset default.`,
    );
  };

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
          aria-label="Web Preview controls"
          aria-describedby={
            sourceBadgeContent.endpointNote !== null
              ? SOURCE_BADGE_ENDPOINT_NOTE_ID
              : undefined
          }
        >
          <section
            className="preview-source-panel"
            aria-labelledby="preview-source-heading"
            aria-describedby={
              sourceBadgeContent.endpointNote !== null
                ? SOURCE_BADGE_ENDPOINT_NOTE_ID
                : undefined
            }
          >
            <h2
              id="preview-source-heading"
              className="preview-controls__heading"
            >
              Preview source
            </h2>
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
          </section>

          <section
            className="preview-calibration-panel"
            aria-labelledby="renderer-calibration-heading"
          >
            <h2
              id="renderer-calibration-heading"
              className="preview-controls__heading preview-calibration-panel__heading"
            >
              Renderer calibration
            </h2>
            <dl className="preview-calibration-panel__state">
              <div>
                <dt>Active preset</dt>
                <dd>{selectedPreset.label}</dd>
              </div>
              <div>
                <dt>Neutral center</dt>
                <dd>{neutralCenterStateLabel}</dd>
              </div>
            </dl>
            <label className="preview-calibration-panel__field">
              <span className="preview-calibration-panel__label">
                Renderer-side calibration preset
              </span>
              <select
                className="preview-calibration-panel__select"
                value={rendererCalibrationState.presetId}
                onChange={handlePresetChange}
                aria-describedby={CALIBRATION_COPY_ID}
              >
                {FACE_FOLLOWING_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <p
              id={CALIBRATION_COPY_ID}
              className="preview-calibration-panel__note"
            >
              {selectedPreset.summary} Uses current MotionFrame fields only; no
              real eye, mouth, expression, landmark, blendshape, or ML tracking.
            </p>
            <p
              id={CALIBRATION_GUIDANCE_ID}
              className="preview-calibration-panel__guidance"
            >
              {neutralPoseGuidance}
            </p>
            <div className="preview-calibration-panel__actions">
              <button
                className="preview-calibration-panel__button preview-calibration-panel__button--primary"
                type="button"
                onClick={handleCaptureNeutralPose}
                disabled={!canCaptureNeutralPose}
                aria-describedby={CALIBRATION_GUIDANCE_ID}
              >
                Set current pose as neutral
              </button>
              <button
                className="preview-calibration-panel__button preview-calibration-panel__button--secondary"
                type="button"
                onClick={handleResetNeutralPose}
                disabled={resetNeutralPoseDisabled}
                aria-describedby={RESET_NEUTRAL_NOTE_ID}
              >
                Reset neutral pose
              </button>
            </div>
            <p
              id={RESET_NEUTRAL_NOTE_ID}
              className="preview-calibration-panel__note"
            >
              {resetNeutralPoseNote}
            </p>
            <p
              id={CALIBRATION_FEEDBACK_ID}
              className="preview-calibration-panel__feedback"
              role="status"
              aria-live="polite"
            >
              {calibrationFeedback}
            </p>
            <p className="preview-source-badge__note">
              {PREVIEW_LOCAL_PRIVACY_NOTE}
            </p>
          </section>
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
          <AvatarScene
            key={calibrationRevision}
            calibration={effectiveCalibration}
            nativeFrame={nativeFrame}
            smoothing={selectedPreset.smoothing}
            source={source}
          />
        </Canvas>
      </section>
    </main>
  );
}
