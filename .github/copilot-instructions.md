# GitHub Copilot Instructions — Local Virtual Kit (LVK)

These instructions guide GitHub Copilot Chat and completions for this
repository. They are a short, repo-specific summary. The authoritative source
of truth for agents is `docs/AGENTS.md`; read it (and only the task-relevant
focused docs it links) before non-trivial work.

## What LVK is

Local Virtual Kit (LVK) is a **local-first VTuber / virtual avatar starter
kit**. It tracks a performer with a local camera and drives an avatar preview
suitable for OBS. Package namespace is `@lvk/*`.

## Hard privacy and local-first constraints

These are fixed unless the project owner explicitly changes them.

- Camera frames must stay local in v0.1 and must never be sent to external
  servers.
- Do not add telemetry, analytics, cloud upload, external frame processing,
  hidden network calls, or any new network behavior unless the project owner
  explicitly approves it.
- Keep LVK local-first by default.

## Architecture boundaries

Respect these ownership lines. Do not move responsibilities across them.

- **Native Core (C++)** — owns camera access, tracking, smoothing, native
  performance, and runtime boundaries. Emits `MotionFrame` output.
- **Electron app** — owns the desktop shell, settings, calibration UI, and
  native process lifecycle. It does not own tracking algorithms or camera
  frame processing.
- **Web Preview (React / Three.js / R3F)** — consumes `MotionFrame` only and
  renders the avatar / OBS-friendly preview. It does not do native tracking or
  camera frame processing.
- **Shared protocol packages** (e.g. `packages/motion-protocol`) — own the
  stable cross-boundary contracts and must stay framework-independent.

## MotionFrame contract

- `MotionFrame` is the stable contract between Native Core and the Renderer.
- Do not change it casually. Treat schema changes as protocol work: inspect
  `docs/MOTION_PROTOCOL.md` and current source first, and do not invent fields.

## Dependency rules

- Electron and Web Preview must not gain backend/native runtime dependencies.
- Do not add new dependencies unless the project owner explicitly approves.

## Change workflow

- Prefer small, safe, source-grounded, reviewable changes (aim for 1–3 files
  per PR where practical).
- Avoid unrelated refactors and broad documentation rewrites.
- Use a dedicated branch per change; do not push directly to `main`.
- When behavior changes, update the relevant docs and tests in the same change.
- Do not claim that checks, builds, or local/manual validation passed unless
  they were actually run in the required environment.

## Language

- Keep repository docs, agent prompts, code identifiers, branch names, commit
  messages, and PR text in English.

## Copilot's role

- Copilot assists with drafting and completion. It is not the final reviewer.
- PR review judgment remains owner/GPT-led; surface uncertainty instead of
  asserting correctness.
