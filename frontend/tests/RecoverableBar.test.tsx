import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RecoverableBar } from "@/components/RecoverableBar"

function barWidth(): string {
  return screen.getByTestId("recoverable-bar-fill").style.width
}

describe("RecoverableBar", () => {
  it("fills about 41% when 40719.76 of 98969.76 is recoverable", () => {
    render(<RecoverableBar recoverable={40719.76} deducted={98969.76} />)

    expect(barWidth()).toBe("41%")
  })

  it("exposes the share to assistive technology", () => {
    render(<RecoverableBar recoverable={40719.76} deducted={98969.76} />)

    const bar = screen.getByRole("progressbar")
    expect(bar.getAttribute("aria-valuenow")).toBe("41")
    expect(bar.getAttribute("aria-valuemin")).toBe("0")
    expect(bar.getAttribute("aria-valuemax")).toBe("100")
  })

  it("never fills past 100% when the recoverable amount exceeds the deducted one", () => {
    render(<RecoverableBar recoverable={120000} deducted={110000} />)

    expect(barWidth()).toBe("100%")
  })

  it("is empty when nothing looks recoverable", () => {
    render(<RecoverableBar recoverable={0} deducted={80700} />)

    expect(barWidth()).toBe("0%")
  })

  it("is empty, not NaN, when nothing was deducted", () => {
    render(<RecoverableBar recoverable={0} deducted={0} />)

    expect(barWidth()).toBe("0%")
  })
})
