# TASK-16: Upload your own claim — PDF upload, pre-fill, confirm, analyse

## Goal
A user uploads their settlement letter and hospital bill (text PDFs), picks their policy, checks the pre-filled details in a form, and gets a case that the same analysis runs on. Reliable for a live demo: nothing is analysed until the user confirms the details.

## Files to touch
- `backend/app/services/ingest.py` (create): PDF text extraction (PyMuPDF) and pattern-based pre-fill
- `backend/app/services/cases.py` (modify): uploaded cases stored in SQLite and served by the existing `/cases` endpoints alongside the sample cases
- `backend/app/db.py` (modify: add a `cases` table — `case_id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL`)
- `backend/app/routes/upload.py` (create), register in `backend/app/main.py` (modify)
- `backend/app/models/schemas.py` (modify: `CaseDraft`, `NewCase` request models)
- `backend/requirements.txt` (modify: add `python-multipart`)
- `memory-bank/systemPatterns.md` (modify first: the three endpoints below)
- `frontend/app/upload/page.tsx` (create), `frontend/components/UploadZone.tsx`, `frontend/components/CaseConfirmForm.tsx` (create)
- `frontend/lib/api.ts` (modify: `uploadDocuments`, `createCase`)
- `frontend/app/page.tsx` (modify: a prominent "Check your own claim" button linking to `/upload`)
- `backend/tests/test_upload.py`, `frontend/tests/CaseConfirmForm.test.tsx` (create)

## Interface
- `POST /cases/upload` (multipart: `settlement_pdf`, `bill_pdf`, form field `doc_id`) → `CaseDraft` (not stored):
  `{ doc_id, claimed?, approved?, deductions: Deduction[], bill_lines: BillLine[], letter_text, warnings: string[] }`.
  - Text via PyMuPDF. A PDF with no text layer → 422 "Scanned documents are not supported yet; please upload a text PDF".
  - `doc_id` must be one of the registered policies (`/documents` kind `policy`), else 422.
  - Pre-fill with simple patterns only (no model calls): amounts written as `Rs`/`₹`/`INR` + number (Indian grouping allowed); a bill line = a text line ending in an amount, `particulars` = the text before it, `category` guessed from keywords (room, nursing, consultation/fee → professional_fee, OT/theatre → ot, pharmacy/medicine → pharmacy, consumable → consumables, implant/stent → implant, test/lab/scan/x-ray → diagnostics, else non_medical); deductions = lines in the letter containing "deduct"/"disallow"/"not payable" with an amount. Every guess can be wrong; `warnings` lists what could not be found.
- `POST /cases` (`NewCase`: policy `doc_id` + schedule fields, patient name/age, admission fields, confirmed `bill_lines`, `deductions`, `claimed`, `approved`, `letter_text`) → `{ case_id }`. Generates `case_id = "user_" + 8 hex chars`, `title` from the first deduction label, `synthetic_notice` = "Uploaded by the user", `expected = []`, `timeline` from the form (optional), `bill.total` = sum of lines, `settlement.total_deducted` = sum of deductions. Validates with the existing `Case` model; 422 on invalid input (e.g. a deduction referring to a non-existent line).
- `GET /cases` and `GET /cases/{id}` return uploaded cases too (uploaded ones after the samples, newest first).

## Frontend flow
1. `/upload`: two drop zones (settlement letter, hospital bill; PDF only, max 10 MB each), a policy select from `/documents` (kind `policy`), "Read my documents" button with a spinner.
2. `CaseConfirmForm`: editable tables for deductions (label, amount, linked bill lines) and bill lines (date, particulars, category select, rate, units, amount), inputs for claimed/approved, room rent per day and eligible room rent, inception date, patient name/age; warnings shown at the top; live totals; "Analyse my claim" disabled until totals are consistent (bill lines sum > 0, every deduction amount > 0).
3. Submit → `POST /cases` → redirect to `/case/<case_id>` (the existing case page starts the analysis).
4. Note under the button: "Your documents are processed on this server and not shared."

## Acceptance tests (no model calls)
1. Backend: a text PDF generated in the test with PyMuPDF (`fitz.open(); page.insert_text(...)`) containing three bill lines ending in amounts → draft with those three `bill_lines` and amounts.
2. Backend: a PDF with no text (an empty page) → 422 with the scanned-document message.
3. Backend: unknown `doc_id` → 422.
4. Backend: `POST /cases` with a valid `NewCase` → `case_id` starting `user_`; `GET /cases/{id}` returns it with `bill.total` = sum of lines; `GET /cases` includes it after the five samples.
5. Backend: `POST /cases` with a deduction pointing to an unknown line id → 422.
6. Frontend: `CaseConfirmForm` disables "Analyse my claim" while there are no bill lines, enables it after adding one, and recomputes totals when an amount is edited.

## Notes
- Uploaded cases have no answer key, so the **scripted** agent returns no verdicts for them; they are analysed by the real agent (`AGENT_MODE=llm`, TASK-08). Show "Real analysis requires the live agent" on the case page when the agent is in scripted mode and the case id starts with `user_` (read `/health` of the agent if it exposes the mode; otherwise skip this note).
- Store uploaded PDFs nowhere: read them in memory, keep only the confirmed case JSON.

## Do not
- touch files not listed above
- call any model from the backend
- add dependencies other than `python-multipart`
