"use client"

import { motion, useReducedMotion } from "framer-motion"

interface RecoverableBarProps {
  recoverable: number
  deducted: number
}

/** Recoverable share of the deducted amount as a whole percent, kept within 0–100. */
function sharePercent(recoverable: number, deducted: number): number {
  if (deducted <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((recoverable / deducted) * 100)))
}

export function RecoverableBar({ recoverable, deducted }: RecoverableBarProps) {
  const reduceMotion = useReducedMotion()
  const percent = sharePercent(recoverable, deducted)

  return (
    <div className="space-y-1.5">
      <div
        role="progressbar"
        aria-label="Share of the deducted amount that looks recoverable"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-3 w-full overflow-hidden rounded-full bg-slate-100"
      >
        {/* The width is the real value; the mount animation only scales it in from the left. */}
        <motion.div
          data-testid="recoverable-bar-fill"
          className="h-full origin-left rounded-full bg-gradient-to-r from-teal-600 to-emerald-500"
          style={{ width: `${percent}%` }}
          initial={reduceMotion ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.8, ease: "easeOut" }}
        />
      </div>
      <p className="text-xs tabular-nums text-slate-500">{percent}% of the deducted amount looks recoverable</p>
    </div>
  )
}
