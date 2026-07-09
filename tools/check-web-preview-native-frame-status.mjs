#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_PATH = fileURLToPath(
  new URL(
    "../apps/web-preview/src/hooks/useNativeMotionFrame.ts",
    import.meta.url,
  ),
);
const AVATAR_PREVIEW_PATH = fileURLToPath(
  new URL(
    "../apps/web-preview/src/components/AvatarPreview.tsx",
    import.meta.url,
  ),
);
const MOTION_PROTOCOL_SRC_PATH = fileURLToPath(
  new URL("../packages/motion-protocol/src", import.meta.url),
);

const fail = (message) => {
  throw new Error(`Web Preview native frame status check failed: ${message}`);
};

const readSourceFiles = async (directoryPath) => {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await readSourceFiles(entryPath)));
      continue;
    }

    if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push([entryPath, await readFile(entryPath, "utf8")]);
    }
  }

  return files;
};

const runCheck = async () => {
  const [hookSource, avatarPreviewSource, motionProtocolFiles] =
    await Promise.all([
      readFile(HOOK_PATH, "utf8"),
      readFile(AVATAR_PREVIEW_PATH, "utf8"),
      readSourceFiles(MOTION_PROTOCOL_SRC_PATH),
    ]);

  if (!hookSource.includes("receivedFrameCount: number;")) {
    fail(
      "useNativeMotionFrame must expose receivedFrameCount in its state type",
    );
  }

  if (!hookSource.includes("lastFrameReceivedAtMs: number | null;")) {
    fail(
      "useNativeMotionFrame must expose lastFrameReceivedAtMs in its state type",
    );
  }

  if (!hookSource.includes("setReceivedFrameCount((count) => count + 1)")) {
    fail("receivedFrameCount must increment when a native frame is received");
  }

  if (!hookSource.includes("setLastFrameReceivedAtMs(Date.now())")) {
    fail(
      "lastFrameReceivedAtMs must use local browser time when a frame arrives",
    );
  }

  if (
    !hookSource.includes("if (frame === null)") ||
    hookSource.indexOf("if (frame === null)") >
      hookSource.indexOf("setReceivedFrameCount((count) => count + 1)")
  ) {
    fail("diagnostics must only update for actual native MotionFrame values");
  }

  for (const resetSnippet of [
    "setReceivedFrameCount(0)",
    "setLastFrameReceivedAtMs(null)",
    "receivedFrameCount: enabled ? receivedFrameCount : 0",
    "lastFrameReceivedAtMs: enabled ? lastFrameReceivedAtMs : null",
  ]) {
    if (!hookSource.includes(resetSnippet)) {
      fail(`useNativeMotionFrame must reset diagnostics with ${resetSnippet}`);
    }
  }

  for (const avatarSnippet of [
    "receivedFrameCount,",
    "lastFrameReceivedAtMs,",
    "NATIVE_FRAME_AGE_REFRESH_INTERVAL_MS",
    "window.setInterval",
    "setNativeFrameAgeCurrentTimeMs(Date.now())",
    "window.clearInterval",
    "getNativeDisplayedMotionStatus(nativeStatus)",
    "Displayed motion: native MotionFrames",
    "Displayed motion: dummy fallback while waiting for native frames",
    "Displayed motion: dummy fallback while opening localhost transport",
    "Displayed motion: dummy fallback while reconnecting localhost transport",
    "Displayed motion: dummy fallback because native frames are stale",
    "Frames received: ${receivedFrameCount}",
    "Last frame: not yet received",
    "currentTimeMs - lastFrameReceivedAtMs",
    "elapsedSeconds.toFixed(1)",
    "Last frame: ${elapsedSeconds.toFixed(1)}s ago",
    'className="preview-source-badge__diagnostics"',
    "sourceBadgeContent.diagnostics !== null",
    "{!isObsMode && (",
  ]) {
    if (!avatarPreviewSource.includes(avatarSnippet)) {
      fail(
        `AvatarPreview.tsx must include native-only diagnostics: ${avatarSnippet}`,
      );
    }
  }

  if (!avatarPreviewSource.includes("diagnostics: null")) {
    fail(
      "demo/OBS-hidden source badge path must not render native diagnostics",
    );
  }

  for (const guidanceSnippet of [
    "Dummy mode is active",
    "Transport open · Waiting for first native frame",
    "Native MotionFrames live",
    "Native frames stale · Showing fallback",
    "Local transport disconnected · Retrying",
    "Connected to localhost transport",
    "built-in dummy fallback until native frames resume",
  ]) {
    if (!avatarPreviewSource.includes(guidanceSnippet)) {
      fail(`AvatarPreview.tsx must include guidance text: ${guidanceSnippet}`);
    }
  }

  if (avatarPreviewSource.includes("Last frame: recently received")) {
    fail("static Last frame: recently received text must no longer be used");
  }

  if (
    !avatarPreviewSource.includes(
      'source !== "native" || lastFrameReceivedAtMs === null',
    )
  ) {
    fail(
      "native frame age refresh must only run while native source has received a frame",
    );
  }

  for (const [filePath, source] of motionProtocolFiles) {
    if (
      source.includes("receivedFrameCount") ||
      source.includes("lastFrameReceivedAtMs") ||
      source.includes("nativeFrameAgeCurrentTimeMs") ||
      source.includes("NATIVE_FRAME_AGE_REFRESH_INTERVAL_MS")
    ) {
      fail(
        `MotionFrame schema/protocol source must not include UI diagnostics (${filePath})`,
      );
    }
  }

  console.log("Web Preview native frame status check passed.");
};

runCheck().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
