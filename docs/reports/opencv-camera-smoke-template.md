# OpenCV Camera Smoke Report Template

Use this template only for future local OpenCV camera smoke validation results. Do not use it to claim OpenCV camera validation unless the smoke was actually run on a local machine with an OpenCV-enabled native build, webcam hardware, and OS camera permission.

This template is documentation-only. Replace placeholders when recording a real validation pass, and keep any real report free of raw frames, screenshots, sensitive logs, binaries, build artifacts, model files, cascade XML files, local machine paths, or private/internal links.

## 1. Report metadata

- Date:
- Environment:
- OS:
- Node/pnpm:
- CMake:

## 2. Local prerequisites

- OpenCV found by CMake: yes/no
- LVK `opencvCameraSupport`: true/false
- Webcam available: yes/no
- OS camera permission granted: yes/no

## 3. Command execution

- Command run:
- Was `pnpm smoke:native-opencv-camera:local` actually run: yes/no
- Result: PASS / SKIP / FAIL
- Helper skipped honestly: yes/no/not applicable
- MotionFrame JSON observed on stdout: yes/no/not applicable
- `[camera]` diagnostics observed on stderr: yes/no/not applicable

## 4. Result classification

Choose exactly one result and keep the evidence limited to concise, non-sensitive summaries.

### PASS

Use `PASS` only when the actual OpenCV camera smoke ran and passed on a local machine with all required prerequisites:

- OpenCV-enabled native build was available.
- Webcam hardware was available.
- OS camera permission was granted to the tested terminal or host process.
- The OpenCV camera smoke command exited successfully.
- MotionFrame JSON was observed on stdout.
- Raw camera frames remained local to Native Core memory.

### SKIP

Use `SKIP` when the helper did not run the actual camera smoke because a required prerequisite was unavailable or the helper skipped honestly, including any of these cases:

- Native binary was missing or not built.
- `opencvCameraSupport=false` or OpenCV was not found by CMake.
- Webcam hardware was unavailable or not checked.
- OS camera permission was unavailable, denied, or not checked.

### FAIL

Use `FAIL` when the helper or camera/runtime command attempted to run and failed, including any of these cases:

- The helper exited non-zero after attempting the smoke.
- The raw camera/runtime command exited non-zero.
- Required MotionFrame JSON was not emitted when the smoke was expected to run.
- Expected camera diagnostics or runtime behavior indicated an error.

## 5. Privacy and artifact guardrails

- Raw camera frames must remain local to Native Core memory.
- Do not print, write, upload, commit, or otherwise persist raw camera frames.
- Do not commit screenshots, logs containing sensitive local paths, binaries, build artifacts, model files, cascade XML files, or other generated artifacts.
- Do not include local machine paths, private/internal links, or unrelated tool/session URLs in the report.

## 6. Confirmation checklist

- [ ] No raw camera frames were printed, written, uploaded, or committed.
- [ ] Raw camera frames remained local to Native Core memory.
- [ ] No screenshots were committed.
- [ ] No logs containing sensitive local paths were committed.
- [ ] No binaries, build artifacts, model files, or cascade XML files were committed.
- [ ] No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior was introduced.
- [ ] This report does not claim OBS, Electron GUI, webcam/OpenCV, OS camera permission, or real hardware validation beyond what was actually performed.

## 7. Unresolved items

-
