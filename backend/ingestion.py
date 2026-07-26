"""
Module 1: AI Data Ingestion
Extracts raw text out of whatever a user uploads, regardless of format,
so the rest of the pipeline (categorization, skill extraction, search)
can work off plain text while the ORIGINAL FILE is preserved untouched
on disk (see database.UPLOAD_DIR).
"""
import os
import re


def extract_text(filepath: str, file_ext: str) -> str:
    file_ext = file_ext.lower()
    try:
        if file_ext == ".pdf":
            return _extract_pdf(filepath)
        elif file_ext == ".docx":
            return _extract_docx(filepath)
        elif file_ext in (".txt", ".md"):
            with open(filepath, "r", errors="ignore") as f:
                return f.read()
        else:
            # Images / unsupported binary formats: no OCR in this prototype,
            # but the file is still stored and categorized from its filename.
            return ""
    except Exception as e:
        return ""


def _extract_pdf(filepath: str) -> str:
    from pypdf import PdfReader
    reader = PdfReader(filepath)
    text = []
    for page in reader.pages:
        try:
            text.append(page.extract_text() or "")
        except Exception:
            continue
    return "\n".join(text)


def _extract_docx(filepath: str) -> str:
    import docx
    d = docx.Document(filepath)
    return "\n".join(p.text for p in d.paragraphs)


YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


def guess_date(text: str, filename: str) -> str:
    """Best-effort year extraction from document text or filename, used to place
    the document on the journey timeline. Falls back to '' if nothing found."""
    for source in (filename, text[:2000] if text else ""):
        match = YEAR_RE.search(source)
        if match:
            return match.group(0)
    return ""
