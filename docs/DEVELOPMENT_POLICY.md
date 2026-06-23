# Development Policy

This document defines workflow, verification, reporting, and documentation maintenance rules.

---

## 1. Core Principles

- Design before implementation.
- Keep boundaries explicit.
- Prefer small PRs.
- Avoid unrelated edits.
- Make debugging easy.
- Keep camera processing local.
- Do not over-engineer early-release work.
- Do not repeat completed setup work.

---

## 2. Git Policy

- Never push directly to `main`.
- Use a dedicated branch for each task.
- Create a PR for changes.
- Keep PRs small and reviewable.
- Do not mix docs cleanup, dependency changes, and feature work unless required.

Branch examples:

```txt
docs/streamline-agent-instructions
chore/setup-workspace
feat/motion-protocol
feat/basic-r3f-preview
feat/native-tracker-skeleton
feat/electron-shell
```

---

## 3. Change Policy

Before editing:

1. inspect the current branch and target branch state
2. read `docs/AGENTS.md`
3. read only task-relevant docs
4. identify the smallest useful change

During editing:

- preserve architecture boundaries
- avoid unrelated refactors
- avoid compressed unreadable implementation
- keep shared types explicit
- do not add dependencies unless needed for the current task

---

## 4. Verification Policy

Run available checks only. Do not claim success for commands that were not run.

For documentation-only changes, `pnpm format:check` is the minimum expected check unless the task says otherwise. Runtime and hardware checks may be marked not run when they are outside the change scope.

Local/manual validation claims require real local evidence. Do not claim OBS Browser Source, webcam/OpenCV, Electron GUI, OS camera permission, or native hardware validation from Codex Cloud, headless CI, or a machine without the required GUI, camera, permissions, native build, and application under test. Use `docs/LOCAL_RUNTIME_CHECKLIST.md` for local runtime evidence, `docs/OBS_BROWSER_SOURCE_GUIDE.md` for OBS Browser Source validation, and `docs/TRACKING_BACKEND_EVALUATION.md` for diagnostics evidence and backend evaluation notes.

Common workspace checks:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Targeted examples:

```bash
pnpm --filter @lvk/motion-protocol build
pnpm --filter @lvk/motion-protocol typecheck
pnpm --filter @lvk/web-preview build
pnpm --filter @lvk/web-preview typecheck
```

Current native and local transport checks:

```bash
cmake -S native/tracker-core -B native/tracker-core/build
cmake --build native/tracker-core/build
node tools/check-native-tracker-output.mjs native/tracker-core/build/lvk-tracker-core
pnpm test:motion-ws-bridge
```

Use targeted smoke checks when they match the change. If a script does not exist, say so clearly.

Manual Electron native runtime diagnostics UI checks:

- When diagnostic status text exists, verify the `Latest status` label is visible.
- When diagnostic error text exists, verify the `Latest error` label is visible.
- When diagnostic text exists, verify the local-only `Copy diagnostics` button and `Diagnostics preview` label are visible.
- Verify `Diagnostics preview` shows the exact local diagnostic text that `Copy diagnostics` copies.
- Verify `Copy diagnostics` copies only the local diagnostic text and does not send diagnostics over the network.
- After copying, verify copy feedback appears.
- After diagnostics change, verify prior copy feedback clears or becomes stale-hidden.
- When diagnostics controls are visible, verify `Refresh status` is visible and reuses the local runtime status refresh path without starting or stopping native processes.
- After a successful local runtime status refresh, verify the renderer-local `Last refreshed` timestamp appears as manual validation evidence only, not as cloud or network evidence.
- After a manual refresh, verify refresh feedback appears.
- After diagnostics change, verify prior refresh feedback clears or becomes stale-hidden.
- Keep validation local-only: do not send diagnostics over the network or add network-dependent evidence.
- For renderer/settings-only validation of runtime settings failures, trigger settings load/save failure handling and verify a visible `Settings error` label appears, the settings/configuration error styling is visually distinct from native pipeline/runtime diagnostics, the message is announced with alert semantics, and optional detail text appears only when it differs from the summary.
- Treat runtime settings error validation as local renderer/settings evidence only; do not claim native pipeline, camera, hardware, or OBS behavior unless that behavior was actually exercised in the Electron runtime.
- For Electron native runtime lifecycle controls, manually verify local-only lifecycle expectations without duplicating checker-level implementation details: start controls are disabled while the native runtime is busy or a lifecycle action is pending; the stop control is enabled only when the native tracker or motion bridge is starting/running and no action is pending; starting or stopping clears stale pipeline errors before showing pending lifecycle status feedback; and the pending lifecycle message is visible and announced with status semantics.
- For successful Electron native runtime lifecycle actions, verify renderer-local status feedback such as `Native runtime started.` after start and `Native runtime stopped.` after stop; this success feedback should not appear while a lifecycle action is pending, and stale feedback should disappear when the relevant native tracker status changes.
- For Electron native preview open requests, verify renderer-local pending feedback such as `Opening native preview...` is visible and announced with status semantics while an open request is pending, and preview open controls are disabled during that pending state to avoid duplicate open attempts.
- For successful Electron native preview opens, verify renderer-local status feedback such as `Native preview opened.` remains the expected success state, is visible, and is announced with status semantics; stale preview-open feedback should disappear when the relevant native tracker status changes or another lifecycle action starts.
- Treat native runtime lifecycle controls, preview-open pending feedback, and preview-open success feedback validation as local Electron UI evidence only. These checks do not imply camera, hardware, OBS Browser Source, Native Core tracking, or frame-processing behavior unless those paths were actually exercised.

---

## 5. Documentation Policy

Use documentation as source-of-truth, not as a prompt dump.

Rules:

- Keep `docs/AGENTS.md` short and global.
- Put product scope only in `REQUIREMENTS.md`.
- Put system boundaries only in `ARCHITECTURE.md`.
- Put technology/package/dependency rules only in `TECH_STACK.md`.
- Put native tracking output intent only in `TRACKING_SPEC.md`.
- Put MotionFrame schema only in `MOTION_PROTOCOL.md`.
- Put renderer mapping rules only in `MOTION_MAPPING.md`.
- Put sequencing only in `ROADMAP.md`.
- Put workflow/reporting/checks only in this file.
- Put reusable copy-ready prompts only in `AI_IMPLEMENTATION_PROMPT.md`.

Avoid:

- fixed stale "next task" instructions
- duplicating the same architecture paragraph in every file
- telling agents to read every document for every task
- embedding long coding prompts inside design docs
- adding fields to docs that do not exist in current code

---

## 6. PR Body Policy

A PR body should include:

```txt
## Summary
- ...

## Changes
- ...

## Verification
- [ ] command — result or reason not run

## Notes
- ...

## Notion
- updated, or Notion-ready log provided
```

---

## 7. Final Report Format

Final responses to the project owner should be written in Japanese and include:

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

---

## 8. Notion Policy

At the end of each implementation task, update the Notion note named `Local Virtual Kit` or `LVK` when available.

The Notion log must be written in Japanese.

Record:

- implemented changes
- errors
- decisions
- verification results
- PR URL
- next actions

If Notion is unavailable, output a Japanese Notion-ready work log in the final report.

---

## 9. Definition of Done

A task is done when:

- requested files are changed
- unrelated files are not changed
- available checks are run or honestly marked as not run
- limitations are documented
- PR is created when changes exist
- Notion work log is updated or provided
- next step is clear
