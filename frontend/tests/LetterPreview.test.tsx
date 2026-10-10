import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LetterPreview } from "@/components/LetterPreview"

const LETTER = `To: The Grievance Redressal Officer

## Details
- Policyholder / patient: Ananya Bora

## Contested deductions
| Deduction | Amount recoverable | Verbatim quote |
|---|---|---|
| D1 | Rs 15,000.00 | "first"<br>"second" |

**Total recoverable: Rs 15,000.00**

_Prepared by the policyholder using a self-help tool. Not legal advice._`

describe("LetterPreview", () => {
  it("renders the letter as a formatted document, not raw markdown", () => {
    render(<LetterPreview markdown={LETTER} />)
    const preview = screen.getByTestId("letter-preview")

    expect(screen.getByRole("heading", { name: "Details" })).toBeTruthy()
    expect(screen.getByRole("listitem").textContent).toBe("Policyholder / patient: Ananya Bora")
    expect(screen.getByRole("columnheader", { name: "Deduction" })).toBeTruthy()
    expect(screen.getByRole("cell", { name: "D1" })).toBeTruthy()
    expect(preview.querySelector("strong")?.textContent).toBe("Total recoverable: Rs 15,000.00")
    expect(preview.querySelector("em")?.textContent).toContain("Prepared by the policyholder")
    expect(preview.textContent).not.toContain("##")
    expect(preview.textContent).not.toContain("|---|")
    expect(preview.textContent).not.toContain("<br>")
    expect(preview.textContent).toContain("Made with Claim Contest")
  })
})
