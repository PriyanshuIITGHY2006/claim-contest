<task_objective>
Turn the released problem statement into project context, architecture and a task list.
</task_objective>

<detailed_sequence_of_steps>
1. Ask the user to paste the problem statement if it is not already in memory-bank/projectbrief.md.
2. Fill memory-bank/projectbrief.md (goal, must-haves, out of scope, demo success criteria) and productContext.md (users, core flow).
3. Check the plan against the judging criteria before designing:
   - Creativity and innovation: state the one idea that makes this different from an obvious solution.
   - Technical depth: identify the hard core of the system (algorithm, agent loop, data pipeline, verification) and make it a first-class component with tests.
   - Cline SDK (bonus): include at least one product feature built on `@cline/sdk` (agent with custom tools) — see docs/CLINE_SDK.md.
   - Cline used in depth: plan tasks so that rules, memory bank, workflows, Plan/Act, checkpoints and MCP are all exercised and logged.
4. Propose the architecture in memory-bank/systemPatterns.md: components, data model, and the exact interfaces between modules (endpoints with request/response shapes, shared types). Ask the user to approve.
5. Fill memory-bank/techContext.md (run and test commands).
6. Break the build into 8–12 tasks, ordered so independent tasks can run in parallel. Create tasks/TASK-NN.md from TEMPLATE.md, each with files, interface and acceptance tests. The task that adds the LLM client lists `@cline/sdk` (exact pinned version) and `zod` as allowed dependencies.
7. Add every task to tasks/BOARD.md with status `todo`. Commit `docs: kickoff — brief, architecture, tasks` and push to main.
</detailed_sequence_of_steps>
