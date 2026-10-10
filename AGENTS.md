# Team rules for agents working on this repo

Several people and agents work on this repo in parallel. Coding conventions are in `.clinerules/`; this file covers coordination.

## Task ownership — `tasks/BOARD.md`
- Claim a task before starting (Owner + `in-progress`), commit and push that change first.
- Never work on a task someone else has claimed.
- When done, set status to `review` or `done`.
- New task: copy `tasks/TEMPLATE.md` to the next free `TASK-NN.md` and add a board row in the same commit.

## Branches and commits
- One branch per task: `task-NN-short-name`. Only `tasks/BOARD.md` edits and the one-time `/kickoff.md` commit go directly to `main`.
- `git pull --rebase` before starting and before pushing.
- Conventional messages: `feat(api): …`, `fix(ui): …`, `test: …`, `docs: …`. No co-author or "generated with" trailers.
- Merge to `main` only when the task's acceptance tests pass. Resolve conflicts by keeping both sides' intent.

## Review and merge
- A task in `review` is reviewed by someone other than its implementer.
- The reviewer pulls the task branch, runs its tests, makes small fixes on that branch, and records them under **Review fixes** in `docs/cline-log/TASK-NN.md` (or "none").
- When tests pass, the reviewer merges the branch to `main` and sets the task to `done` on the board. Larger problems go back to the implementer or become a new task.

## Shared files
- `memory-bank/progress.md` and `activeContext.md`: append only, one bullet per finished task.
- Interfaces between modules (API routes, data models, shared types) are defined in `memory-bank/systemPatterns.md`. Change them only by updating that file first and telling the team.
- `.clinerules/`, `AGENTS.md`, `systemPatterns.md`, `techContext.md`: change only after team agreement.

## Safety
- No secrets in code or commits; use `.env` (see `.env.example`). Credentials are named generically (`LLM_API_KEY`, `LLM_MODEL`).
- No `git push --force` on `main`, no history rewrites, no deleting others' branches.
