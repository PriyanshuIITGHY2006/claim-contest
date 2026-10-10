<task_objective>
Close a task: verify, record progress, commit, push, and mark it for review.
</task_objective>

<detailed_sequence_of_steps>
1. Run the full test suite for the touched area (backend: `cd backend && pytest -q`; frontend: `cd frontend && npx vitest run`). Show the output. If anything fails, stop and fix or report.
2. Run `git fetch origin && git diff --stat origin/main...HEAD` and confirm only files listed in the task were changed. Report any extra files.
3. Append one bullet to memory-bank/progress.md (Done: what was delivered; Next: follow-ups; Known issues).
4. Append one bullet to memory-bank/activeContext.md with the current state. Do not rewrite existing entries.
5. Create docs/cline-log/TASK-NN.md (one file per task, so parallel branches never conflict) with:
   - **Built:** what was delivered (1–2 lines)
   - **Cline usage:** Plan/Act, workflows, built-in commands and MCP tools used in this task
   - **Tests:** tests added / passing
   - **Checkpoint restores:** number (0 if none)
   - **Review fixes:** leave as "pending review"; the reviewer fills this in before merging
   Ask the user for the checkpoint count if you cannot tell from the conversation.
6. Commit with a conventional message (`feat(scope): summary`), no co-author trailers. Push the branch.
7. `git checkout main && git pull --rebase`, set the task's Status to `review` in tasks/BOARD.md, commit as `docs(board): TASK-NN ready for review`, push, then `git checkout` the task branch again.
8. Summarise: files changed, tests added, test results, open issues.
</detailed_sequence_of_steps>
