# AGENTS

Project name: **Local Virtual Kit**  
Short name: **LVK**  
Repository name: `local-virtual-kit`  
Package namespace candidate: `@lvk/*`

This document is the primary instruction file for AI/coding agents working on LVK.

The project-level `README.md` is intentionally not managed by this documentation package. The product README should be created and maintained separately by the project owner.

---

## 1. Language Policy

All agent-facing documentation under `docs/*.md` should be written in English for implementation accuracy and consistency.

However:

- ChatGPT/GPT Project responses to the project owner should be written in Japanese by default.
- Notion knowledge-base work logs must be written in Japanese.
- Code, filenames, package names, commands, branch names, PR titles, commit messages, and technical identifiers may remain in English.

---

## 2. Project Identity

Local Virtual Kit / LVK is a local-first avatar tracking and rendering kit for VTuber and virtual character workflows.

The first goal is not to build a full VTuber production suite. The first goal is to establish a stable, understandable, and extensible architecture where a local C++ tracking core emits normalized motion data consumed by a web-based R3F avatar preview.

---

## 3. Fixed Architecture Decisions

These decisions are fixed unless the project owner explicitly changes them.

- C++ Native Core is fixed and non-negotiable for tracking and performance.
- Electron is used for the desktop app shell, launcher, settings UI, calibration UI, and Native Core process management.
- React / Three.js / React Three Fiber are used for Web Preview, Avatar Renderer, and OBS Browser Source style preview.
- Camera frames must be processed locally.
- Camera frames must not be sent to external servers in v0.1.
- MotionFrame Protocol is the contract between Native Core and Renderer.
- v0.1 uses plain handwritten R3F for the avatar preview.
- The user's separate R3F flow library is not a required dependency for v0.1.
- Future `examples/flow-avatar` may use the user's R3F flow library only after that library becomes public and stable.

---

## 4. Responsibility Boundaries

### C++ Native Core

Responsible for:

- Webcam access
- Frame processing
- Face detection
- Face landmark extraction
- Head pose estimation
- Eye/mouth/expression value estimation
- Tracking lost detection
- Basic smoothing
- MotionFrame generation
- Local transport output

Must not handle:

- React UI
- Electron settings UI
- Avatar rendering
- R3F scene implementation
- Cloud sync
- Account/payment logic

### MotionFrame Protocol

Responsible for:

- Shared tracking output contract
- TypeScript MotionFrame definition
- C++ structure draft
- Normalized value rules
- Dummy frame support
- Future compatibility policy

Must not depend on:

- React
- Three.js
- React Three Fiber
- Electron
- OpenCV
- MediaPipe
- Native platform APIs

### R3F Web Preview / Avatar Renderer

Responsible for:

- Receiving MotionFrame data
- Rendering the avatar
- Mapping head/eye/mouth/expression values to avatar motion
- Providing OBS-friendly preview route
- Supporting dummy MotionFrame mode

Must not handle:

- Native tracking implementation
- Camera frame processing in v0.1
- Native process lifecycle management
- Desktop settings persistence

### Electron Desktop App

Responsible for:

- App shell
- Native Core process launch/stop
- Settings UI
- Calibration UI
- Preview URL management
- Local configuration management

Must not handle:

- Reimplementing tracking
- Deep avatar rendering internals
- Camera frame upload
- Server-side processing

---

## 5. Expected Documentation Layout

```txt
docs/
├─ AGENTS.md
├─ REQUIREMENTS.md
├─ ARCHITECTURE.md
├─ TECH_STACK.md
├─ TRACKING_SPEC.md
├─ MOTION_PROTOCOL.md
├─ MOTION_MAPPING.md
├─ ROADMAP.md
├─ DEVELOPMENT_POLICY.md
└─ AI_IMPLEMENTATION_PROMPT.md
```

The project root `README.md` is intentionally separate.

---

## 6. Documentation Reading Order

Agents should read documents in this order:

1. `docs/AGENTS.md`
2. `docs/REQUIREMENTS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/TECH_STACK.md`
5. `docs/MOTION_PROTOCOL.md`
6. `docs/TRACKING_SPEC.md`
7. `docs/MOTION_MAPPING.md`
8. `docs/ROADMAP.md`
9. `docs/DEVELOPMENT_POLICY.md`
10. `docs/AI_IMPLEMENTATION_PROMPT.md`

---

## 7. Git and PR Policy

- Never push directly to `main`.
- Always create a dedicated branch for changes.
- Keep each PR small and reviewable.
- Do not include unrelated refactors.
- If changes are made, create a PR.
- After creating a PR, output the PR URL, summary, changed files, modified areas, verification results, known issues, and next steps.

---

## 8. Notion Knowledge Policy

At the end of each implementation task, update the Notion note named `Local Virtual Kit` or `LVK`.

- The Notion work log must be written in Japanese.
- If the note exists, append the work log.
- If the note does not exist, create it.
- Record implemented changes, errors, decisions, verification results, PR URL, and next actions.
- If Notion is unavailable, output a Japanese Notion-ready work log in the final report.

---

## 9. First Implementation Direction

After documentation is placed in `docs/`, the first implementation task should be:

```txt
Set up pnpm workspace and create packages/motion-protocol.
```

Do not start from camera tracking. The safest first implementation unit is MotionFrame because it is the contract between Native Core and R3F Preview.
