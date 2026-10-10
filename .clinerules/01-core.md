# Core rules (apply to every task)

## Scope
- Work only on the files listed in the current task file (`tasks/TASK-*.md`). If another file must change, stop and say why first.
- Do not refactor, rename or reformat code outside the task's scope.
- Do not add dependencies unless the task allows it. If one is needed, name it and explain why before installing.

## Tests first
- For any logic (functions, endpoints, state changes), write or update tests **before** the implementation.
- A task is done only when every acceptance test in the task file passes. Run the tests and show the output.
- Do not delete or weaken a failing test to make it pass.

## Code
- Prefer small, pure functions with explicit inputs and outputs.
- Type everything: Python type hints plus pydantic models; TypeScript in strict mode.
- Handle errors explicitly; never swallow exceptions silently.
- No dead code, no commented-out blocks, no TODOs without a task reference.
- Do not add a comment for every line. Comment only to explain non-obvious *why*, never to restate what the code does.

## Secrets and safety
- Never hard-code API keys, tokens or passwords. Read them from environment variables; document new ones in `.env.example`.
- Read and validate environment variables once, in one settings module, at startup. A missing required variable fails immediately with a clear message.
- Never commit `.env`.
- Do not run destructive commands (`rm -rf`, `git push --force`, dropping databases) without explicit confirmation.

## LLM / agent features (if the product uses AI)
- Build agent features on the Cline SDK (`@cline/sdk`); see `docs/CLINE_SDK.md`.
- All model and agent calls go through one module (the LLM client). Nothing else imports the SDK.
- Provider, model and key come from `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`; never hard-code provider or model names.
- The LLM client runs on the server only: in Next.js it starts with `import "server-only"` and is called only from route handlers or server actions. Never prefix `LLM_*` variables with `NEXT_PUBLIC_`.
- Set `toolPolicies` explicitly for every tool. Unit-test each custom tool's `execute` without calling a model.
- Request structured output wherever the result is parsed by code.

## When finished
- Summarise: files changed, tests added, test results, any open issues.
- Update `memory-bank/progress.md` (what was done, what is next).
