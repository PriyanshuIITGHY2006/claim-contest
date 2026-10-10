import { describe, expect, it } from "vitest"
import { formatINR } from "@/lib/format"

describe("formatINR", () => {
  it("groups whole rupees the Indian way", () => {
    expect(formatINR(110000)).toBe("₹1,10,000")
  })

  it("keeps two decimals when the amount has paise", () => {
    expect(formatINR(40719.76)).toBe("₹40,719.76")
  })

  it("formats zero", () => {
    expect(formatINR(0)).toBe("₹0")
  })

  it("groups crores", () => {
    expect(formatINR(151000000)).toBe("₹15,10,00,000")
  })

  it("puts the minus sign before the rupee symbol", () => {
    expect(formatINR(-500)).toBe("-₹500")
  })

  it("rounds floating-point noise to paise", () => {
    expect(formatINR(0.1 + 0.2)).toBe("₹0.30")
  })
})
