# Project brief

- **Problem statement:** Solve a real-world problem using AI (Cline AI Builders Hackathon, IIT Guwahati, 8-hour build).
- **Problem we chose:** Indian health-insurance policyholders receive settlement letters that cut or reject claims with one-line labels ("proportionate deduction", "non-payable items", "PED non-disclosure"). They cannot check those labels against a 40–80 page policy, an itemised bill and IRDAI's rules, so they pay the gap. FY24 (press reports of IRDAI data, to verify): about Rs 15,100 crore disallowed and Rs 10,937 crore repudiated.
- **Goal of the build:** A claim-contest agent. The user gives a case (settlement letter, bill, policy, admission details); the agent gives a verdict per deduction (valid / contestable / needs info) with verbatim clause citations and the exact recoverable amount, then drafts the grievance and the escalation plan.
- **Must-have features (demo-critical):**
  1. Deduction audit (hero): per-deduction verdict, verified verbatim citations, amounts from calculators only.
  2. Regulation-override detection: e.g. policy says 8-year moratorium, MC24 para 13 says 60 months.
  3. TAT clocks: 1-hour cashless and 3-hour discharge breaches, with the amount the insurer must bear.
  4. Grievance draft + escalation timeline (insurer GRO → Ombudsman within one year), plain-language local summary.
  5. Precedent finder over the Ombudsman award books in `data/`.
  6. Live agent timeline in the UI and a side-by-side with a plain chatbot answer.
- **Out of scope (today):** OCR of scanned bills, real user uploads beyond the sample cases (stretch), filing with insurers, payments, accounts, WhatsApp.
- **Success = what the demo must show:** On sample case A the agent finds Rs 40,719.76 recoverable with verified clause quotes, marks the valid deductions valid, and drafts a grievance; on case B it overrides the policy's 8-year moratorium; on case C (control) it says the rejection is valid.
- **Positioning:** self-help tool. The user reviews, signs and files. Not legal advice. No success fee. Synthetic data only in the demo.
