"""Render a grievance letter (the agent's markdown) as a branded A4 PDF with PyMuPDF.

Only the markdown the letter builder produces is supported: ``#``/``##``
headings, ``-`` lists, pipe tables (with ``<br>`` inside cells), ``**bold**``,
``_italic_`` and plain paragraphs. All text is HTML-escaped first.
"""

from __future__ import annotations

import html
import io
import re

import pymupdf

BRAND = "Claim Contest"
FOOTER = "Made with Claim Contest · self-help tool, not legal advice"
_TEAL = (0.059, 0.463, 0.431)

_CSS = """
body { font-family: sans-serif; font-size: 10pt; color: #0f172a; }
h1 { font-size: 15pt; color: #0f766e; margin-bottom: 6pt; }
h2 { font-size: 11.5pt; color: #0f766e; margin-top: 12pt; margin-bottom: 4pt; }
p { margin-top: 3pt; margin-bottom: 3pt; line-height: 1.35; }
li { margin-bottom: 2pt; }
table { border-collapse: collapse; width: 100%; margin-top: 4pt; }
th { background-color: #e2e8f0; font-weight: bold; }
th, td { border: 1px solid #94a3b8; padding: 3pt; font-size: 8.5pt; vertical-align: top; }
"""

_SEPARATOR_ROW = re.compile(r"^\|?[\s:|-]+\|?$")


def _inline(text: str) -> str:
    out = html.escape(text.strip())
    out = out.replace("&lt;br&gt;", "<br/>")
    out = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", out)
    return re.sub(r"(?<![\w])_(.+?)_(?![\w])", r"<i>\1</i>", out)


def _cells(row: str) -> list[str]:
    return [cell.strip() for cell in row.strip().strip("|").split("|")]


def markdown_to_html(markdown: str) -> str:
    """HTML for the subset of markdown used in grievance letters."""
    lines = markdown.splitlines()
    out: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index].rstrip()
        stripped = line.strip()
        if not stripped:
            index += 1
            continue
        if stripped.startswith("|"):
            rows: list[str] = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                rows.append(lines[index].strip())
                index += 1
            body = [_cells(row) for row in rows if not _SEPARATOR_ROW.match(row)]
            if body:
                head = "".join(f"<th>{_inline(cell)}</th>" for cell in body[0])
                rest = "".join(
                    "<tr>" + "".join(f"<td>{_inline(cell)}</td>" for cell in row) + "</tr>" for row in body[1:]
                )
                out.append(f"<table><tr>{head}</tr>{rest}</table>")
            continue
        if stripped.startswith("- "):
            items: list[str] = []
            while index < len(lines) and lines[index].strip().startswith("- "):
                items.append(f"<li>{_inline(lines[index].strip()[2:])}</li>")
                index += 1
            out.append(f"<ul>{''.join(items)}</ul>")
            continue
        if stripped.startswith("## "):
            out.append(f"<h2>{_inline(stripped[3:])}</h2>")
        elif stripped.startswith("# "):
            out.append(f"<h1>{_inline(stripped[2:])}</h1>")
        else:
            out.append(f"<p>{_inline(stripped)}</p>")
        index += 1
    return "\n".join(out)


def render_letter_pdf(title: str, markdown: str) -> bytes:
    """A4 PDF of the letter with a brand header and a footer on every page."""
    story = pymupdf.Story(html=f"<h1>{_inline(title)}</h1>{markdown_to_html(markdown)}", user_css=_CSS)
    buffer = io.BytesIO()
    writer = pymupdf.DocumentWriter(buffer)
    page_rect = pymupdf.paper_rect("a4")
    content = page_rect + (54, 72, -54, -64)
    more = True
    while more:
        device = writer.begin_page(page_rect)
        more, _ = story.place(content)
        story.draw(device)
        writer.end_page()
    writer.close()

    with pymupdf.open(stream=buffer.getvalue(), filetype="pdf") as pdf:
        total = pdf.page_count
        for number, page in enumerate(pdf, start=1):
            page.insert_text((54, 44), BRAND, fontsize=13, fontname="hebo", color=_TEAL)
            page.draw_line((54, 52), (page_rect.width - 54, 52), color=_TEAL, width=0.8)
            page.draw_line((54, page_rect.height - 46), (page_rect.width - 54, page_rect.height - 46), color=(0.8, 0.8, 0.8), width=0.5)
            page.insert_text((54, page_rect.height - 32), FOOTER, fontsize=8, color=(0.35, 0.35, 0.35))
            label = f"Page {number} of {total}"
            width = pymupdf.get_text_length(label, fontsize=8)
            page.insert_text((page_rect.width - 54 - width, page_rect.height - 32), label, fontsize=8, color=(0.35, 0.35, 0.35))
        return pdf.tobytes()
