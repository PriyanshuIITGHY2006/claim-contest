import { CircleAlert, CircleCheck, CircleHelp, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { VerdictStatus } from "@/lib/api"

const CHIP: Record<VerdictStatus, { label: string; className: string; Icon: LucideIcon }> = {
  valid: {
    label: "Valid",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    Icon: CircleCheck,
  },
  contestable: {
    label: "Contestable",
    className: "border-amber-200 bg-amber-50 text-amber-800",
    Icon: CircleAlert,
  },
  needs_info: {
    label: "Needs info",
    className: "border-sky-200 bg-sky-50 text-sky-800",
    Icon: CircleHelp,
  },
}

export function StatusChip({ status }: { status: VerdictStatus }) {
  const { label, className, Icon } = CHIP[status]
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 whitespace-nowrap rounded-full px-2.5 font-medium", className)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Badge>
  )
}
