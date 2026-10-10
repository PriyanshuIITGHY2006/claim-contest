<task_objective>
Start a task from tasks/ safely: claim it, branch, load context, agree a plan before editing code.
</task_objective>

<detailed_sequence_of_steps>
1. Ask which task number to start (use ask_followup_question) unless it was given.
2. Run `git checkout main && git pull --rebase`.
3. Read `tasks/BOARD.md`. If the task is claimed by someone else, stop and report.
4. Set the task's Owner (ask the user's name if unknown) and Status `in-progress` in `tasks/BOARD.md`; commit `docs(board): claim TASK-NN` and push to main.
5. Create the branch: `git checkout -b task-NN-short-name`; record it on the board row.
6. Read memory-bank/projectbrief.md, systemPatterns.md, techContext.md, progress.md, and tasks/TASK-NN.md.
7. Present a short plan: files to change, tests to write first, risks. Wait for the user to approve before writing code.
8. Write the acceptance tests first, run them (they should fail), then implement until they pass.
</detailed_sequence_of_steps>
