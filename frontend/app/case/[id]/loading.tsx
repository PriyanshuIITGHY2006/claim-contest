import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading the case">
      <Skeleton className="h-5 w-24 rounded-md" />
      <div className="space-y-3">
        <Skeleton className="h-10 w-full max-w-2xl rounded-xl" />
        <Skeleton className="h-4 w-full max-w-md rounded-md" />
      </div>
      <Skeleton className="h-10 w-72 max-w-full rounded-xl" />
      <Skeleton className="h-56 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  )
}
