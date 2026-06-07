# AGENTS

Project: **Local Virtual Kit / LVK**
Repository: `local-virtual-kit`
Package namespace: `@lvk/*`

This file is the lightweight source of truth for AI and coding agents.

Keep this file short. Put detailed product, architecture, protocol, mapping, roadmap, and workflow information in the focused documents listed below.

---

## 1. Default Operating Rule

The agent must optimize for small, safe, source-grounded changes.

Always start by reading this file.

Before making any change, inspect the target branch, current source code, and relevant open PRs when available. Documentation must support the current implementation state, not replace it.

Do not load every `docs/*.md` file by default. After reading this file, read only the documents directly required for the current task.

Use this map:

| Task type                              | Read next                          |
| -------------------------------------- | ---------------------------------- |
| Product scope, MVP, non-goals          | `docs/REQUIREMENTS.md`             |
| App/process boundaries                 | `docs/ARCHITECTURE.md`             |
| Dependencies, package layout, commands | `docs/TECH_STACK.md`               |
| Native tracking values                 | `docs/TRACKING_SPEC.md`            |
| MotionFrame schema/compatibility       | `docs/MOTION_PROTOCOL.md`          |
| Renderer mapping from MotionFrame      | `docs/MOTION_MAPPING.md`           |
| Planning the next implementation unit  | `docs/ROADMAP.md`                  |
| Git, checks, PR, reporting             | `docs/DEVELOPMENT_POLICY.md`       |
| Copy-ready coding-agent prompt         | `docs/AI_IMPLEMENTATION_PROMPT.md` |

If documents conflict, prefer this order:

1. Current source code on the target branch
2. `docs/AGENTS.md`
3. The task-specific focused document
4. Older planning notes

---

## 2. Agent Work Rules

- Do not rewrite multiple documentation files unless the task explicitly requires it.
- Do not perform broad refactors while implementing a small feature.
- Do not change unrelated files.
- Do not push directly to `main`.
- Use a dedicated branch for every change.
- Keep each PR focused on one purpose.
- Prefer 1 to 3 changed files per PR when possible.
- If requirements are unclear, stop and ask before editing.
- If a tool, API, or repository state appears stale or inconsistent, stop and report the issue instead of guessing.
- If an implementation conflicts with documentation, inspect the current code first, then propose the smallest documentation or code adjustment needed.
- Do not treat documentation as more authoritative than working source code when the two differ.
- Do not claim that checks passed unless they were actually run.
- If changes are made, create a PR.

---

## 3. Language Policy

- Repository docs and agent-facing implementation prompts should be written in English.
- Final responses to the project owner should be written in Japanese by default.
- Notion work logs must be written in Japanese.
- Code, commands, identifiers, branch names, commit messages, and PR titles may remain in English.

---

## 4. Hard Constraints

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

## 5. Responsibility Boundaries

| Area            | Owns                                                                  | Must not own                                                |
| --------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Native Core     | camera access, tracking, smoothing, MotionFrame output                | React UI, avatar rendering, cloud sync                      |
| Motion Protocol | shared types, dummy frames, schema compatibility                      | React, Three.js, Electron, OpenCV runtime logic             |
| Web Preview     | MotionFrame consumption, mapping, R3F rendering, OBS-friendly preview | native tracking, camera frame processing, desktop settings  |
| Electron App    | app shell, settings, calibration UI, native process lifecycle         | tracking algorithms, deep renderer internals, camera upload |

---

## 6. Documentation Maintenance Policy

Avoid duplicated instructions.

- Keep global agent rules here.
- Keep product scope in `REQUIREMENTS.md`.
- Keep architecture in `ARCHITECTURE.md`.
- Keep dependencies and commands in `TECH_STACK.md`.
- Keep native tracking behavior in `TRACKING_SPEC.md`.
- Keep MotionFrame schema in `MOTION_PROTOCOL.md`.
- Keep renderer mapping behavior in `MOTION_MAPPING.md`.
- Keep task flow in `ROADMAP.md`.
- Keep workflow, checks, PR, and reporting rules in `DEVELOPMENT_POLICY.md`.
- Keep copy-ready implementation prompts in `AI_IMPLEMENTATION_PROMPT.md`.

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

PR output must include:

- PR URL
- Summary of changes
- Changed files
- Any tests or checks run
- Any known limitations or follow-up items

If Notion is unavailable, provide a Japanese Notion-ready work log instead of claiming it was updated.
