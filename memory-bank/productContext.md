# Product context

- **Users:** the policyholder or the family member handling the claim at discharge or after a rejection letter. Secondary: hospital billing desks, consumer groups, claim helpers.
- **Core user flow (step by step):**
  1. Start screen: pick a sample case (A–E) or upload documents (stretch).
  2. Live analysis: the agent's steps stream in (reading letter, finding clause, computing, verifying quote); the source clause is highlighted.
  3. Verdict board: summary card ("Rs X of Rs Y deducted looks recoverable"), one row per deduction with a status chip; clicking a row opens evidence (bill lines, verbatim policy clause, IRDAI rule, calculation steps, similar Ombudsman cases).
  4. Policy X-ray: room-rent cap, waiting periods, moratorium, with "regulation overrides this" badges.
  5. Clocks: cashless and discharge timelines with breach markers and the amount the insurer owes.
  6. Action centre: grievance letter (editable), local-language summary, escalation timeline with dates, download and calendar export.
  7. Compare: the same case answered by a plain chatbot, with its errors flagged.
- **Why it matters:** the rules protecting patients exist (MC24 paras 13, 15–17, 20) but enforcing them needs clause-level cross-reading of long, case-specific documents. Without the agent the options are a paid claim agency or giving up.
- **Trust rules (visible in the UI):** every quote is verified against its source; every rupee and date comes from deterministic code; the agent says "valid" when a deduction is valid; unverified rules are labelled "needs verification".
- **Design feel:** calm, trustworthy, fintech-like light theme; status colours green (valid) / amber (contestable) / blue (needs info); large numbers for money; Indian number formatting (Rs 1,10,000).
