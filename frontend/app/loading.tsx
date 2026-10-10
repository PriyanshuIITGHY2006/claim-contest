import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-16" aria-busy="true" aria-label="Loading">
      <div className="space-y-5 pt-6">
        <Skeleton className="h-12 w-full max-w-2xl rounded-xl" />
        <Skeleton className="h-12 w-3/4 max-w-xl rounded-xl" />
        <Skeleton className="h-5 w-full max-w-lg rounded-md" />
        <Skeleton className="h-11 w-44 rounded-md" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} className="h-40 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <Skeleton key={item} className="h-44 rounded-2xl" />
        ))}
      </div>
    </div>
  )
}
