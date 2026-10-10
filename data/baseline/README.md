# Plain-chatbot baseline

The compare view (TASK-12) shows how a general chatbot answers the same case, next to our verdicts. The agent serves these files at `GET /baseline/{case_id}`. It returns 404 when a file is missing and 400 for ids outside `[A-Za-z0-9_-]`.

## File format: `data/baseline/<case_id>.json`

```json
{
  "answer_markdown": "The chatbot's answer, verbatim, as Markdown.",
  "errors": [
    { "claim": "What the chatbot said", "why_wrong": "Why it is wrong, with the deduction id and the rule or clause, e.g. D3 / associated medical expenses definition" }
  ]
}
```

## How to record one
1. Open a fresh chat with a general-purpose chatbot (no tools, no files, no system prompt). Note the date.
2. Paste the case as a user would describe it: the settlement letter text, the deductions with their labels and amounts, the room category and eligible room rent, and the policy name. Use only fields a policyholder has. Never paste `expected`, which is the answer key.
3. Ask: "Are these deductions correct under my policy and IRDAI rules? How much can I recover, and what should I do?"
4. Copy the answer verbatim into `answer_markdown`. Do not edit or shorten it.
5. Compare it with the case's expected verdicts. Add one `errors` entry per wrong amount, wrong verdict, invented or misquoted clause, missed regulation override, or wrong deadline. Always write the deduction id (e.g. `D3`) in `claim` or `why_wrong` when the error is about a deduction: the compare view uses it to show the error next to that verdict, and errors without one appear under "Other errors".
6. Commit as `data: baseline for case_a (<date>)`. Do not name the chatbot or model in the file or the commit message; the project's files and history stay free of product names.

Cases A–C are recorded first (demo owner). All data is synthetic.
