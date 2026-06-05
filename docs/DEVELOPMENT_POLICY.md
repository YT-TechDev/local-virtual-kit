# Development Policy

## 1. Core Principles

- Design before implementation.
- Keep boundaries explicit.
- Prefer small PRs.
- Avoid unrelated edits.
- Make debugging easy.
- Keep camera processing local.
- Do not over-engineer v0.1.

## 2. Git Policy

- Never push directly to `main`.
- Use a dedicated branch for each task.
- Create a PR for changes.
- Report PR URL, changes, modified areas, verification, and next steps.

## 3. Branch Examples

```txt
docs/update-project-instructions
chore/setup-workspace
feat/motion-protocol
feat/basic-r3f-preview
feat/native-tracker-skeleton
feat/electron-shell
```

## 4. Verification Policy

Run available checks only. Do not claim success for commands that were not run.

Frontend/workspace:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Native later:

```bash
cmake -S native/tracker-core -B native/tracker-core/build
cmake --build native/tracker-core/build
```

If a script does not exist, say so clearly.

## 5. Notion Policy

At the end of each implementation task, update the Notion note named `Local Virtual Kit` or `LVK`.

The Notion log must be written in Japanese.

If Notion is unavailable, output a Japanese Notion-ready work log in the final report.

## 6. Documentation Policy

All `docs/*.md` agent/project documentation should be written in English for implementation accuracy.

Project-owner-facing GPT responses should be in Japanese by default.

## 7. Definition of Done

A task is done when:

- requested files are changed
- unrelated files are not changed
- available checks are run
- limitations are documented
- PR is created when changes exist
- Notion work log is updated or provided
- next step is clear
