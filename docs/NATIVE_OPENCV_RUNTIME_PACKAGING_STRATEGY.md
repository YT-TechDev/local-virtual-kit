# Native OpenCV Runtime Packaging Strategy

This document defines the packaging strategy for Windows/vcpkg OpenCV runtime DLL handling before any implementation changes are made. It is intentionally documentation-only: it does not copy DLLs, change Electron packaging, change Native Core build behavior, or alter runtime process launch behavior.

## Purpose

OpenCV-enabled Native Core builds are now viable for local camera validation, but Windows/vcpkg OpenCV builds can dynamically link against runtime DLLs that are not present by default on end-user machines. Packaged Electron builds need an app-owned, local-first way to provide those DLLs without changing LVK's architecture boundaries, privacy posture, `MotionFrame` schema, or Motion Protocol.

## Current known state

- Native Core can be built locally with OpenCV support enabled when the local development machine provides the required OpenCV development files.
- On Windows, vcpkg-provided OpenCV builds may dynamically link against OpenCV runtime DLLs.
- If a required runtime DLL is missing, the native executable can fail before normal LVK diagnostics run with `STATUS_DLL_NOT_FOUND` / `0xC0000135`.
- Current development-only checker/helper guidance can explain common missing-DLL failures, but it does not solve packaged app distribution.
- Current local validation guidance requires Windows/vcpkg OpenCV runtime DLL directories to be available on `PATH` before running OpenCV-enabled native commands.
- The current OpenCV camera smoke path is local/manual and must not be claimed unless it is run on a machine with the required local build, webcam, OS camera permission, and runtime DLL availability.

## Non-negotiable constraints

- LVK remains local-first.
- Camera frames must stay local.
- Packaging must not add telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior.
- Electron owns the desktop shell, settings, calibration UI, local configuration, and Native Core process lifecycle.
- Native Core owns camera access, tracking, native runtime behavior, and performance boundaries.
- OpenCV runtime DLL handling must not change the `MotionFrame` schema.
- OpenCV runtime DLL handling must not change the Motion Protocol.
- Packaging must not require raw camera frames to be written, uploaded, persisted, or logged.
- Failure messages must remain sanitized and must not expose local absolute paths.

## Strategy options

### A. Dev-only `PATH` requirement only

Require developers and users to put the relevant OpenCV runtime DLL directory on `PATH` before launching any OpenCV-enabled Native Core binary.

**Benefits**

- Minimal implementation work.
- Clear enough for local development and manual OpenCV camera smoke validation.
- Keeps packaging configuration unchanged.
- Keeps DLL provenance explicit during development.

**Risks**

- Poor packaged-app user experience.
- Easy to misconfigure on clean Windows machines.
- Can fail before LVK can emit normal diagnostics.
- Ties packaged behavior to a developer-machine concept.

**Privacy/security implications**

- Does not require network behavior or frame upload.
- Broad `PATH` usage can accidentally load unexpected DLLs from a user-controlled or unrelated directory if configured incorrectly.

**Maintenance cost**

- Low short-term documentation cost.
- High support cost for packaged builds because failures depend on each machine's environment.

**Suitability for v0.1/v0.2**

- Suitable for local/dev validation.
- Not suitable as the packaged Electron app strategy.

### B. Bundle required OpenCV runtime DLLs next to the packaged native executable

Collect the required OpenCV runtime DLLs during packaging and place them in the same app-owned directory as the packaged Native Core executable, or in another app-owned directory that the executable can resolve deterministically.

**Benefits**

- Best packaged-app user experience.
- Avoids requiring users to install vcpkg or OpenCV globally.
- Avoids global `PATH` mutation.
- Keeps Native Core launch owned by Electron and the app package.
- Makes future package validation reproducible on clean Windows machines.

**Risks**

- Requires careful DLL collection and manifest generation in a later implementation PR.
- Requires license and redistribution review for bundled third-party binaries.
- Requires Debug/Release and architecture separation to avoid shipping the wrong DLL set.
- Requires packaging checks to catch missing transitive DLLs.

**Privacy/security implications**

- Does not require network behavior or frame upload.
- App-owned local DLLs reduce accidental DLL search-path ambiguity compared with global machine state.
- Future implementation must ensure bundled native binaries do not introduce telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior.

**Maintenance cost**

- Medium implementation and release maintenance cost.
- Lower user-support cost after packaging validation exists.

**Suitability for v0.1/v0.2**

- Preferred direction for packaged Electron builds.
- Treat DLL collection, manifest generation, and packaging validation as later implementation work.

### C. Use a scoped child-process environment `PATH` at launch time

Have Electron launch Native Core with a process-local environment that prepends an app-owned DLL directory to `PATH`, without changing the user's global environment.

**Benefits**

- Avoids global `PATH` mutation.
- Can work with app-owned DLL bundling when DLLs are not adjacent to the executable.
- Limits the environment change to the Native Core child process.
- Preserves Electron ownership of native process lifecycle.

**Risks**

