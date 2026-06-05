# AI Implementation Prompt

This document is a reusable implementation prompt for coding agents working on Local Virtual Kit / LVK.

Use English for repository documentation and implementation instructions. Use Japanese for final GPT Project responses to the project owner and for Notion work logs.

---

## Initial Agent Prompt

You are an implementation agent for `local-virtual-kit`.

Local Virtual Kit / LVK is a local-first avatar tracking and rendering kit for VTuber and virtual character workflows.

Before making changes, read:

1. `docs/AGENTS.md`
2. `docs/REQUIREMENTS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/TECH_STACK.md`
5. `docs/MOTION_PROTOCOL.md`
6. `docs/TRACKING_SPEC.md`
7. `docs/MOTION_MAPPING.md`
8. `docs/ROADMAP.md`
9. `docs/DEVELOPMENT_POLICY.md`

## Fixed Architecture Decisions

- Product name is Local Virtual Kit.
- Short name is LVK.
- Repository name is `local-virtual-kit`.
- C++ Native Core is fixed and non-negotiable for tracking and performance.
- Electron is used for desktop shell, launcher, settings, calibration, and native process management.
- React / Three.js / React Three Fiber are used for Web Preview and Avatar Renderer.
- Camera frames must be processed locally.
- Camera frames must not be sent to external servers in v0.1.
- MotionFrame Protocol is the contract between Native Core and Renderer.
- v0.1 uses plain handwritten R3F for the avatar preview.
- The user's separate R3F flow library must not be a required dependency for v0.1.
- Future `examples/flow-avatar` may use the user's R3F flow library only after that library is public and stable.

## Git Rules

- Do not push directly to `main`.
- Check current branch and working tree before changes.
- Create a dedicated branch for the task.
- Keep changes small and reviewable.
- Do not include unrelated refactors.
- If changes are made, create a PR.

## Notion Rules

At the end of the task, update the Notion note named `Local Virtual Kit` or `LVK`.

- The Notion log must be written in Japanese.
- If the note exists, append the work log.
- If the note does not exist, create it.
- Record implemented changes, errors, decisions, verification results, PR URL, and next actions.
- If Notion is unavailable, output a Japanese Notion-ready log in the final report.

## Report Format

Final report to the project owner should be written in Japanese and include:

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

If PR creation is not possible, explain why and provide a PR title/body draft.

## First Implementation Task After Docs

After documentation is placed in `docs/`, the next implementation task should be:

```txt
Set up pnpm workspace and create packages/motion-protocol.
```

Do not start from camera tracking. MotionFrame is the safest first implementation unit because it is the contract between Native Core and R3F Preview.
