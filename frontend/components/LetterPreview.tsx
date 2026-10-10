import { Fragment, type ReactNode } from "react"
import { ShieldCheck } from "lucide-react"

/** `**bold**`, `_italic_` and `<br>` inside one line of the letter. */
function inline(text: string): ReactNode[] {
  return text.split(/<br\s*\/?>/i).flatMap((segment, segmentIndex) => {
    const parts = segment.split(/(\*\*.+?\*\*|(?<![\w])_.+?_(?![\w]))/g).filter((part) => part !== "")
    const nodes: ReactNode[] = parts.map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>
      if (part.startsWith("_") && part.endsWith("_")) return <em key={index}>{part.slice(1, -1)}</em>
      return <Fragment key={index}>{part}</Fragment>
    })
    return segmentIndex === 0 ? nodes : [<br key={`br-${segmentIndex}`} />, ...nodes]
  })
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim())
const isSeparator = (row: string) => /^\|?[\s:|-]+\|?$/.test(row.trim())

/** The grievance letter rendered as a document: the same markdown subset the PDF uses. */
export function LetterPreview({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n")
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index].trim()
    if (line === "") {
      index += 1
      continue
    }
    if (line.startsWith("|")) {
      const rows: string[] = []
      while (index < lines.length && lines[index].trim().startsWith("|")) rows.push(lines[index++].trim())
      const [head, ...body] = rows.filter((row) => !isSeparator(row)).map(cells)
      if (head) {
        blocks.push(
          <div key={blocks.length} className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {head.map((cell, i) => (
                    <th key={i} className="border border-slate-300 bg-slate-100 px-2 py-1 text-left font-semibold">
                      {inline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, i) => (
                      <td key={i} className="border border-slate-300 px-2 py-1 align-top">
                        {inline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        )
      }
      continue
    }
    if (line.startsWith("- ")) {
      const items: string[] = []
      while (index < lines.length && lines[index].trim().startsWith("- ")) items.push(lines[index++].trim().slice(2))
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-1 pl-5">
          {items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }
    if (line.startsWith("## ") || line.startsWith("# ")) {
      blocks.push(
        <h3 key={blocks.length} className="pt-2 font-heading text-sm font-bold text-teal-800">
          {inline(line.replace(/^#+\s/, ""))}
        </h3>,
      )
    } else {
      blocks.push(<p key={blocks.length}>{inline(line)}</p>)
    }
    index += 1
  }

  return (
    <article
      data-testid="letter-preview"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-800 shadow-sm sm:p-8"
    >
      <header className="flex items-center gap-2 border-b border-teal-700/40 pb-2 font-heading font-bold text-teal-800">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        Claim Contest
      </header>
      {blocks}
      <footer className="border-t border-slate-200 pt-2 text-[11px] text-slate-500">
        Made with Claim Contest · self-help tool, not legal advice
      </footer>
    </article>
  )
}