- Still requires bundled DLLs or another app-owned DLL source.
- Requires careful implementation to avoid leaking local absolute paths in errors.
- Adds launch-time complexity in Electron.
- Can become fragile if multiple native binaries need different runtime directories.

**Privacy/security implications**

- Does not require network behavior or frame upload.
- Safer than global `PATH` mutation because the change is scoped to the child process.
- Future implementation must ensure only app-owned local directories are added.

**Maintenance cost**

- Medium cost.
- Best treated as a supporting mechanism for bundled app-owned DLLs, not as a standalone distribution strategy.

**Suitability for v0.1/v0.2**

- Suitable as an implementation detail if adjacent DLL placement is insufficient.
- Secondary to Strategy B for packaged builds.

### D. Static linking or alternate OpenCV distribution

Build Native Core against a static OpenCV configuration or a different redistributable OpenCV distribution that reduces or changes runtime DLL requirements.

**Benefits**

- Can simplify packaged runtime layout if successful.
- May reduce missing-DLL startup failures.
- Can make package contents more deterministic.

**Risks**

- May significantly increase binary size.
- Can complicate OpenCV build configuration, licensing review, updates, and platform parity.
- May diverge from current vcpkg-based local development.
- Could delay v0.1/v0.2 packaging with build-system work.

**Privacy/security implications**

- Does not require network behavior or frame upload.
- Must still preserve local-only camera processing and avoid hidden network behavior.
- License and redistribution requirements must be reviewed before shipping.

**Maintenance cost**

- Medium to high.
- Higher if it requires custom OpenCV builds or separate platform-specific dependency pipelines.

**Suitability for v0.1/v0.2**

- Not the first-choice v0.1 packaged strategy.
- Worth revisiting if bundled dynamic DLL maintenance becomes too costly.

### E. Installer-level system `PATH` or global install requirement

Require an installer to mutate the system/user `PATH`, or require end users to install vcpkg/OpenCV globally before using OpenCV-backed tracking.

**Benefits**

- Can avoid bundling DLLs in the application package.
- Pushes dependency resolution outside the app.

**Risks**

- Poor local-first desktop product experience.
- Requires users to understand development tooling.
- Mutates global machine state or depends on global machine state.
- Can break other software or be broken by other software.
- Hard to support and hard to validate reproducibly.

**Privacy/security implications**

- Does not inherently require frame upload or network behavior.
- Global dependency state increases DLL search-path and supply-chain ambiguity.
- A global install workflow can encourage unnecessary downloads outside LVK's packaging boundary.

**Maintenance cost**

- Low app implementation cost.
- High support, documentation, and security-review cost.

**Suitability for v0.1/v0.2**

- Not recommended.
- Avoid for packaged Electron builds.

## Recommended staged direction

### Local/development validation

- Keep explicit `PATH` guidance for Windows/vcpkg OpenCV local development.
- Keep checker/helper messages focused on explaining `STATUS_DLL_NOT_FOUND` / `0xC0000135` and common local remediation steps.
- Continue treating OpenCV camera smoke as local/manual validation that requires a local OpenCV-enabled build, webcam, OS camera permission, and required runtime DLL availability.

### Packaged Electron app

- Prefer bundling the required OpenCV runtime DLLs in an app-owned package directory adjacent to the packaged Native Core executable.
- Have Electron launch Native Core from an app-owned local path.
- If needed, use a scoped child-process environment `PATH` only to point Native Core at app-owned bundled DLL directories.
- Avoid global `PATH` mutation.
- Avoid requiring users to install vcpkg or OpenCV globally.
- Avoid runtime network downloads for OpenCV DLLs or native runtime dependencies.
- Defer DLL collection, dependency manifest generation, redistribution review, and package validation to a later implementation PR.
- Before connecting the dev/local copy helper to Electron packaging, follow the OpenCV runtime DLL manifest policy in [`docs/OPENCV_RUNTIME_DLL_MANIFEST_POLICY.md`](./OPENCV_RUNTIME_DLL_MANIFEST_POLICY.md).

## Acceptance criteria for future implementation PRs

Future implementation PRs that add Windows/vcpkg OpenCV runtime DLL packaging should satisfy these criteria:

- A packaged Native Core executable starts without requiring a global vcpkg or OpenCV directory on `PATH`.
- Required runtime DLLs are included in an app-owned package directory.
- Electron launches Native Core from an app-owned local path.
- Any scoped launch environment points only to app-owned local package directories.
- No raw camera frames are written, uploaded, persisted, or logged.
- No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior is added.
- `--print-runtime-capabilities` works from the packaged location.
- OpenCV camera smoke remains local/manual and is not claimed from headless CI or machines without the required local camera prerequisites.
- Failure messages stay sanitized and do not expose local absolute paths.
- `MotionFrame` schema and Motion Protocol remain unchanged.
- Electron packaging changes remain separated from Native Core tracking algorithm changes.

## Out of scope for this strategy document

- DLL copying implementation.
- Electron packaging configuration changes.
- Native Core C++ changes.
- CMake behavior changes.
- Checker or helper script changes.
- Electron runtime code changes.
- Web Preview changes.
- Dependency changes.
- MotionFrame schema or Motion Protocol changes.
