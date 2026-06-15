# Claude Code Instructions

@docs/AGENTS.md

This repository uses `docs/AGENTS.md` as the shared source of truth for AI and coding agents. Keep this file small and Claude-specific.

## Claude Code

- Follow the imported `docs/AGENTS.md` rules first.
- Before editing, inspect the current branch, relevant source files, and task-specific docs.
- Read only the focused docs required for the task; do not load every `docs/*.md` file by default.
- Use a dedicated branch and keep each PR small and reviewable.
- Prefer explicit planning before multi-file changes, Native Core work, Electron work, webcam/OpenCV work, OBS validation, MotionFrame protocol changes, or cross-package integration.
- Do not perform unrelated refactors or broad documentation rewrites.
- Do not add dependencies, telemetry, analytics, cloud upload, or new network behavior unless the project owner explicitly requests it.
- Keep LVK local-first. Camera frames must stay local during early local-first releases.
- Do not claim checks or local/manual validation unless they were actually performed in the required environment.
- Use `CLAUDE.local.md` for personal machine-specific notes, sandbox paths, or local preferences. Do not commit secrets or private local setup details.
