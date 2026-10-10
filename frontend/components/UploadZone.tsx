"use client"

import { useId, useRef, useState, type DragEvent } from "react"
import { useRouter } from "next/navigation"
import { FileText, LoaderCircle, Upload } from "lucide-react"
import { CaseConfirmForm } from "@/components/CaseConfirmForm"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  ApiError,
  createCase,
  uploadDocuments,
  type CaseDraft,
  type DocumentSummary,
  type NewCase,
} from "@/lib/api"

const MAX_BYTES = 10 * 1024 * 1024

/** Why a file cannot be used, or null when it is fine. Mirrors the backend's checks. */
export function fileProblem(file: File): string | null {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  if (!isPdf) return "Only PDF files are accepted"
  if (file.size > MAX_BYTES) return "The file is larger than 10 MB"
  return null
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detail ?? error.message
  return fallback
}

function DropZone({
  label,
  hint,
  file,
  onFile,
}: {
  label: string
  hint: string
  file: File | null
  onFile: (file: File | null) => void
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  function accept(candidate: File | undefined) {
    if (!candidate) return
    const found = fileProblem(candidate)
    setProblem(found)
    onFile(found ? null : candidate)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files[0])
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-900">{label}</p>
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-slate-300 bg-white"
        }`}
      >
        {file ? (
          <FileText className="h-8 w-8 text-primary" aria-hidden="true" />
        ) : (
          <Upload className="h-8 w-8 text-slate-400" aria-hidden="true" />
        )}
        <p className="text-sm text-slate-600">{file ? file.name : hint}</p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          aria-label={label}
          onChange={(event) => accept(event.target.files?.[0])}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          {file ? "Choose another file" : "Choose a PDF"}
        </Button>
        {problem && (
          <p role="alert" className="text-sm text-rose-700">
            {problem}
          </p>
        )}
      </div>
    </div>
  )
}

export function UploadZone({ policies }: { policies: DocumentSummary[] }) {
  const router = useRouter()
  const [settlement, setSettlement] = useState<File | null>(null)
  const [bill, setBill] = useState<File | null>(null)
  const [docId, setDocId] = useState(policies[0]?.doc_id ?? "")
  const [reading, setReading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<CaseDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function readDocuments() {
    if (!settlement || !bill || !docId) return
    setReading(true)
    setError(null)
    try {
      setDraft(await uploadDocuments(settlement, bill, docId))
    } catch (failure) {
      setError(describe(failure, "Could not read the documents. Please try again."))
    } finally {
      setReading(false)
    }
  }

  async function confirm(body: NewCase) {
    setCreating(true)
    setError(null)
    try {
      const { case_id } = await createCase(body)
      router.push(`/case/${case_id}`)
    } catch (failure) {
      setError(describe(failure, "Could not save your case. Please try again."))
      setCreating(false)
    }
  }

  if (draft) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            Check what we read from your documents, fix anything that is wrong, then analyse.
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={creating}>
            Start over
          </Button>
        </div>
        <CaseConfirmForm draft={draft} submitting={creating} error={error} onSubmit={confirm} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {policies.length === 0 && (
        <Card role="alert" className="border-rose-200 bg-rose-50">
          <CardContent className="p-4 text-sm text-rose-800">No policies are available right now.</CardContent>
        </Card>
      )}
      <div className="grid gap-6 sm:grid-cols-2">
        <DropZone
          label="Settlement letter"
          hint="Drop the insurer's letter here (text PDF, up to 10 MB)"
          file={settlement}
          onFile={setSettlement}
        />
        <DropZone
          label="Hospital bill"
          hint="Drop the itemised bill here (text PDF, up to 10 MB)"
          file={bill}
          onFile={setBill}
        />
      </div>

      <div className="max-w-md space-y-1">
        <label htmlFor="policy" className="text-sm font-medium text-slate-900">
          Your policy
        </label>
        <select
          id="policy"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={docId}
          onChange={(event) => setDocId(event.target.value)}
        >
          {policies.map((policy) => (
            <option key={policy.doc_id} value={policy.doc_id}>
              {policy.title}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <Card role="alert" className="border-rose-200 bg-rose-50">
          <CardContent className="p-4 text-sm text-rose-800">{error}</CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <Button type="button" size="lg" disabled={!settlement || !bill || !docId || reading} onClick={readDocuments}>
          {reading && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Read my documents
        </Button>
        <p className="text-sm text-slate-500">Your documents are processed on this server and not shared.</p>
      </div>
    </div>
  )
}
