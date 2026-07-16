#!/usr/bin/env node
// Native Core-to-Python MediaPipe helper frame bridge checker (#571).
//
// Two responsibilities:
//   A. Static source guard (always runs): confirms the new test-only Python
//      fixture, the new native smoke, and the CMake wiring hold the
//      required contract markers and never use a forbidden facility.
//   B/C/D. Runtime bridge check (runs only when both a built native smoke
//      binary and a usable Python interpreter are available): spawns the
//      real native smoke against the real fixture through a real Python
//      child process and requires its exact sanitized success contract.
//
// Never prints an executable/script/marker path, argv, subprocess stdout/
// stderr, exception text, or which assertion failed.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function fail() {
  console.error("Native Core-to-Python helper frame bridge check failed.");
  process.exit(1);
}

const fixturePath = join(
  repoRoot,
  "native",
  "tracker-core",
  "tests",
  "fixtures",
  "mediapipe_helper_frame_bridge_fixture.py",
);
const smokeSourcePath = join(
  repoRoot,
  "native",
  "tracker-core",
  "src",
  "mediapipe_helper_frame_bridge_smoke.cpp",
);
const cmakePath = join(repoRoot, "native", "tracker-core", "CMakeLists.txt");

function readRequired(path) {
  if (!existsSync(path)) {
    fail();
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    fail();
    return "";
  }
}

function stripCppComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function runStaticSourceGuard() {
  const fixtureText = readRequired(fixturePath);
  const smokeText = readRequired(smokeSourcePath);
  const cmakeText = readRequired(cmakePath);
  const smokeStripped = stripCppComments(smokeText);

  // --- A0: fixture location -------------------------------------------

  const normalizedFixturePath = fixturePath.split("\\").join("/");
  if (
    !normalizedFixturePath.includes(
      "/native/tracker-core/tests/fixtures/mediapipe_helper_frame_bridge_fixture.py",
    )
  ) {
    fail();
  }

  // --- A1: required fixture contract markers ---------------------------

  const requiredInFixture = [
    "run_face_landmarker_helper_session(",
    "_parse_startup_arguments(",
    "sys.stdin.buffer",
    "module_importer=",
    "571001",
    "571002",
    "571003",
    "571004",
  ];
  for (const marker of requiredInFixture) {
    if (!fixtureText.includes(marker)) {
      fail();
    }
  }

  // --- A2: forbidden fixture facilities ---------------------------------
  //
  // Never rejects the required sys.stdout.write()/flush() protocol output
  // itself: none of these patterns match plain stdout/stderr write/flush
  // calls.

  const forbiddenFixturePatterns = [
    /\bunittest\b/,
    /\bmock\b/,
    /\bpatch\b/,
    /HelperFrameInputReader/,
    /test_face_landmarker_helper_session/,
    /\btempfile\b/,
    /\bopen\s*\(/,
    /\bPath\.open\s*\(/,
    /\bread_text\s*\(/,
    /\bread_bytes\s*\(/,
    /\bwrite_text\s*\(/,
    /\bwrite_bytes\s*\(/,
    /\bsubprocess\b/,
    /\bmultiprocessing\b/,
    /\bsocket\b/,
    /\brequests\b/,
    /\burllib\b/,
    /http\.client/,
    /\bthreading\b/,
    /\basyncio\b/,
    /os\.environ/,
    /\bgetenv\s*\(/,
    /os\.stat\s*\(/,
    /os\.path\.exists\s*\(/,
    /os\.path\.isfile\s*\(/,
    /os\.path\.isdir\s*\(/,
    /os\.listdir\s*\(/,
    /os\.scandir\s*\(/,
  ];
  for (const pattern of forbiddenFixturePatterns) {
    if (pattern.test(fixtureText)) {
      fail();
    }
  }

  // --- A3: required C++ smoke contract markers --------------------------

  const requiredInSmoke = [
    "createMediaPipeHelperRouteConfig",
    "HelperProcessSession",
    "trackWithFrame",
    "HelperTrackingStatus::Lost",
    "FrameAckMismatch",
    "MalformedMessage",
    "shutdownDiagnostic",
    "mediapipe-helper-frame-bridge smoke OK",
    "mediapipe-helper-frame-bridge smoke failed.",
  ];
  for (const marker of requiredInSmoke) {
    if (!smokeStripped.includes(marker)) {
      fail();
    }
  }

  // --- A4: CMake wiring --------------------------------------------------

  const smokeTargetMatch = cmakeText.match(
    /add_executable\(lvk-mediapipe-helper-frame-bridge-smoke\s*([\s\S]*?)\)/,
  );
  if (!smokeTargetMatch) {
    fail();
  }
  const smokeTargetSources = smokeTargetMatch[1]
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const expectedSources = [
    "src/helper_frame_packet.cpp",
    "src/helper_message.cpp",
    "src/helper_process_cleanup_registry.cpp",
    "src/helper_process_session.cpp",
    "src/mediapipe_helper_route_config.cpp",
    "src/mediapipe_helper_frame_bridge_smoke.cpp",
  ];
  if (smokeTargetSources.length !== expectedSources.length) {
    fail();
  }
  for (const source of expectedSources) {
    if (!smokeTargetSources.includes(source)) {
      fail();
    }
  }

  if (
    !new RegExp(
      "target_compile_features\\(\\s*lvk-mediapipe-helper-frame-bridge-smoke\\s+PRIVATE\\s+cxx_std_17\\s*\\)",
    ).test(cmakeText)
  ) {
    fail();
  }

  const linkCalls = [
    ...cmakeText.matchAll(
      /target_link_libraries\(\s*lvk-mediapipe-helper-frame-bridge-smoke\s+PRIVATE\s+([^)]*)\)/g,
    ),
  ];
  if (linkCalls.length === 0) {
    fail();
  }
  const linkedLibraries = linkCalls.flatMap((match) =>
    match[1]
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  if (
    linkedLibraries.length !== 1 ||
    linkedLibraries[0] !== "Threads::Threads"
  ) {
    fail();
  }
}

// --- B: native executable resolution -----------------------------------

function resolveNativeExecutable() {
  const provided = process.argv[2];
  if (provided) {
    if (!existsSync(provided)) {
      fail();
    }
    return provided;
  }

  const candidates = [
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Debug",
      "lvk-mediapipe-helper-frame-bridge-smoke.exe",
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Release",
      "lvk-mediapipe-helper-frame-bridge-smoke.exe",
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "lvk-mediapipe-helper-frame-bridge-smoke",
    ),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

// --- C: Python interpreter resolution ------------------------------------

function resolvePythonCandidates() {
  const explicit = process.argv[3];
  if (explicit) {
    return { candidates: [explicit], strict: true };
  }
  const envPython = process.env.LVK_TEST_PYTHON;
  if (envPython) {
    return { candidates: [envPython], strict: true };
  }
  return { candidates: ["python3", "python"], strict: false };
}

function isCommandNotFound(spawnError) {
  return Boolean(spawnError) && spawnError.code === "ENOENT";
}

function isSafeAbsolutePathText(text) {
  if (typeof text !== "string" || text.length === 0) {
    return false;
  }
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return isAbsolute(text);
}

// Returns { interpreter } on success, or { skip: true } when no default
// candidate is available. Any other failure calls fail() directly.
function resolvePythonInterpreter() {
  const { candidates, strict } = resolvePythonCandidates();

  for (let index = 0; index < candidates.length; index += 1) {
    const isLastCandidate = index === candidates.length - 1;
    const result = spawnSync(
      candidates[index],
      ["-B", "-c", "import sys; sys.stdout.write(sys.executable)"],
      { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 },
    );

    if (result.error) {
      if (!strict && isCommandNotFound(result.error)) {
        if (isLastCandidate) {
          return { skip: true };
        }
        continue;
      }
      // Any non-ENOENT spawn error, or an ENOENT for a strict (explicit/
      // LVK_TEST_PYTHON) candidate, is a generic failure -- never a
      // fallback or skip.
      fail();
    }

    if (result.status !== 0) {
      fail();
    }
    if ((result.stderr ?? "") !== "") {
      fail();
    }
    if (!isSafeAbsolutePathText(result.stdout ?? "")) {
      fail();
    }
    return { interpreter: result.stdout };
  }

  fail();
  return undefined;
}

// --- D: runtime bridge check ---------------------------------------------

function runBridgeCheck(executablePath, pythonInterpreter) {
  const modelMarkerPath = join(
    repoRoot,
    "native",
    "tracker-core",
    "tests",
    "fixtures",
    "lvk-frame-bridge-synthetic-model-marker-571.task",
  );
  const missingExecutableMarkerPath = join(
    repoRoot,
    "native",
    "tracker-core",
    "tests",
    "fixtures",
    "lvk-frame-bridge-missing-executable-marker-571",
  );

  const result = spawnSync(
    executablePath,
    [
      pythonInterpreter,
      fixturePath,
      modelMarkerPath,
      missingExecutableMarkerPath,
    ],
    { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024, shell: false },
  );

  if (result.error) {
    fail();
  }
  if (result.status !== 0) {
    fail();
  }
  if ((result.stderr ?? "") !== "") {
    fail();
  }
  if ((result.stdout ?? "") !== "mediapipe-helper-frame-bridge smoke OK\n") {
    fail();
  }

  const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const forbiddenOutputSubstrings = [
    pythonInterpreter,
    fixturePath,
    modelMarkerPath,
    missingExecutableMarkerPath,
    "mediapipe_helper_frame_bridge_fixture.py",
    "--model-asset-path",
    "--session",
    "--session-frame-mode",
    "LVK_FRAME_PIPE_HANDLE",
    '{"type":',
    "frameAck",
    "LVKF",
    "1246796121",
  ];
  for (const forbidden of forbiddenOutputSubstrings) {
    if (forbidden && combinedOutput.includes(forbidden)) {
      fail();
    }
  }
}

try {
  runStaticSourceGuard();

  const executablePath = resolveNativeExecutable();
  if (!executablePath) {
    console.log(
      "Native Core-to-Python helper frame bridge check skipped: native smoke binary not found.",
    );
    process.exit(0);
  }

  const pythonResolution = resolvePythonInterpreter();
  if (pythonResolution.skip) {
    console.log(
      "Native Core-to-Python helper frame bridge check skipped: Python interpreter unavailable.",
    );
    process.exit(0);
  }

  runBridgeCheck(executablePath, pythonResolution.interpreter);

  console.log("Native Core-to-Python helper frame bridge check passed.");
} catch {
  fail();
}
