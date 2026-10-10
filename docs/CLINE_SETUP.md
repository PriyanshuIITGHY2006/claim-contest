# Cline setup and workflow

## 1. One-time setup (each teammate)
- **Models:** enable separate Plan and Act models. Plan: a stronger reasoning model. Act: a cheaper coding model.
- **Checkpoints:** keep enabled (Settings) so any Act step can be rolled back.
- **Focus Chain:** keep enabled; Cline keeps a todo list for the task and re-reads it so long tasks don't drift.
- **Rules panel** (scale icon next to the model selector): confirm `.clinerules/*` and `AGENTS.md` are listed and enabled. `04-backend.md` and `05-frontend.md` are conditional and switch on automatically when matching files are in context.
- **MCP** (MCP Servers → Marketplace): install **Context7** (current library docs). Sequential Thinking is optional. Each MCP call costs tokens.

## 2. Commands to use
| Command | When |
|---|---|
| `/kickoff.md` | Once, after the problem statement is released |
| `/start-task.md` | Beginning of each task: claims it, branches, loads context, plans first |
| `/finish-task.md` | End of each task: tests, scope check, progress update, commit, push |
| `/deep-planning` | A large or unclear task: Cline investigates, writes `implementation_plan.md`, then starts a fresh implementation task |
| `/newtask` | The conversation is long or the phase changes: hands off to a fresh task with distilled context (cheaper) |
| `/smol` | Long debugging session you want to continue in the same task: compresses history |
| `/newrule` | You notice Cline repeating a mistake: turn the correction into a rule |

## 3. Per-task routine
1. New Cline task → `/start-task.md` → approve the plan (Plan mode) → switch to Act.
2. Tests first, then implementation; review each diff; restore a checkpoint if it goes wrong.
3. If Act mode starts looping on the same error twice, stop, switch to Plan, rethink.
4. `/finish-task.md`.

## 4. Keeping costs down
- One task per feature; use `/newtask` instead of letting a conversation grow.
- Mention exact files (`@path/to/file`) instead of letting Cline search the repo.
- Use the stronger model only in Plan mode or when Act is stuck.
