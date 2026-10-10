/**
 * Formats rupees with Indian digit grouping (₹1,10,000). Whole amounts show no
 * decimals; anything with paise shows exactly two.
 */
export function formatINR(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`formatINR needs a finite number, received ${amount}`)
  }

  const paise = Math.round(Math.abs(amount) * 100)
  const digits = paise % 100 === 0 ? 0 : 2
  const grouped = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(paise / 100)

  return `${amount < 0 && paise > 0 ? "-" : ""}₹${grouped}`
}
