"""Extract plain text from uploaded files (PDF, TXT, MD)."""

from typing import TypedDict


class PageChunk(TypedDict):
    text: str
    page_number: int | None
    source_file: str


def extract_text(file_bytes: bytes, filename: str) -> list[PageChunk]:
    """Extract text from file bytes. Raises ValueError on unsupported or empty files."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext == "pdf":
        return _extract_pdf(file_bytes, filename)
    elif ext in ("txt", "md"):
        return _extract_plain(file_bytes, filename)
    else:
        raise ValueError(f"Unsupported file type: .{ext}")


def _extract_pdf(file_bytes: bytes, filename: str) -> list[PageChunk]:
    import io
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(file_bytes))
    chunks: list[PageChunk] = []

    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        text = text.strip()
        if text:
            chunks.append({"text": text, "page_number": i + 1, "source_file": filename})

    if not chunks:
        raise ValueError("File appears to be empty or unreadable")
    return chunks


def _extract_plain(file_bytes: bytes, filename: str) -> list[PageChunk]:
    text = file_bytes.decode("utf-8", errors="replace").strip()
    if not text:
        raise ValueError("File appears to be empty or unreadable")
    return [{"text": text, "page_number": 1, "source_file": filename}]
