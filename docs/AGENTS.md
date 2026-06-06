# AGENTS

Project: **Local Virtual Kit / LVK**  
Repository: `local-virtual-kit`  
Package namespace: `@lvk/*`

This file is the lightweight source of truth for AI and coding agents. Keep it short. Put detailed product, architecture, protocol, and workflow information in the focused documents listed below.

---

## 1. Default Operating Rule

Always start by reading this file.

Then read only the documents required for the current task. Do **not** load every `docs/*.md` file by default.

Use this map:

| Task type | Read next |
| --- | --- |
| Product scope, MVP, non-goals | `docs/REQUIREMENTS.md` |
| App/process boundaries | `docs/ARCHITECTURE.md` |
| Dependencies, package layout, commands | `docs/TECH_STACK.md` |
| Native tracking values | `docs/TRACKING_SPEC.md` |
| MotionFrame schema/compatibility | `docs/MOTION_PROTOCOL.md` |
| Renderer mapping from MotionFrame | `docs/MOTION_MAPPING.md` |
| Planning the next implementation unit | `docs/ROADMAP.md` |
| Git, checks, PR, reporting | `docs/DEVELOPMENT_POLICY.md` |
| Copy-ready coding-agent prompt | `docs/AI_IMPLEMENTATION_PROMPT.md` |

If documents conflict, prefer this order:

1. Current source code on the target branch
2. `docs/AGENTS.md`
3. The task-specific focused document
4. Older planning notes

---

## 2. Language Policy

- Repository docs and agent-facing implementation prompts should be written in English.
- Final responses to the project owner should be written in Japanese by default.
- Notion work logs must be written in Japanese.
- Code, commands, identifiers, branch names, commit messages, and PR titles may remain in English.

---

## 3. Hard Constraints

These are fixed unless the project owner explicitly changes them:

- Keep LVK local-first.
- Camera frames must stay local and must not be sent to external servers in v0.1.
- C++ Native Core is the tracking/performance layer.
- Electron is the desktop shell, settings, calibration, and native process manager.
- React / Three.js / React Three Fiber are the Web Preview and avatar renderer layer.
- `MotionFrame` is the contract between Native Core and Renderer.
- v0.1 uses plain handwritten R3F.
- The user's separate R3F flow library must not be a required v0.1 dependency.
- `packages/motion-protocol` must stay framework-independent.

---

## 4. Responsibility Boundaries

| Area | Owns | Must not own |
| --- | --- | --- |
| Native Core | camera access, tracking, smoothing, MotionFrame output | React UI, avatar rendering, cloud sync |
| Motion Protocol | shared types, dummy frames, schema compatibility | React, Three.js, Electron, OpenCV runtime logic |
| Web Preview | MotionFrame consumption, mapping, R3F rendering, OBS-friendly preview | native tracking, camera frame processing, desktop settings |
| Electron App | app shell, settings, calibration UI, native process lifecycle | tracking algorithms, deep renderer internals, camera upload |

---

## 5. Git and Change Policy

- Never push directly to `main`.
- Use a dedicated branch for each task.
- Keep PRs small and reviewable.
- Do not include unrelated refactors.
- Do not claim that checks passed unless they were actually run.
- If changes are made, create a PR.

---

## 6. Documentation Maintenance Policy

Avoid duplicated instructions.

- Keep global agent rules here.
- Keep product scope in `REQUIREMENTS.md`.
- Keep architecture in `ARCHITECTURE.md`.
- Keep MotionFrame schema in `MOTION_PROTOCOL.md`.
- Keep task flow in `ROADMAP.md`.
- Keep workflow/checks/reporting in `DEVELOPMENT_POLICY.md`.

Do not add a fixed "next task" to this file. Before proposing the next task, inspect the current repository state.

---

## 7. Final Report Requirements

Final project-owner responses should include:

```txt
作業ブランチ:
PR URL:
作業概要:
変更ファイル:
修正箇所:
実行した確認:
エラー・未解決事項:
Notion記録:
次にやるべきこと:
```

If Notion is unavailable, provide a Japanese Notion-ready work log instead of claiming it was updated.
