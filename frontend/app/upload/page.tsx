import { TriangleAlert } from "lucide-react"
import { UploadZone } from "@/components/UploadZone"
import { Card, CardContent } from "@/components/ui/card"
import { ApiError, listDocuments, type DocumentSummary } from "@/lib/api"

export const dynamic = "force-dynamic"

export default async function UploadPage() {
  let policies: DocumentSummary[] = []
  let failure: string | null = null
  try {
    policies = (await listDocuments()).filter((document) => document.kind === "policy")
  } catch (error) {
    failure = error instanceof ApiError ? error.message : "Could not load the list of policies."
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight text-slate-900">
          Check your own claim
        </h1>
        <p className="max-w-2xl text-slate-600">
          Upload the settlement letter and the hospital bill (text PDFs), choose your policy and check the
          details we read. Nothing is analysed until you confirm them.
        </p>
      </section>

      {failure && (
        <Card role="alert" className="border-rose-200 bg-rose-50">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-rose-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {failure}
          </CardContent>
        </Card>
      )}

      <UploadZone policies={policies} />
    </div>
  )
}
